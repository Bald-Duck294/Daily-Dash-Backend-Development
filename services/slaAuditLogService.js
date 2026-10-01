import prisma from "../config/prismaClient.mjs";

/**
 * Standardized audit event logger for SLA lifecycle transitions.
 * Guaranteed never to throw or crash main business transactions.
 */
export async function logEscalationEvent({
    escalationId,
    reviewId = null,
    actorUserId = null,
    eventType,
    level = null,
    score = null,
    metadata = {}
}) {
    try {
        if (!escalationId || !eventType) {
            console.warn("⚠️ [SLA AUDIT LOG] Missing escalationId or eventType. Skipping log.");
            return null;
        }

        const log = await prisma.sla_escalation_logs.create({
            data: {
                escalation_id: BigInt(escalationId),
                review_id: reviewId ? BigInt(reviewId) : null,
                actor_user_id: actorUserId ? BigInt(actorUserId) : null,
                event_type: String(eventType),
                level: level !== null && level !== undefined ? Number(level) : null,
                score: score !== null && score !== undefined ? Number(score) : null,
                metadata: metadata || {}
            }
        });

        console.log(`📝 [SLA AUDIT] Logged "${eventType}" for Escalation #${escalationId}`);
        return log;
    } catch (err) {
        // Non-blocking catch to ensure SLA workflow never fails due to logging
        console.error("❌ [SLA AUDIT LOG ERROR]:", err.message);
        return null;
    }
}
