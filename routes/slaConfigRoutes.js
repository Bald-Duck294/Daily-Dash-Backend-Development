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

const requireSuperAdminOrCompanyMember = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (Number(req.user.role_id) === 1) {
        return next();
    }
    const { company_id } = req.params;
    if (company_id && String(req.user.company_id) === String(company_id)) {
        return next();
    }
    return res.status(403).json({ success: false, message: "Forbidden: You do not have access to this SLA configuration" });
};

// Apply auth token middleware to all routes
router.use(verifyToken);

// Apply strict Super Admin requirement to most routes
router.post("/enable", requireSuperAdmin, enableSLA);
router.post("/disable", requireSuperAdmin, disableSLA);
router.get("/", requireSuperAdmin, getCompanySLAList);

// Washroom-level SLA routes (must be declared before parameterized :company_id)
router.get("/washroom/:location_id", getWashroomSLAConfiguration);
router.put("/washroom/:location_id", requireSuperAdmin, updateWashroomSLAConfiguration);

router.put("/:company_id", requireSuperAdmin, updateSLAConfiguration);

// Allow Super Admin OR Company Member to read SLA configuration
router.get("/:company_id", requireSuperAdminOrCompanyMember, getSLAConfiguration);

export default router;
