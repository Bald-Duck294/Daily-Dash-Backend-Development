import express from "express";
// Adjust this path if you saved the controller under a different name
import { getCleanerReviewPhotos, downloadPhoto } from "../controller/photoController.js"; 
import { verifyToken } from "../middlewares/authMiddleware.js";

const getPhotoRoutes = express.Router();

getPhotoRoutes.get("/", verifyToken, getCleanerReviewPhotos);
getPhotoRoutes.get("/download", verifyToken, downloadPhoto);

export default getPhotoRoutes;