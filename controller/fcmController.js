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

    try {
        const userIdBigInt = BigInt(rawUserId);

        if (fcm_token) {
            // Delete specific device token
            await prisma.user_fcm_tokens.deleteMany({
                where: {
                    user_id: userIdBigInt,
                    fcm_token: fcm_token
                }
            });

            await prisma.users.updateMany({
                where: { id: userIdBigInt, fcm_token: fcm_token },
                data: { fcm_token: null }
            });
        } else {
            // Delete all tokens for this user
            await prisma.user_fcm_tokens.deleteMany({
                where: { user_id: userIdBigInt }
            });

            await prisma.users.update({
                where: { id: userIdBigInt },
                data: { fcm_token: null }
            });
        }

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