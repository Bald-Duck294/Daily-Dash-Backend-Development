

import express from "express";
import {
  getCleanerReview,
  getCleanerReviewsById,
  createCleanerReview,
  completeCleanerReview,
  getCleanerReviewsByTaskId,
  getCleanerReviewsByLocationId,
  updateCleanerReviewScore,
  getCleanerReviews
} from "../controller/cleanerReviewController.js";
// import { upload, processAndUploadImages } from "../middleware/imageUpload.js";
import { upload, processAndUploadImages } from "../middlewares/imageUpload.js";
import { verifyToken } from "../middlewares/authMiddleware.js";
const clean_review_Router = express.Router();

// Debug middleware (optional)
const debugFields = (req, res, next) => {
  console.log("---- Incoming Form Data ----");
  console.log("Body:", req.body);
  console.log("Uploaded Files:", req.uploadedFiles);
  next();
};

// Routes
clean_review_Router.get("/",  getCleanerReview);
clean_review_Router.get("/paginated",  getCleanerReviews);
clean_review_Router.get("/:cleaner_user_id", getCleanerReviewsById);
clean_review_Router.get("/task/:task_id", getCleanerReviewsByTaskId);
clean_review_Router.get('/location/:location_id', getCleanerReviewsByLocationId);
clean_review_Router.patch('/:id/score', verifyToken, updateCleanerReviewScore);

// Start review (before photos)
clean_review_Router.post(
  "/initiated",
  upload.fields([{ name: "before_photo", maxCount: 5 }]),
  processAndUploadImages([
    { fieldName: "before_photo", folder: "before_photos", maxCount: 5 }
  ]),
  debugFields,
  createCleanerReview
);

// Complete review (after photos)
clean_review_Router.post(
  "/completed",
  upload.fields([{ name: "after_photo", maxCount: 5 }]),
  processAndUploadImages([
    { fieldName: "after_photo", folder: "after_photos", maxCount: 5 }
  ]),
  debugFields,
  completeCleanerReview
);

export default clean_review_Router;
