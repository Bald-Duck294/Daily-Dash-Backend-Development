import express from "express";
import { setLimit, getLimits } from "../controller/systemLimitsController.js";
import { verifyToken } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Add your role checking middleware here (e.g. only SuperAdmin role_id === 1 can access)
router.post("/set", verifyToken, setLimit);
router.get("/", verifyToken, getLimits);

export default router;
