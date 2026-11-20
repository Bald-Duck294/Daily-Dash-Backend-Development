import express from "express";
import { verifyToken } from "../middlewares/authMiddleware.js";
import {
  getCleanerReviewsForManagement,
  deleteCleanerReviews,
  getUserReviewsForManagement,
  deleteUserReviews,
} from "../controller/reviewManagementController.js";

const router = express.Router();

// Cleaner Reviews Management Routes
router.get("/cleaner-reviews", verifyToken, getCleanerReviewsForManagement);
router.delete("/cleaner-reviews", verifyToken, deleteCleanerReviews);

// User Reviews Management Routes
router.get("/user-reviews", verifyToken, getUserReviewsForManagement);
router.delete("/user-reviews", verifyToken, deleteUserReviews);

export default router;
