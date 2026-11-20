import { getMessaging } from "firebase-admin/messaging";
import { getApps } from "firebase-admin/app";
import prisma from "../config/prismaClient.mjs";

/**
 * Shared helper to resolve all active tokens for a given list of user objects.
 */
const getTokensForUsers = async (usersList) => {
  if (!usersList || usersList.length === 0) return [];
  const userIds = usersList.map((u) => u.id);
  const fallbackTokens = usersList.map((u) => u.fcm_token).filter(Boolean);

  const activeTokenRecords = await prisma.user_fcm_tokens.findMany({
    where: {
      user_id: { in: userIds },
      is_active: true
    },
    select: { fcm_token: true }
  });

  const tokenSet = new Set(fallbackTokens);
  activeTokenRecords.forEach((r) => {
    if (r.fcm_token) tokenSet.add(r.fcm_token);
  });
  return Array.from(tokenSet);
};

/**
 * Shared helper to send a robust multi-platform push notification (Web, Android, iOS).
 */
const sendPushNotification = async (token, { title, body, data = {} }) => {
  if (getApps().length === 0) return;
  try {
    const messaging = getMessaging();
    await messaging.send({
      token,
      notification: { title, body },
      data: {
        title,
        body,
        ...data
      },
      android: {
        priority: "high",
        notification: {
          sound: "default",
          channelId: "sla_alerts_channel",
          priority: "max"
        }
      },
      apns: {
        headers: { "apns-priority": "10" },
        payload: {
          aps: {
            sound: "default",
            badge: 1
          }
        }
      }
    });
  } catch (fcmError) {
    if (
      fcmError.code === "messaging/registration-token-not-registered" ||
      fcmError.code === "messaging/invalid-registration-token" ||
      fcmError.message?.includes("not registered")
    ) {
      prisma.user_fcm_tokens.updateMany({
        where: { fcm_token: token },
        data: { is_active: false }
      }).catch(() => {});
    }
  }
};

/**
 * Dispatch SLA Rule Breach Notifications & Activity Logs to Respective Roles:
 * 1. Admin (role_id 2 & 1): Receives full activity logs & breach notifications.
 * 2. Supervisor / Assigned Approver (role_id 3 & 7): Receives action-required notification to review & approve.
 * 3. Cleaner (role_id 5): Receives breach notification & deduction alert.
 */
export const dispatchSlaPenaltyBreachAlerts = async ({
  penalty,
  rule,
  violation,
  review,
  cleanerUser,
  location,
  companyId
}) => {
  try {
    if (!penalty || !rule) return;

    const companyIdBigInt = BigInt(companyId);
    const cleanerUserId = penalty.cleaner_user_id ? BigInt(penalty.cleaner_user_id) : null;
    const assignedApproverId = penalty.assigned_approver_id ? BigInt(penalty.assigned_approver_id) : null;
    const penaltyAmount = Number(penalty.calculated_amount || 0).toFixed(2);
    const locationName = location?.name || "Facility";
    const cleanerName = cleanerUser?.name || `Cleaner #${cleanerUserId}`;
    const scoreVal = review?.score !== null && review?.score !== undefined ? Number(review.score).toFixed(1) : "N/A";

    console.log(`📢 [SLA BREACH ALERT] Dispatching entries for Penalty #${penalty.penalty_number} (Rule: ${rule.rule_code})`);

    // 1. Fetch Company Admins (role_id === 2)
    const companyAdmins = await prisma.users.findMany({
      where: {
        company_id: companyIdBigInt,
        role_id: 2,
        deleted_at: null
      },
      select: { id: true, name: true, fcm_token: true }
    });

    // 2. Resolve Assigned Supervisors for this location
    const supervisorIds = new Set();
    if (assignedApproverId) {
      supervisorIds.add(assignedApproverId);
    }

    if (location?.id) {
      const locAssignments = await prisma.cleaner_assignments.findMany({
        where: {
          location_id: BigInt(location.id),
          deleted_at: null,
          OR: [
            { role_id: { in: [3, 7] } },
            { cleaner_user: { role_id: { in: [3, 7] } } }
          ]
        },
        select: { cleaner_user_id: true }
      });
      locAssignments.forEach((a) => {
        if (a.cleaner_user_id) supervisorIds.add(a.cleaner_user_id);
      });
    }

    const supervisors = supervisorIds.size > 0
      ? await prisma.users.findMany({
          where: {
            id: { in: Array.from(supervisorIds) },
            deleted_at: null
          },
          select: { id: true, name: true, fcm_token: true }
        })
      : [];

    // 3. Record Activity Logs
    const activityLogEntries = [];

    if (cleanerUserId) {
      activityLogEntries.push({
        user_id: cleanerUserId,
        action: "SLA_RULE_BREACHED",
        target_type: "cleaner_penalties",
        target_id: BigInt(penalty.id),
        metadata: {
          penalty_number: penalty.penalty_number,
          rule_code: rule.rule_code,
          rule_name: rule.name,
          penalty_amount: penaltyAmount,
          score: scoreVal,
          location_name: locationName
        }
      });
    }

    for (const sup of supervisors) {
      activityLogEntries.push({
        user_id: sup.id,
        action: "SLA_PENALTY_ASSIGNED_FOR_APPROVAL",
        target_type: "cleaner_penalties",
        target_id: BigInt(penalty.id),
        metadata: {
          penalty_number: penalty.penalty_number,
          cleaner_name: cleanerName,
          rule_code: rule.rule_code,
          penalty_amount: penaltyAmount,
          location_name: locationName
        }
      });
    }

    for (const adm of companyAdmins) {
      activityLogEntries.push({
        user_id: adm.id,
        action: "SLA_RULE_BREACH_RECORDED",
        target_type: "cleaner_penalties",
        target_id: BigInt(penalty.id),
        metadata: {
          penalty_number: penalty.penalty_number,
          cleaner_name: cleanerName,
          rule_code: rule.rule_code,
          penalty_amount: penaltyAmount,
          location_name: locationName,
          approver_count: supervisors.length
        }
      });
    }

    if (activityLogEntries.length > 0) {
      try {
        await prisma.activity_logs.createMany({
          data: activityLogEntries
        });
      } catch (logErr) {
        console.error("Error creating activity logs for SLA penalty:", logErr);
      }
    }

    // 4. Send Push Notifications via FCM
    // 4a. Notify Supervisors (Action Required: Approval)
    if (supervisors.length > 0) {
      const supTokens = await getTokensForUsers(supervisors);
      for (const token of supTokens) {
        await sendPushNotification(token, {
          title: "SLA Approval Required",
          body: `Penalty ${penalty.penalty_number} (₹${penaltyAmount}) generated for ${cleanerName} at ${locationName}. Awaiting your review.`,
          data: {
            type: "SLA_PENALTY_APPROVAL",
            penalty_id: String(penalty.id),
            penalty_number: penalty.penalty_number,
            company_id: String(companyId)
          }
        });
      }
    }

    // 4b. Notify Cleaner (Breach Alert)
    if (cleanerUser) {
      const cleanerTokens = await getTokensForUsers([cleanerUser]);
      for (const token of cleanerTokens) {
        await sendPushNotification(token, {
          title: "SLA Compliance Alert",
          body: `Inspection score ${scoreVal}/10 breached rule [${rule.rule_code}] at ${locationName}. Contract deduction assessed: ₹${penaltyAmount}.`,
          data: {
            type: "SLA_PENALTY_CLEANER",
            penalty_id: String(penalty.id),
            penalty_number: penalty.penalty_number,
            company_id: String(companyId)
          }
        });
      }
    }

    // 4c. Notify Company Admins (Activity Overview)
    if (companyAdmins.length > 0) {
      const adminTokens = await getTokensForUsers(companyAdmins);
      for (const token of adminTokens) {
        await sendPushNotification(token, {
          title: `SLA Contract Breach - ${locationName}`,
          body: `${cleanerName} breached rule [${rule.rule_code}]. Penalty #${penalty.penalty_number} (₹${penaltyAmount}) assigned to supervisor for approval.`,
          data: {
            type: "SLA_PENALTY_ADMIN",
            penalty_id: String(penalty.id),
            company_id: String(companyId)
          }
        });
      }
    }

    console.log("✅ [SLA Alerts Dispatched] Cleaner, Supervisors, and Admins notified successfully.");
  } catch (error) {
    console.error("Error in dispatchSlaPenaltyBreachAlerts:", error);
  }
};

/**
 * Dispatch notification when cleaner or supervisor raises a dispute on a penalty.
 */
export const dispatchSlaDisputeRaisedAlerts = async ({
  penalty,
  cleanerUser,
  disputeReason,
  companyId
}) => {
  try {
    if (!penalty) return;
    const companyIdBigInt = BigInt(companyId);
    const cleanerName = cleanerUser?.name || `Cleaner #${penalty.cleaner_user_id}`;
    const penaltyAmount = Number(penalty.approved_amount ?? penalty.calculated_amount ?? 0).toFixed(2);
    const reason = disputeReason || "Dispute inquiry filed";

    console.log(`📢 [SLA DISPUTE ALERT] Dispute raised for Penalty #${penalty.penalty_number}`);

    const supervisorIds = new Set();
    if (penalty.assigned_approver_id) supervisorIds.add(penalty.assigned_approver_id);
    if (penalty.location_id) {
      const locAssignments = await prisma.cleaner_assignments.findMany({
        where: {
          location_id: BigInt(penalty.location_id),
          deleted_at: null,
          OR: [
            { role_id: { in: [3, 7] } },
            { cleaner_user: { role_id: { in: [3, 7] } } }
          ]
        },
        select: { cleaner_user_id: true }
      });
      locAssignments.forEach((a) => {
        if (a.cleaner_user_id) supervisorIds.add(a.cleaner_user_id);
      });
    }

    const supervisors = supervisorIds.size > 0
      ? await prisma.users.findMany({
          where: { id: { in: Array.from(supervisorIds) }, deleted_at: null },
          select: { id: true, name: true, fcm_token: true }
        })
      : [];

    const companyAdmins = await prisma.users.findMany({
      where: { company_id: companyIdBigInt, role_id: 2, deleted_at: null },
      select: { id: true, name: true, fcm_token: true }
    });

    // Activity Logs
    const logEntries = [];
    supervisors.forEach((sup) => {
      logEntries.push({
        user_id: sup.id,
        action: "SLA_PENALTY_DISPUTE_FILED",
        target_type: "cleaner_penalties",
        target_id: BigInt(penalty.id),
        metadata: {
          penalty_number: penalty.penalty_number,
          cleaner_name: cleanerName,
          dispute_reason: reason,
          amount: penaltyAmount
        }
      });
    });
    companyAdmins.forEach((adm) => {
      logEntries.push({
        user_id: adm.id,
        action: "SLA_PENALTY_DISPUTE_FILED",
        target_type: "cleaner_penalties",
        target_id: BigInt(penalty.id),
        metadata: {
          penalty_number: penalty.penalty_number,
          cleaner_name: cleanerName,
          dispute_reason: reason,
          amount: penaltyAmount
        }
      });
    });

    if (logEntries.length > 0) {
      await prisma.activity_logs.createMany({ data: logEntries }).catch(() => {});
    }

    // Push Notifications
    const recipients = [...supervisors, ...companyAdmins];
    const tokens = await getTokensForUsers(recipients);

    for (const token of tokens) {
      await sendPushNotification(token, {
        title: "SLA Penalty Disputed",
        body: `Cleaner ${cleanerName} disputed Penalty ${penalty.penalty_number} (₹${penaltyAmount}). Reason: "${reason}". Review required.`,
        data: {
          type: "SLA_PENALTY_DISPUTE",
          penalty_id: String(penalty.id),
          penalty_number: penalty.penalty_number,
          company_id: String(companyId)
        }
      });
    }
  } catch (error) {
    console.error("Error in dispatchSlaDisputeRaisedAlerts:", error);
  }
};

/**
 * Dispatch notification when authority resolves a dispute (Waived or Upheld).
 */
export const dispatchSlaDisputeResolvedAlerts = async ({
  penalty,
  cleanerUser,
  actorUser,
  resolution, // "WAIVED" | "UPHELD"
  approvedAmount = 0,
  reason = "",
  companyId
}) => {
  try {
    if (!penalty) return;
    const companyIdBigInt = BigInt(companyId);
    const cleanerUserId = penalty.cleaner_user_id ? BigInt(penalty.cleaner_user_id) : null;
    const actorName = actorUser?.name || "Authorized Authority";
    const penaltyNum = penalty.penalty_number;
    const isWaived = resolution === "WAIVED" || Number(approvedAmount) === 0;

    console.log(`📢 [SLA DISPUTE RESOLUTION] Penalty #${penaltyNum} resolved as ${resolution} by ${actorName}`);

    if (cleanerUserId) {
      await prisma.activity_logs.create({
        data: {
          user_id: cleanerUserId,
          action: isWaived ? "SLA_DISPUTE_ACCEPTED_WAIVED" : "SLA_DISPUTE_DECIDED_UPHELD",
          target_type: "cleaner_penalties",
          target_id: BigInt(penalty.id),
          metadata: {
            penalty_number: penaltyNum,
            resolution,
            resolved_by: actorName,
            approved_amount: approvedAmount,
            reason
          }
        }
      }).catch(() => {});
    }

    // Notify Cleaner
    if (cleanerUser) {
      const cleanerTokens = await getTokensForUsers([cleanerUser]);
      const title = isWaived ? "Dispute Accepted - Penalty Waived" : "Dispute Closed - Deduction Confirmed";
      const body = isWaived
        ? `Your dispute for Penalty ${penaltyNum} was accepted by ${actorName}. The deduction has been waived (₹0.00).`
        : `Dispute review completed for Penalty ${penaltyNum} by ${actorName}. Confirmed deduction: ₹${Number(approvedAmount).toFixed(2)}.`;

      for (const token of cleanerTokens) {
        await sendPushNotification(token, {
          title,
          body,
          data: {
            type: "SLA_DISPUTE_RESOLUTION",
            penalty_id: String(penalty.id),
            penalty_number: penaltyNum,
            resolution,
            company_id: String(companyId)
          }
        });
      }
    }

    // Notify Company Admins
    const companyAdmins = await prisma.users.findMany({
      where: { company_id: companyIdBigInt, role_id: 2, deleted_at: null },
      select: { id: true, name: true, fcm_token: true }
    });
    const adminTokens = await getTokensForUsers(companyAdmins);
    for (const token of adminTokens) {
      await sendPushNotification(token, {
        title: `Dispute Resolved: Penalty ${penaltyNum}`,
        body: `${actorName} resolved dispute on Penalty ${penaltyNum} (${isWaived ? "Waived ₹0.00" : `Upheld ₹${Number(approvedAmount).toFixed(2)}`}).`,
        data: {
          type: "SLA_DISPUTE_RESOLUTION_ADMIN",
          penalty_id: String(penalty.id),
          penalty_number: penaltyNum,
          company_id: String(companyId)
        }
      });
    }
  } catch (error) {
    console.error("Error in dispatchSlaDisputeResolvedAlerts:", error);
  }
};
