import { getMessaging } from "firebase-admin/messaging";
import { getApps } from "firebase-admin/app";
import prisma from "../config/prismaClient.mjs";

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

    // ========================================================
    // 1. Fetch Company Admins (role_id === 2) for this company
    // ========================================================
    const companyAdmins = await prisma.users.findMany({
      where: {
        company_id: companyIdBigInt,
        role_id: 2,
        deleted_at: null
      },
      select: { id: true, name: true, fcm_token: true }
    });

    // ========================================================
    // 2. Resolve Assigned Supervisors for this location
    // ========================================================
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

    // ========================================================
    // 3. Record Activity Logs for Respective Roles
    // ========================================================
    const activityLogEntries = [];

    // Log for Cleaner
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

    // Log for each Supervisor
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

    // Log for Company Admins
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
        console.log(`✅ [SLA Activity Logs] Created ${activityLogEntries.length} audit entries across respective roles.`);
      } catch (logErr) {
        console.error("Error creating activity logs for SLA penalty:", logErr);
      }
    }

    // ========================================================
    // 4. Send Push Notifications via Firebase FCM
    // ========================================================
    if (getApps().length === 0) {
      console.warn("⚠️ [SLA FCM] Firebase Admin is not initialized. Skipping push dispatch.");
      return;
    }

    const messaging = getMessaging();

    // Helper to get all active tokens for a user list
    const getTokensForUsers = async (usersList) => {
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

    // 4a. Notify Supervisors (Action Required: Approval)
    if (supervisors.length > 0) {
      const supTokens = await getTokensForUsers(supervisors);
      for (const token of supTokens) {
        try {
          await messaging.send({
            token,
            notification: {
              title: "SLA Approval Required",
              body: `Penalty ${penalty.penalty_number} (₹${penaltyAmount}) generated for ${cleanerName} at ${locationName}. Awaiting your review.`
            },
            data: {
              type: "SLA_PENALTY_APPROVAL",
              penalty_id: String(penalty.id),
              penalty_number: penalty.penalty_number,
              company_id: String(companyId)
            }
          });
        } catch (e) {
          // Token may be invalid or expired
        }
      }
    }

    // 4b. Notify Cleaner (Breach Alert)
    if (cleanerUser) {
      const cleanerTokens = await getTokensForUsers([cleanerUser]);
      for (const token of cleanerTokens) {
        try {
          await messaging.send({
            token,
            notification: {
              title: "SLA Compliance Alert",
              body: `Inspection score ${scoreVal}/10 breached rule [${rule.rule_code}] at ${locationName}. Contract deduction assessed: ₹${penaltyAmount}.`
            },
            data: {
              type: "SLA_PENALTY_CLEANER",
              penalty_id: String(penalty.id),
              penalty_number: penalty.penalty_number
            }
          });
        } catch (e) {
          // Ignore expired token
        }
      }
    }

    // 4c. Notify Company Admins (Activity Overview)
    if (companyAdmins.length > 0) {
      const adminTokens = await getTokensForUsers(companyAdmins);
      for (const token of adminTokens) {
        try {
          await messaging.send({
            token,
            notification: {
              title: `SLA Contract Breach - ${locationName}`,
              body: `${cleanerName} breached rule [${rule.rule_code}]. Penalty #${penalty.penalty_number} (₹${penaltyAmount}) assigned to supervisor for approval.`
            },
            data: {
              type: "SLA_PENALTY_ADMIN",
              penalty_id: String(penalty.id),
              company_id: String(companyId)
            }
          });
        } catch (e) {
          // Ignore expired token
        }
      }
    }

    console.log("✅ [SLA Alerts Dispatched] Cleaner, Supervisors, and Admins notified successfully.");
  } catch (error) {
    console.error("Error in dispatchSlaPenaltyBreachAlerts:", error);
  }
};

