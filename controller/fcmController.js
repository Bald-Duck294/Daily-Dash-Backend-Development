import prisma from '../config/prismaClient.mjs'

export const saveFCMToken = async (req, res) => {
    const { fcm_token, user_id } = req.body;
    const userId = user_id || req.user?.id;
    if (!userId) {
        return res.status(400).json({ error: "user_id is required" });
    }
    try {
        await prisma.users.update({
            where: { id: BigInt(userId) },
            data: { fcm_token }
        });
        res.json({ success: true });
    } catch (error) {
        console.error("Error saving FCM token:", error);
        res.status(500).json({ error: "Failed to save FCM token" });
    }
};

export const deleteFcmToken = async (req, res) => {
    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ error: false, message: 'user id not provided' });
    }

    try {
        const updatedUser = await prisma.users.update({
            where: {
                id: BigInt(userId)
            },
            data: {
                fcm_token: null
            }
        });
        console.log(updatedUser, "update user")
        res.status(200).json({
            error: false,
            message: 'Fcm token deleted sucessfully',
            deleteToken: {
                ...updatedUser,
                id: updatedUser?.id?.toString(),
                company_id: updatedUser?.company_id?.toString()
            }
        })
    }
    catch (error) {
        console.log('error from delete fcm token', error)
        res.status(500).json({
            error: true,
            message: 'unable to delete fcm token'
        })
    }
}