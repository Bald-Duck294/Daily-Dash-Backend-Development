import  prisma  from  '../config/prismaClient.mjs'

export const saveFCMToken = async (req, res) => {
    // const userId = req.user.id
    const { fcm_token ,user_id } = req.body;
    const userId = user_id; // Use user_id from request body
    console.log('fcm token client', fcm_token);
    try {
        await prisma.users.update({
            where: { id: userId },
            data: { fcm_token }
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Failed to save FCM token" });
    }
};
