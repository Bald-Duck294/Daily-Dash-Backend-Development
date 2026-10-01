import express from "express";
import { verifyToken } from "../middlewares/authMiddleware.js";
import {
    getSlaLogs,
    getSlaIncidents,
    getSlaIncidentById
} from "../controller/slaLogsController.js";

const router = express.Router();

// Protected: All authenticated admins and superadmins
router.use(verifyToken);

// GET /api/sla-logs/incidents - Primary Incident List view
router.get("/incidents", getSlaIncidents);

// GET /api/sla-logs/incidents/:id - Incident Detail / Journey Drawer
router.get("/incidents/:id", getSlaIncidentById);

// GET /api/sla-logs - Raw Audit Stream view
router.get("/", getSlaLogs);

export default router;
