import prisma from '../config/prismaClient.mjs'

export const saveFCMToken = async (req, res) => {
    // const userId = req.user.id
    const { fcm_token, user_id } = req.body;
    const userId = user_id; // Use user_id from request body
    // console.log('fcm token client', fcm_token);
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


export const deleteFcmToken = async (req, res) => {

    const { userId } = req.body;
    // console.log(req.body, "body request")

    if (!userId) {
        return res.status(400).json({ error: false, message: 'user id not provided' });
    }

    try {
        const updatedUser = await prisma.users.update({
            where: {
                id: userId
            },
            data: {
                fcm_token: null
            }
        })
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