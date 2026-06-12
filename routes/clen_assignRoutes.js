import express from "express";

import {
  getAllAssignments,
  getAssignmentsByLocation,
  getAssignmentByCleanerUserId,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  getAssignmentById,
  createAssignmentsForLocation,
  getAssignmentsByCleanerId,
} from "../controller/clenAssignController.js";

// Import your authentication and RBAC middlewares
import { verifyToken } from "../middlewares/authMiddleware.js";
import { requireLocationAccess } from "../middlewares/requireLocationAccess.js";

const clen_assign_router = express.Router();

// Apply token verification globally to all assignment routes for security
clen_assign_router.use(verifyToken);

// --- 1. Global / List Routes ---
// Gets all assignments (populates req.authorizedLocationIds via middleware)
clen_assign_router.get("/", requireLocationAccess, getAllAssignments); 

// --- 2. Location Scoped Routes ---
// SECURED: Automatically checks if the logged-in user owns this :location_id
clen_assign_router.get("/location/:location_id", requireLocationAccess, getAssignmentsByLocation);

// --- 3. Management & Creation Routes ---
clen_assign_router.post("/", createAssignment); 
clen_assign_router.post("/location/create", createAssignmentsForLocation); 
clen_assign_router.post("/:id", updateAssignment); 
clen_assign_router.delete("/:id", deleteAssignment);

// --- 4. User Scoped Routes ---
clen_assign_router.get("/cleaner/:id", getAssignmentById); 
clen_assign_router.get("/:cleaner_user_id", getAssignmentByCleanerUserId); 
clen_assign_router.get("/cleaner-id/:cleaner_user_id", getAssignmentsByCleanerId);

export default clen_assign_router;