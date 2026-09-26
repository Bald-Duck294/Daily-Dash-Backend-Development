import { getMessaging } from "firebase-admin/messaging";
import { getApps } from "firebase-admin/app";
import prisma from "../config/prismaClient.mjs";
import { resolveEffectiveWashroomSLA } from "./slaConfigurationService.js";

/**
 * Checks if a rating breaches the washroom's SLA threshold.
 * Strictly verifies parent organization SLA:
 * - If org SLA is disabled -> no breach alerts are triggered.
 * - If washroom has custom active SLA -> uses washroom threshold.
 * - If washroom has no custom SLA -> falls back to parent company threshold.
 * If breached, dispatches a push notification to assigned cleaners and supervisors on the cleaner app.
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
            `🚨 [SLA BREACH (${effectiveSla.source})] Washroom "${locationName}" (ID: ${locIdBigInt}) score ${numericScore.toFixed(1)} is below threshold ${threshold}! Shooting push notification...`
        );

        // 4. Find assigned cleaners and supervisors for this washroom
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
        const fallbackTokens = new Set();

        for (const a of assignments) {
            if (shouldNotifyCleaner && a.cleaner_user?.id) {
                targetUserIds.add(a.cleaner_user.id);
                if (a.cleaner_user.fcm_token) fallbackTokens.add(a.cleaner_user.fcm_token);
            }
            if (shouldNotifySupervisor && a.supervisor?.id) {
                targetUserIds.add(a.supervisor.id);
                if (a.supervisor.fcm_token) fallbackTokens.add(a.supervisor.fcm_token);
            }
        }

        const targetTokens = new Set();

        if (targetUserIds.size > 0) {
            const activeTokenRecords = await prisma.user_fcm_tokens.findMany({
                where: {
                    user_id: { in: Array.from(targetUserIds) },
                    is_active: true
                },
                select: { fcm_token: true }
            });
            activeTokenRecords.forEach(r => {
                if (r.fcm_token) targetTokens.add(r.fcm_token);
            });
        }

        fallbackTokens.forEach(t => {
            if (t) targetTokens.add(t);
        });

        if (targetTokens.size === 0) {
            console.log("ℹ️ [SLA BREACH] No active FCM tokens found for assigned staff of this washroom.");
            return { breached: true, notifiedCount: 0, reason: "No FCM tokens registered" };
        }

        // 5. Send push notification to all target devices via Firebase Admin
        if (getApps().length === 0) {
            console.warn("⚠️ [SLA BREACH] Firebase Admin is not initialized. Cannot dispatch push notifications.");
            return { breached: true, notifiedCount: 0, reason: "Firebase Admin not initialized" };
        }

        const messaging = getMessaging();
        let successCount = 0;

        for (const token of targetTokens) {
            try {
                // Data-only message so cleaner app Service Worker displays custom notification
                const message = {
                    token,
                    data: {
                        title: "SLA Alert - Low Rating",
                        body: `Rating for "${locationName}" dropped to ${numericScore.toFixed(1)}/10 (SLA threshold: ${threshold}/10). Immediate cleaning required!`,
                        type: "sla_breach",
                        taskId: reviewId ? reviewId.toString() : "",
                        reviewId: reviewId ? reviewId.toString() : "",
                        locationId: locIdBigInt.toString(),
                        score: numericScore.toString(),
                        threshold: threshold.toString()
                    }
                };

                await messaging.send(message);
                successCount++;
            } catch (fcmError) {
                console.error(`❌ [SLA BREACH] Error sending push notification to token (${token.slice(0, 10)}...):`, fcmError.message);

                if (
                    fcmError.code === "messaging/registration-token-not-registered" ||
                    fcmError.code === "messaging/invalid-registration-token" ||
                    fcmError.message?.includes("not registered")
                ) {
                    await prisma.user_fcm_tokens.updateMany({
                        where: { fcm_token: token },
                        data: { is_active: false }
                    }).catch(() => {});
                }
            }
        }

        console.log(`✅ [SLA BREACH] Successfully sent ${successCount}/${targetTokens.size} notifications for washroom "${locationName}".`);
        return { breached: true, notifiedCount: successCount };
    } catch (error) {
        console.error("❌ [SLA BREACH] Error in checkAndTriggerWashroomSlaBreach:", error);
        return { breached: false, error: error.message };
    }
};
