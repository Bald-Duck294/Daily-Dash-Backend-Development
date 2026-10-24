import { Router } from "express";
import { deleteFcmToken, saveFCMToken, sendTestPushToCompanyUsers } from "../controller/fcmController.js";

const fcmRoutes = Router();

fcmRoutes.post('/save-fcm-token', saveFCMToken);
fcmRoutes.delete('/delete-fcm-token', deleteFcmToken);

// Test API: Dispatches high-priority push notification to all users of a company (default: 111)
fcmRoutes.post('/test-push', sendTestPushToCompanyUsers);
fcmRoutes.get('/test-push', sendTestPushToCompanyUsers);

export default fcmRoutes;