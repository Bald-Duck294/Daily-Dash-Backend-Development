import express from "express";
import { verifyToken } from "../middlewares/authMiddleware.js";
import {
  getAllCompaniesFeatures,
  getCompanyFeatures,
  toggleCompanyFeature,
} from "../controller/featureManagementController.js";

const router = express.Router();

// Apply auth middleware to all feature-management routes
router.use(verifyToken);

router.get("/companies", getAllCompaniesFeatures);
router.get("/company/:companyId", getCompanyFeatures);
router.get("/company", getCompanyFeatures);
router.post("/toggle", toggleCompanyFeature);

export default router;
