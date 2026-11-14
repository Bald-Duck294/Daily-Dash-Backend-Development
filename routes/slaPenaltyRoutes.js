import express from "express";
import { verifyToken } from "../middlewares/authMiddleware.js";
import {
  createRuleBookHandler,
  getRuleBooksHandler,
  getActiveRuleBookHandler,
  getRuleBookByIdHandler,
  updateRuleBookHandler,
  publishRuleBookHandler,
  addRuleHandler,
  updateRuleHandler,
  deleteRuleHandler,
  seedDefaultRuleBookHandler,
  previewRuleHandler
} from "../controller/slaRuleBookController.js";

const router = express.Router();

// Enforce authentication on all SLA penalty routes
router.use(verifyToken);

// Rule Books management
router.post("/rule-books", createRuleBookHandler);
router.get("/rule-books", getRuleBooksHandler);
router.get("/rule-books/active", getActiveRuleBookHandler);
router.post("/rule-books/seed", seedDefaultRuleBookHandler);
router.get("/rule-books/:id", getRuleBookByIdHandler);
router.put("/rule-books/:id", updateRuleBookHandler);
router.post("/rule-books/:id/publish", publishRuleBookHandler);
router.post("/rule-books/:id/rules", addRuleHandler);

// Rule item individual operations
router.put("/rules/:ruleId", updateRuleHandler);
router.delete("/rules/:ruleId", deleteRuleHandler);
router.post("/rules/preview", previewRuleHandler);

export default router;

