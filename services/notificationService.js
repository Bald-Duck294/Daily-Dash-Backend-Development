import { getMessaging } from "firebase-admin/messaging";
import { getApps } from "firebase-admin/app";
import prisma from "../config/prismaClient.mjs";

const FIREBASE_BATCH_LIMIT = 500;

/**
 * Broadcasts a push notification to all active devices of the specified users.
 * Handles:
 * 1. Resolving all active tokens from user_fcm_tokens
 * 2. Fallback to users.fcm_token for legacy accounts during transition
 * 3. 500-token chunked Firebase Multicast delivery
 * 4. Automatic dead-token deactivation (cache clear / app uninstall)
 *
 * @param {Array<number|string|bigint>} userIds - Target user IDs
 * @param {Object} payload - Notification payload { title, body, type, data }
 * @returns {Promise<{successCount: number, failureCount: number, totalTokens: number}>}
 */
export const broadcastNotification = async (
    userIds,
    { title = "Notification", body = "", type = "general", data = {} } = {}
) => {
    try {
        if (!userIds || userIds.length === 0) {
            return { successCount: 0, failureCount: 0, totalTokens: 0 };
        }

        const userBigInts = userIds.map((id) => BigInt(id));

        // 1. Fetch all active tokens for target users from user_fcm_tokens
        const tokenRecords = await prisma.user_fcm_tokens.findMany({
            where: {
                user_id: { in: userBigInts },
                is_active: true
            },
            select: { fcm_token: true, user_id: true }
        });

        const activeTokens = new Set(tokenRecords.map((r) => r.fcm_token).filter(Boolean));

        // 2. Legacy Fallback: If any user doesn't have an active token in user_fcm_tokens,
        // check users.fcm_token so they don't miss alerts before opening the updated app
        const usersWithActiveTokens = new Set(tokenRecords.map((r) => r.user_id.toString()));
        const missingUserBigInts = userBigInts.filter((id) => !usersWithActiveTokens.has(id.toString()));

        if (missingUserBigInts.length > 0) {
            const legacyUsers = await prisma.users.findMany({
                where: {
                    id: { in: missingUserBigInts },
                    fcm_token: { not: null }
                },
                select: { fcm_token: true }
            });
            legacyUsers.forEach((u) => {
                if (u.fcm_token) activeTokens.add(u.fcm_token);
            });
        }

        const tokens = Array.from(activeTokens);
        if (tokens.length === 0) {
            return { successCount: 0, failureCount: 0, totalTokens: 0 };
        }

        if (getApps().length === 0) {
            console.warn("⚠️ [NotificationService] Firebase Admin is not initialized. Skipping push dispatch.");
            return { successCount: 0, failureCount: 0, totalTokens: tokens.length };
        }

        const messaging = getMessaging();
        const deadTokens = [];
        let totalSuccess = 0;
        let totalFailure = 0;

        // Stringify data payload entries (Firebase requires String:String key-value map)
        const normalizedData = Object.fromEntries(
            Object.entries({ ...data, title, body, type }).map(([k, v]) => [k, String(v ?? "")])
        );

        // 3. Batch multicast across chunks of 500
        for (let i = 0; i < tokens.length; i += FIREBASE_BATCH_LIMIT) {
            const chunk = tokens.slice(i, i + FIREBASE_BATCH_LIMIT);
            const message = {
                tokens: chunk,
                data: normalizedData,
                android: { priority: "high" },
                webpush: { headers: { Urgency: "high" } }
            };

            try {
                const response = await messaging.sendEachForMulticast(message);
                totalSuccess += response.successCount;
                totalFailure += response.failureCount;

                // Inspect each token failure for deactivation triggers
                if (response.failureCount > 0) {
                    response.responses.forEach((resp, idx) => {
                        if (!resp.success) {
                            const errorCode = resp.error?.code;
                            // When user clears browser cache/data, uninstalls app, or token is invalidated
                            if (
                                errorCode === "messaging/registration-token-not-registered" ||
                                errorCode === "messaging/invalid-registration-token"
                            ) {
                                deadTokens.push(chunk[idx]);
                            }
                        }
                    });
                }
            } catch (chunkError) {
                console.error("❌ [NotificationService] Batch multicast error:", chunkError.message);
                totalFailure += chunk.length;
            }
        }

        // 4. Automatically deactivate dead tokens in DB
        if (deadTokens.length > 0) {
            try {
                const deactivated = await prisma.user_fcm_tokens.updateMany({
                    where: { fcm_token: { in: deadTokens } },
                    data: { is_active: false }
                });
                console.log(`🧹 [NotificationService] Auto-deactivated ${deactivated.count} dead token(s) (cache cleared / uninstalled).`);
            } catch (dbError) {
                console.error("❌ [NotificationService] Error deactivating dead tokens:", dbError.message);
            }
        }

        return {
            successCount: totalSuccess,
            failureCount: totalFailure,
            totalTokens: tokens.length
        };
    } catch (error) {
        console.error("❌ [NotificationService] Error in broadcastNotification:", error);
        return { successCount: 0, failureCount: 0, totalTokens: 0, error: error.message };
    }
};
