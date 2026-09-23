import prisma from '../config/prismaClient.mjs';

/**
 * Saves / activates an FCM token for a user.
 * Supports multiple active devices per user.
 * Ensures shared-device handover safety and legacy dual-writing.
 */
export const saveFCMToken = async (req, res) => {
    const rawUserId = req.user?.id || req.body.user_id || req.body.userId;
    const { fcm_token } = req.body;

    if (!rawUserId || !fcm_token) {
        return res.status(400).json({ error: true, message: "user_id and fcm_token are required" });
    }

    try {
        const userIdBigInt = BigInt(rawUserId);

        await prisma.$transaction(async (tx) => {
            // 1. Device Handover: If this token belonged to another user on a shared device, deactivate it
            await tx.user_fcm_tokens.updateMany({
                where: {
                    fcm_token: fcm_token,
                    user_id: { not: userIdBigInt }
                },
                data: { is_active: false }
            });

            // 2. Upsert token for current user
            await tx.user_fcm_tokens.upsert({
                where: {
                    user_id_fcm_token: {
                        user_id: userIdBigInt,
                        fcm_token: fcm_token
                    }
                },
                update: {
                    is_active: true,
                    updated_at: new Date()
                },
                create: {
                    user_id: userIdBigInt,
                    fcm_token: fcm_token,
                    is_active: true
                }
            });

            // 3. Backward-compatibility dual-write to legacy column
            await tx.users.update({
                where: { id: userIdBigInt },
                data: { fcm_token }
            });
        });

        return res.status(200).json({ success: true, message: "FCM token saved and activated" });
    } catch (error) {
        console.error("Error saving FCM token:", error);
        return res.status(500).json({ error: true, message: "Failed to save FCM token", details: error.message });
    }
};

/**
 * Permanently deletes an FCM token upon logout.
 * If fcm_token is provided: permanently deletes ONLY that specific device's token.
 * If fcm_token is omitted: permanently deletes all tokens for this user (legacy fallback).
 */
export const deleteFcmToken = async (req, res) => {
    const rawUserId = req.user?.id || req.body.userId || req.body.user_id;
    const { fcm_token } = req.body;

    if (!rawUserId) {
        return res.status(400).json({ error: true, message: "user id not provided" });
    }

    try {
        const userIdBigInt = BigInt(rawUserId);

        if (fcm_token) {
            // Permanently delete ONLY this specific device's token
            await prisma.user_fcm_tokens.deleteMany({
                where: {
                    user_id: userIdBigInt,
                    fcm_token: fcm_token
                }
            });

            // Also clear legacy users.fcm_token if it matches
            await prisma.users.updateMany({
                where: {
                    id: userIdBigInt,
                    fcm_token: fcm_token
                },
                data: { fcm_token: null }
            });

            return res.status(200).json({
                error: false,
                message: "FCM token deleted successfully"
            });
        }

        // Fallback: If no specific token passed, permanently delete all tokens for user
        await prisma.user_fcm_tokens.deleteMany({
            where: { user_id: userIdBigInt }
        });

        const updatedUser = await prisma.users.update({
            where: { id: userIdBigInt },
            data: { fcm_token: null }
        });

        return res.status(200).json({
            error: false,
            message: "FCM token deleted successfully",
            deleteToken: {
                ...updatedUser,
                id: updatedUser?.id?.toString(),
                company_id: updatedUser?.company_id?.toString()
            }
        });
    } catch (error) {
        console.error("Error from delete fcm token:", error);
        return res.status(500).json({
            error: true,
            message: "unable to delete fcm token"
        });
    }
};