import prisma from "../config/prismaClient.mjs";

/**
 * Helper to generate human-readable notification title & body from an activity log entry
 */
function formatNotification(log) {
  const metadata = log.metadata || {};
  let title = "System Notification";
  let body = log.action || "New activity recorded.";

  switch (log.action) {
    case "SLA_PENALTY_ASSIGNED_FOR_APPROVAL":
      title = "SLA Approval Required";
      body = `Penalty ${metadata.penalty_number || ""} (₹${metadata.penalty_amount || "0"}) generated for ${metadata.cleaner_name || "cleaner"} at ${metadata.location_name || "facility"}. Awaiting your review.`;
      break;

    case "SLA_RULE_BREACHED":
      title = "SLA Compliance Alert";
      body = `Inspection score breached rule [${metadata.rule_code || ""}] at ${metadata.location_name || "facility"}. Deduction assessed: ₹${metadata.penalty_amount || "0"}.`;
      break;

    case "SLA_RULE_BREACH_RECORDED":
      title = `SLA Breach - ${metadata.location_name || "Facility"}`;
      body = `${metadata.cleaner_name || "Cleaner"} breached rule [${metadata.rule_code || ""}]. Penalty #${metadata.penalty_number || ""} (₹${metadata.penalty_amount || "0"}) recorded.`;
      break;

    case "SLA_PENALTY_DISPUTE_FILED":
      title = "SLA Penalty Disputed";
      body = `Cleaner ${metadata.cleaner_name || ""} disputed Penalty ${metadata.penalty_number || ""} (₹${metadata.amount || "0"}). Reason: "${metadata.dispute_reason || ""}". Review required.`;
      break;

    case "SLA_DISPUTE_ACCEPTED_WAIVED":
      title = "Dispute Accepted - Penalty Waived";
      body = `Dispute for Penalty ${metadata.penalty_number || ""} was accepted by ${metadata.resolved_by || "authority"}. Deduction waived (₹0.00).`;
      break;

    case "SLA_DISPUTE_DECIDED_UPHELD":
      title = "Dispute Closed - Deduction Confirmed";
      body = `Dispute review completed for Penalty ${metadata.penalty_number || ""} by ${metadata.resolved_by || "authority"}. Confirmed deduction: ₹${metadata.approved_amount || "0"}.`;
      break;

    case "SLA_BREACH":
    case "sla_breach_level_1":
      title = `Cleaning Alert - ${metadata.location_name || "Washroom"}`;
      body = `${metadata.cleaner_name || "Cleaner"} completed cleaning with score ${metadata.score || "N/A"}/10 (Below threshold ${metadata.threshold || "8"}).`;
      break;

    default:
      if (log.action && log.action.startsWith("SLA_")) {
        title = log.action.replace(/_/g, " ");
        body = metadata.comment || metadata.reason || JSON.stringify(metadata);
      }
      break;
  }

  return {
    id: Number(log.id),
    title,
    body,
    timestamp: log.created_at,
    read: log.options === "READ",
    data: {
      type: log.action,
      penalty_id: log.target_type === "cleaner_penalties" && log.target_id ? log.target_id.toString() : undefined,
      reviewId: log.target_type === "cleaner_review" && log.target_id ? log.target_id.toString() : undefined,
      ...metadata,
    },
  };
}

/**
 * GET /notifications?user_id=123&limit=50
 */
export const getUserNotifications = async (req, res) => {
  try {
    const rawUserId = req.query.user_id || req.user?.id;
    const limit = parseInt(req.query.limit, 10) || 50;

    if (!rawUserId) {
      return res.status(400).json({ error: "user_id is required" });
    }

    const userIdBigInt = BigInt(rawUserId);

    const logs = await prisma.activity_logs.findMany({
      where: {
        user_id: userIdBigInt,
      },
      orderBy: { id: "desc" },
      take: limit,
    });

    const formatted = logs.map(formatNotification);

    return res.json(formatted);
  } catch (error) {
    console.error("Error fetching user notifications:", error);
    return res.status(500).json({ error: "Failed to fetch notifications" });
  }
};

/**
 * PATCH /notifications/:id/read
 */
export const markNotificationAsRead = async (req, res) => {
  try {
    const logId = BigInt(req.params.id);
    await prisma.activity_logs.update({
      where: { id: logId },
      data: { options: "READ" },
    });
    return res.json({ success: true, message: "Marked as read" });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    return res.status(500).json({ error: "Failed to update notification" });
  }
};

/**
 * DELETE /notifications/:id
 */
export const deleteNotification = async (req, res) => {
  try {
    const logId = BigInt(req.params.id);
    await prisma.activity_logs.delete({
      where: { id: logId },
    });
    return res.json({ success: true, message: "Notification deleted" });
  } catch (error) {
    console.error("Error deleting notification:", error);
    return res.status(500).json({ error: "Failed to delete notification" });
  }
};

