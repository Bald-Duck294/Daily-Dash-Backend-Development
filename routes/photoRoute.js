import express from "express";
// Adjust this path if you saved the controller under a different name
import { getCleanerReviewPhotos } from "../controller/photoController.js"; 
import { verifyToken } from "../middlewares/authMiddleware.js";

const getPhotoRoutes = express.Router();

// Using POST because the frontend will send complex filters in the request body
getPhotoRoutes.get("/", verifyToken, getCleanerReviewPhotos);

export default getPhotoRoutes;