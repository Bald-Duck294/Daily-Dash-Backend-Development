import express from "express";
import { verifyToken } from "../middlewares/authMiddleware.js";
import {
    enableSLA,
    disableSLA,
    getSLAConfiguration,
    updateSLAConfiguration,
    getCompanySLAList
} from "../controller/slaConfigController.js";
import {
    getWashroomSLAConfiguration,
    updateWashroomSLAConfiguration
} from "../controller/washroomSlaController.js";

const router = express.Router();

// Middleware to ensure only Super Admin (role_id = 1) can access these routes
const requireSuperAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (Number(req.user.role_id) !== 1) {
        return res.status(403).json({ success: false, message: "Forbidden: Only Super Admin can access SLA settings" });
    }
    next();
};

// Middleware to ensure user is Superadmin OR has SLA update permission for their own company
const requireSlaUpdatePermission = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (Number(req.user.role_id) === 1) {
        return next();
    }
    const { company_id } = req.params;
    const hasUpdatePerm = req.user.permissions?.includes('sla_management.update') || req.user.permissions?.includes('sla_management.add');
    const isSameCompany = company_id && String(req.user.company_id) === String(company_id);

    if (hasUpdatePerm && isSameCompany) {
        return next();
    }
    return res.status(403).json({ success: false, message: "Forbidden: You do not have permission to update SLA settings for this company" });
};

// Middleware to ensure user is Superadmin OR has SLA view permission for their own company
const requireSlaViewPermission = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (Number(req.user.role_id) === 1) {
        return next();
    }
    const { company_id } = req.params;
    const hasViewPerm = req.user.permissions?.includes('sla_management.view');
    const isSameCompany = company_id && String(req.user.company_id) === String(company_id);

    if (hasViewPerm && isSameCompany) {
        return next();
    }
    return res.status(403).json({ success: false, message: "Forbidden: You do not have access to this SLA configuration" });
};

// Apply auth token middleware to all routes
router.use(verifyToken);

// Master Activation / Deactivation: Strictly reserved for Super Admin
router.post("/enable", requireSuperAdmin, enableSLA);
router.post("/disable", requireSuperAdmin, disableSLA);
router.get("/", requireSuperAdmin, getCompanySLAList);

// Washroom-level SLA routes (controller handles detailed location tenancy & permission)
router.get("/washroom/:location_id", getWashroomSLAConfiguration);
router.put("/washroom/:location_id", updateWashroomSLAConfiguration);

// Company-level SLA configuration
router.put("/:company_id", requireSlaUpdatePermission, updateSLAConfiguration);
router.get("/:company_id", requireSlaViewPermission, getSLAConfiguration);

export default router;
