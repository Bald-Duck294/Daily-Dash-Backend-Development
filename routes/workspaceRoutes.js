import express from "express";
import { deployWorkspace , getWorkspaceStatus , resetWorkspace} from "../controller/workspaceController.js";
import { verifyToken } from "../middlewares/authMiddleware.js";

const workspaceRouter = express.Router();

// Ensure the deployment is protected and the user is authenticated
workspaceRouter.post("/deploy", verifyToken, deployWorkspace);
// Phase 1 Backend Routes
workspaceRouter.get("/status", verifyToken, getWorkspaceStatus);
workspaceRouter.post("/reset", verifyToken, resetWorkspace);
export default workspaceRouter;

