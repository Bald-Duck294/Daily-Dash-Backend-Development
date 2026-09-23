import prisma from "../config/prismaClient.mjs";
import { resolveEffectiveWashroomSLA } from "./slaConfigurationService.js";
import { broadcastNotification } from "./notificationService.js";

/**
 * Checks if a rating breaches the washroom's SLA threshold.
 * Strictly verifies parent organization SLA:
 * - If org SLA is disabled -> no breach alerts are triggered.
 * - If washroom has custom active SLA -> uses washroom threshold.
 * - If washroom has no custom SLA -> falls back to parent company threshold.
 * If breached, dispatches a multicast push notification to all active devices
 * of assigned cleaners and supervisors on the cleaner app, and records an SLA log.
 */
export const checkAndTriggerWashroomSlaBreach = async ({
    locationId,
    score,
    reviewId = null,
    reviewType = "cleaner_review"
}) => {
    try {
        if (!locationId || score === undefined || score === null) {
            return { breached: false, reason: "Missing locationId or score" };
        }

        const locIdBigInt = BigInt(locationId);

        // 1. Resolve effective SLA (checks org master switch & washroom fallback)
        const effectiveSla = await resolveEffectiveWashroomSLA(locIdBigInt);

        if (!effectiveSla || !effectiveSla.enabled) {
            return {
                breached: false,
                reason: effectiveSla?.reason || "SLA not active for this washroom or company"
            };
        }

        const threshold = Number(effectiveSla.threshold ?? 7);
        const numericScore = Number(score);

        if (isNaN(numericScore)) {
            return { breached: false, reason: "Invalid score" };
        }

        // 2. Verify threshold condition (Breach occurs when score < threshold)
        if (numericScore >= threshold) {
            return { breached: false, reason: "Score complies with SLA threshold" };
        }

        const locationName = effectiveSla.location_name || "Washroom";

        console.log(
            `🚨 [SLA BREACH (${effectiveSla.source})] Washroom "${locationName}" (ID: ${locIdBigInt}) score ${numericScore.toFixed(1)} is below threshold ${threshold}! Broadcasting push notification...`
        );

        // 3. Find assigned cleaners and supervisors for this washroom
        const assignments = await prisma.cleaner_assignments.findMany({
            where: { location_id: locIdBigInt },
            include: {
                cleaner_user: {
                    select: { id: true, name: true, fcm_token: true }
                },
                supervisor: {
                    select: { id: true, name: true, fcm_token: true }
                }
            }
        });

        const shouldNotifyCleaner = effectiveSla.configuration?.notify_cleaner !== false;
        const shouldNotifySupervisor = effectiveSla.configuration?.notify_supervisor !== false;

        const targetUserIds = new Set();
        for (const a of assignments) {
            if (shouldNotifyCleaner && a.cleaner_user?.id) {
                targetUserIds.add(a.cleaner_user.id);
            }
            if (shouldNotifySupervisor && a.supervisor?.id) {
                targetUserIds.add(a.supervisor.id);
            }
        }

        if (targetUserIds.size === 0) {
            console.log("ℹ️ [SLA BREACH] No assigned cleaners or supervisors found for this washroom.");
            return { breached: true, notifiedCount: 0, reason: "No assigned staff found" };
        }

        const recipientIds = Array.from(targetUserIds);

        // 4. Broadcast push notification to all active devices of targeted staff
        const dispatchResult = await broadcastNotification(recipientIds, {
            title: "SLA Alert - Low Rating",
            body: `Rating for "${locationName}" dropped to ${numericScore.toFixed(1)}/10 (SLA threshold: ${threshold}/10). Immediate cleaning required!`,
            type: "sla_breach",
            data: {
                taskId: reviewId ? reviewId.toString() : "",
                reviewId: reviewId ? reviewId.toString() : "",
                locationId: locIdBigInt.toString(),
                score: numericScore.toString(),
                threshold: threshold.toString()
            }
        });

        // 5. Record SLA Bridge audit log in activity_logs
        try {
            await prisma.activity_logs.create({
                data: {
                    action: "SLA_BREACH_NOTIFICATION_BROADCAST",
                    target_type: "locations",
                    target_id: locIdBigInt,
                    metadata: {
                        location_name: locationName,
                        score: numericScore,
                        threshold: threshold,
                        review_id: reviewId ? reviewId.toString() : null,
                        recipient_user_ids: recipientIds.map((id) => id.toString()),
                        devices_targeted: dispatchResult.totalTokens,
                        delivered_count: dispatchResult.successCount,
                        failed_count: dispatchResult.failureCount
                    }
                }
            });
        } catch (logErr) {
            console.error("⚠️ [SLA BREACH] Failed to write activity log:", logErr.message);
        }

        console.log(`✅ [SLA BREACH] Dispatched SLA alerts for washroom "${locationName}": ${dispatchResult.successCount}/${dispatchResult.totalTokens} delivered across ${recipientIds.length} staff member(s).`);
        return {
            breached: true,
            notifiedCount: dispatchResult.successCount,
            totalDevices: dispatchResult.totalTokens
        };
    } catch (error) {
        console.error("❌ [SLA BREACH] Error in checkAndTriggerWashroomSlaBreach:", error);
        return { breached: false, error: error.message };
    }
};
