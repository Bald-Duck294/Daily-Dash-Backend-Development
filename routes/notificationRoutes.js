import { Router } from "express";
import {
  getUserNotifications,
  markNotificationAsRead,
  deleteNotification,
} from "../controller/notificationController.js";

const notificationRoutes = Router();

notificationRoutes.get("/", getUserNotifications);
notificationRoutes.patch("/:id/read", markNotificationAsRead);
notificationRoutes.delete("/:id", deleteNotification);

export default notificationRoutes;

