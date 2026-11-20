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
import {
  getPenaltiesHandler,
  getPenaltySummaryHandler,
  getPenaltyByIdHandler,
  approvePenaltyHandler,
  rejectPenaltyHandler,
  disputePenaltyHandler,
  reversePenaltyHandler,
  getViolationsHandler,
  evaluateReviewHandler,
  triggerPenaltyCronHandler
} from "../controller/penaltyLedgerController.js";
import {
  getAllCompaniesSlaRulesStatus,
  getCompanySlaRulesStatus,
  toggleCompanySlaRules
} from "../controller/slaRulesConfigController.js";

const router = express.Router();

// Enforce authentication on all SLA penalty routes
router.use(verifyToken);

// Company SLA Rules Feature Toggle (Super Admin & Tenancy Check)
router.get("/company-status", getAllCompaniesSlaRulesStatus);
router.get("/company-status/:companyId", getCompanySlaRulesStatus);
router.post("/toggle-status", toggleCompanySlaRules);

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

// Penalty Ledger & Violations (Phase 2)
router.get("/penalties", getPenaltiesHandler);
router.get("/penalties/summary", getPenaltySummaryHandler);
router.get("/penalties/:id", getPenaltyByIdHandler);
router.post("/penalties/:id/approve", approvePenaltyHandler);
router.post("/penalties/:id/reject", rejectPenaltyHandler);
router.post("/penalties/:id/dispute", disputePenaltyHandler);
router.post("/penalties/:id/reverse", reversePenaltyHandler);
router.get("/violations", getViolationsHandler);
router.post("/evaluate/:reviewId", evaluateReviewHandler);
router.post("/cron/trigger", triggerPenaltyCronHandler);

export default router;

