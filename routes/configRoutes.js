import express from "express";
import {
  getAllConfigurations,
  getConfigurationById,
  getConfigurationByName,
  updateConfiguration,
  deleteConfiguration,
  toggleConfigurationStatus,
  duplicateConfiguration,
  // --- New Dynamic Configuration System Handlers ---
  getDynamicModules,
  getConfigByRouteName,
  updateConfigByRouteName,
  getLocationSchema,
} from "../controller/configController.js";

const router = express.Router();

// 1. Dynamic Framework Discovery Route
router.get("/modules", getDynamicModules);

// 2. Automated Construction Schema for Client Context
router.get("/location-schema", getLocationSchema);

// 3. Tenancy-Aware Lookup Route by Name Specifier
router.get("/name/:name", getConfigByRouteName);

// 4. Overwrite Update Route by Name Specifier
router.put("/name/:name", updateConfigByRouteName);

// Fallback/Legacy CRUD Mappings
router.get("/", getAllConfigurations);
router.get("/id/:id", getConfigurationById);
router.patch("/:id", updateConfiguration);
router.delete("/:id", deleteConfiguration);
router.patch("/:id/toggle-status", toggleConfigurationStatus);
router.post("/:id/duplicate", duplicateConfiguration);

export default router;
