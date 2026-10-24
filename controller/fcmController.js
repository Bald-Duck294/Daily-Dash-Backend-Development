import { getMessaging } from "firebase-admin/messaging";
import { getApps } from "firebase-admin/app";
import prisma from '../config/prismaClient.mjs';

export const saveFCMToken = async (req, res) => {
    const { fcm_token, user_id, device_id } = req.body;
    const rawUserId = user_id || req.user?.id;
    if (!rawUserId || !fcm_token) {
        return res.status(400).json({ error: "user_id and fcm_token are required" });
    }
    try {
        const userIdBigInt = BigInt(rawUserId);

        // 1. Account Handover Protection (deactivate this token if previously held by another user on this device)
        await prisma.user_fcm_tokens.updateMany({
            where: {
                fcm_token,
                user_id: { not: userIdBigInt }
            },
            data: { is_active: false }
        });

        // 2. Upsert into user_fcm_tokens
        await prisma.user_fcm_tokens.upsert({
            where: {
                user_id_fcm_token: {
                    user_id: userIdBigInt,
                    fcm_token
                }
            },
            update: {
                is_active: true,
                device_id: device_id || null,
                updated_at: new Date()
            },
            create: {
                user_id: userIdBigInt,
                fcm_token,
                device_id: device_id || null,
                is_active: true
            }
        });

        // 3. Dual-write to users table for backward compatibility
        await prisma.users.update({
            where: { id: userIdBigInt },
            data: { fcm_token }
        });

        res.json({ success: true, message: "FCM token saved successfully" });
    } catch (error) {
        console.error("Error saving FCM token:", error);
        res.status(500).json({ error: "Failed to save FCM token" });
    }
};

export const deleteFcmToken = async (req, res) => {
    const rawUserId = req.body.userId || req.body.user_id || req.user?.id;
    const { fcm_token } = req.body;

    if (!rawUserId) {
        return res.status(400).json({ error: true, message: 'user id not provided' });
    }

    if (!fcm_token) {
        return res.status(400).json({ error: true, message: 'fcm_token is required' });
    }

    try {
        const userIdBigInt = BigInt(rawUserId);

        // 1. Delete specific device token row for this user
        await prisma.user_fcm_tokens.deleteMany({
            where: {
                user_id: userIdBigInt,
                fcm_token: fcm_token
            }
        });

        // 2. Fallback for legacy users.fcm_token:
        // Keep in sync with the most recent remaining active device for this user
        const remainingToken = await prisma.user_fcm_tokens.findFirst({
            where: {
                user_id: userIdBigInt,
                is_active: true
            },
            orderBy: {
                updated_at: 'desc'
            },
            select: {
                fcm_token: true
            }
        });

        await prisma.users.update({
            where: { id: userIdBigInt },
            data: { fcm_token: remainingToken?.fcm_token || null }
        });

        res.status(200).json({
            error: false,
            message: 'FCM token deleted successfully'
        });
    } catch (error) {
        console.error('Error from delete fcm token:', error);
        res.status(500).json({
            error: true,
            message: 'Unable to delete FCM token'
        });
    }
};

/**
 * Test endpoint to dispatch FCM push notification to all users (admin, supervisor, cleaner)
 * of a specific company (default: companyId 111).
 * Supports both Android high-priority (sound/channel) and iOS APNs headers.
 */
export const sendTestPushToCompanyUsers = async (req, res) => {
    const rawCompanyId = req.body?.companyId || req.query?.companyId || 111;
    const notificationTitle = req.body?.title || req.query?.title || "SLA Breach Test - Ground Floor Washroom";
    const notificationBody = req.body?.body || req.query?.body || "Cleanliness score dropped to 5.2/10 (Target: 8.0/10). Immediate cleaning required.";
    const reviewId = req.body?.reviewId || req.query?.reviewId || "999";
    const locationId = req.body?.locationId || req.query?.locationId || "1";
    const numericScore = req.body?.score || req.query?.score || "5.2";
    const threshold = req.body?.threshold || req.query?.threshold || "8.0";

    if (getApps().length === 0) {
        return res.status(500).json({
            success: false,
            error: "Firebase Admin is not initialized on the server."
        });
    }

    try {
        const companyIdBigInt = BigInt(rawCompanyId);

        // 1. Fetch all users belonging to this company (Admin, Supervisor, Cleaner, etc.)
        const users = await prisma.users.findMany({
            where: {
                OR: [
                    { company_id: companyIdBigInt },
                    { facility_company_id: companyIdBigInt }
                ],
                deleted_at: null
            },
            select: {
                id: true,
                name: true,
                email: true,
                role_id: true,
                role: { select: { id: true, name: true } },
                fcm_token: true
            }
        });

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: `No active users found for company ID ${rawCompanyId}.`
            });
        }

        const userIds = users.map(u => u.id);

        // 2. Fetch all active device tokens from user_fcm_tokens (multi-device table)
        const activeTokenRows = await prisma.user_fcm_tokens.findMany({
            where: {
                user_id: { in: userIds },
                is_active: true
            },
            select: {
                user_id: true,
                fcm_token: true,
                device_id: true
            }
        });

        // 3. Collect tokens per user with fallback to legacy users.fcm_token
        const tokenUserMap = new Map(); // token -> { userId, userName, role }
        activeTokenRows.forEach(row => {
            if (row.fcm_token) {
                const userObj = users.find(u => u.id === row.user_id);
                tokenUserMap.set(row.fcm_token, {
                    userId: row.user_id.toString(),
                    name: userObj?.name || "Unknown",
                    role: userObj?.role?.name || `Role ${userObj?.role_id || "N/A"}`
                });
            }
        });

        // Add legacy fallback tokens if not already present
        users.forEach(u => {
            if (u.fcm_token && !tokenUserMap.has(u.fcm_token)) {
                tokenUserMap.set(u.fcm_token, {
                    userId: u.id.toString(),
                    name: u.name || "Unknown",
                    role: u.role?.name || `Role ${u.role_id || "N/A"}`
                });
            }
        });

        const targetTokens = Array.from(tokenUserMap.keys());

        if (targetTokens.length === 0) {
            return res.status(200).json({
                success: false,
                message: `Found ${users.length} users for company ID ${rawCompanyId}, but none have an active FCM token registered.`,
                usersFound: users.map(u => ({
                    id: u.id.toString(),
                    name: u.name,
                    role: u.role?.name || u.role_id
                }))
            });
        }

        const messaging = getMessaging();
        const dispatchResults = [];
        let successCount = 0;
        let failCount = 0;

        for (const token of targetTokens) {
            const userMeta = tokenUserMap.get(token);

            const message = {
                token,
                notification: {
                    title: notificationTitle,
                    body: notificationBody,
                },
                data: {
                    title: notificationTitle,
                    body: notificationBody,
                    type: "sla_breach",
                    taskId: reviewId ? reviewId.toString() : "",
                    reviewId: reviewId ? reviewId.toString() : "",
                    locationId: locationId.toString(),
                    score: numericScore.toString(),
                    threshold: threshold.toString()
                },
                // 📱 Force Android devices to wake up from sleep mode immediately
                android: {
                    priority: "high",
                    notification: {
                        sound: "default",
                        channelId: "sla_alerts_channel",
                        priority: "max"
                    }
                },
                // 🍎 Force iOS devices to ring immediately
                apns: {
                    headers: {
                        "apns-priority": "10"
                    },
                    payload: {
                        aps: {
                            sound: "default",
                            badge: 1
                        }
                    }
                }
            };

            try {
                const response = await messaging.send(message);
                successCount++;
                dispatchResults.push({
                    recipient: userMeta.name,
                    role: userMeta.role,
                    userId: userMeta.userId,
                    tokenSnippet: `${token.slice(0, 15)}...`,
                    status: "SENT",
                    firebaseMessageId: response
                });
            } catch (fcmError) {
                failCount++;
                dispatchResults.push({
                    recipient: userMeta.name,
                    role: userMeta.role,
                    userId: userMeta.userId,
                    tokenSnippet: `${token.slice(0, 15)}...`,
                    status: "FAILED",
                    error: fcmError.message
                });

                // Auto-deactivate dead tokens across both user_fcm_tokens and legacy users table
                const errLower = (fcmError.message || "").toLowerCase();
                if (
                    fcmError.code === "messaging/registration-token-not-registered" ||
                    fcmError.code === "messaging/invalid-registration-token" ||
                    errLower.includes("not registered") ||
                    errLower.includes("notregistered")
                ) {
                    await prisma.user_fcm_tokens.updateMany({
                        where: { fcm_token: token },
                        data: { is_active: false }
                    }).catch(() => {});
                    await prisma.users.updateMany({
                        where: { fcm_token: token },
                        data: { fcm_token: null }
                    }).catch(() => {});
                }
            }
        }

        return res.status(200).json({
            success: true,
            companyId: rawCompanyId,
            totalUsersFound: users.length,
            totalTokensDispatched: targetTokens.length,
            successCount,
            failCount,
            results: dispatchResults
        });
    } catch (error) {
        console.error("❌ [TEST PUSH ERROR]:", error);
        return res.status(500).json({
            success: false,
            error: error.message || "Failed to dispatch test push notifications"
        });
    }
};