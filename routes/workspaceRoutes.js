import express from "express";
import { deployWorkspace } from "../controller/workspaceController.js";
import { verifyToken } from "../middlewares/authMiddleware.js";

const workspaceRouter = express.Router();

// Ensure the deployment is protected and the user is authenticated
workspaceRouter.post("/deploy", verifyToken, deployWorkspace);

export default workspaceRouter;
