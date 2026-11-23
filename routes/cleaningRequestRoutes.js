import express from "express";
import { verifyToken } from "../middlewares/authMiddleware.js";
import {
  createCleaningRequest,
  getCleaningRequests,
  getToiletCleaners,
  assignCleaningTask,
  updateCleaningRequestStatus,
  getCleaningRequestStats,
} from "../controller/cleaningRequestController.js";

const router = express.Router();

// Allow public POST for citizen app submission; protect dashboard/management operations with token
router.post("/", createCleaningRequest);

// Protected routes (dashboard & supervisor operations)
router.get("/", verifyToken, getCleaningRequests);
router.get("/cleaners", verifyToken, getToiletCleaners);
router.post("/assign", verifyToken, assignCleaningTask);
router.put("/:id/status", verifyToken, updateCleaningRequestStatus);
router.get("/stats", verifyToken, getCleaningRequestStats);

export default router;
