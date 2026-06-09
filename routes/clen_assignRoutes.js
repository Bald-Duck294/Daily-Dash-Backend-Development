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

import { verifyToken } from "../middlewares/authMiddleware.js";
const clen_assign_router = express.Router();

// CRUD routes
// ✅ Fixed routing structure
clen_assign_router.get("/", verifyToken, getAllAssignments); // Get all assignments
clen_assign_router.get("/cleaner/:id", getAssignmentById); // Get single assignment by ID
clen_assign_router.get("/:cleaner_user_id", getAssignmentByCleanerUserId); // Get by cleaner
clen_assign_router.post("/", createAssignment); // Create new assignment
clen_assign_router.post("/:id", updateAssignment); // Update assignment (use PUT)
clen_assign_router.delete("/:id", deleteAssignment);
clen_assign_router.post("/location/create", createAssignmentsForLocation); // Get all assignments
// Delete assignment
clen_assign_router.get("/location/:location_id", getAssignmentsByLocation);
clen_assign_router.get(
  "/cleaner-id/:cleaner_user_id",
  getAssignmentsByCleanerId,
);

// Delete

export default clen_assign_router;
