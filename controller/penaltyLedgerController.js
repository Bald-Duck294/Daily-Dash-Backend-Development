import {
  getPenalties,
  getPenaltySummary,
  getPenaltyById,
  approvePenalty,
  rejectPenalty,
  disputePenalty,
  reversePenalty,
  getViolations
} from "../services/penaltyLedgerService.js";
import { evaluateReviewForSlaPenalty } from "../services/slaPenaltyEvaluationService.js";
import { serializeBigInt } from "./slaRuleBookController.js";

const resolveCompanyId = (req) => {
  return req.body?.company_id || req.query?.company_id || req.user?.company_id;
};

export const getPenaltiesHandler = async (req, res) => {
  try {
    const company_id = resolveCompanyId(req);
    if (!company_id) {
      return res.status(400).json({ success: false, message: "company_id is required" });
    }

    const { status, cleaner_id, location_id, scope, start_date, end_date, page = 1, limit = 20 } = req.query;
    const result = await getPenalties(company_id, {
      status,
      cleaner_id,
      location_id,
      scope,
      start_date,
      end_date,
      page,
      limit,
      currentUser: req.user
    });

    return res.status(200).json({
      success: true,
      data: serializeBigInt(result.penalties),
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages
      }
    });
  } catch (error) {
    console.error("Error in getPenaltiesHandler:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getPenaltySummaryHandler = async (req, res) => {
  try {
    const company_id = resolveCompanyId(req);
    if (!company_id) {
      return res.status(400).json({ success: false, message: "company_id is required" });
    }

    const { start_date, end_date } = req.query;
    const summary = await getPenaltySummary(company_id, {
      start_date,
      end_date,
      currentUser: req.user
    });

    return res.status(200).json({
      success: true,
      data: serializeBigInt(summary)
    });
  } catch (error) {
    console.error("Error in getPenaltySummaryHandler:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getPenaltyByIdHandler = async (req, res) => {
  try {
    const company_id = resolveCompanyId(req);
    if (!company_id) {
      return res.status(400).json({ success: false, message: "company_id is required" });
    }

    const { id } = req.params;
    const penalty = await getPenaltyById(id, company_id);

    return res.status(200).json({
      success: true,
      data: serializeBigInt(penalty)
    });
  } catch (error) {
    console.error("Error in getPenaltyByIdHandler:", error);
    return res.status(404).json({ success: false, message: error.message });
  }
};

export const approvePenaltyHandler = async (req, res) => {
  try {
    const company_id = resolveCompanyId(req);
    if (!company_id) {
      return res.status(400).json({ success: false, message: "company_id is required" });
    }

    const { id } = req.params;
    const { approved_amount, comment } = req.body;
    const updated = await approvePenalty(id, company_id, req.user, { approved_amount, comment });

    return res.status(200).json({
      success: true,
      message: `Penalty #${updated.penalty_number} approved successfully`,
      data: serializeBigInt(updated)
    });
  } catch (error) {
    console.error("Error in approvePenaltyHandler:", error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const rejectPenaltyHandler = async (req, res) => {
  try {
    const company_id = resolveCompanyId(req);
    if (!company_id) {
      return res.status(400).json({ success: false, message: "company_id is required" });
    }

    const { id } = req.params;
    const { rejection_reason } = req.body;
    const updated = await rejectPenalty(id, company_id, req.user, { rejection_reason });

    return res.status(200).json({
      success: true,
      message: `Penalty #${updated.penalty_number} rejected`,
      data: serializeBigInt(updated)
    });
  } catch (error) {
    console.error("Error in rejectPenaltyHandler:", error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const disputePenaltyHandler = async (req, res) => {
  try {
    const company_id = resolveCompanyId(req);
    if (!company_id) {
      return res.status(400).json({ success: false, message: "company_id is required" });
    }

    const { id } = req.params;
    const { dispute_reason } = req.body;
    const updated = await disputePenalty(id, company_id, req.user, { dispute_reason });

    return res.status(200).json({
      success: true,
      message: `Dispute filed for Penalty #${updated.penalty_number}`,
      data: serializeBigInt(updated)
    });
  } catch (error) {
    console.error("Error in disputePenaltyHandler:", error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const reversePenaltyHandler = async (req, res) => {
  try {
    const company_id = resolveCompanyId(req);
    if (!company_id) {
      return res.status(400).json({ success: false, message: "company_id is required" });
    }

    const { id } = req.params;
    const { reversal_reason } = req.body;
    const updated = await reversePenalty(id, company_id, req.user, { reversal_reason });

    return res.status(200).json({
      success: true,
      message: `Penalty #${updated.penalty_number} reversed`,
      data: serializeBigInt(updated)
    });
  } catch (error) {
    console.error("Error in reversePenaltyHandler:", error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const getViolationsHandler = async (req, res) => {
  try {
    const company_id = resolveCompanyId(req);
    if (!company_id) {
      return res.status(400).json({ success: false, message: "company_id is required" });
    }

    const { cleaner_id, location_id, page = 1, limit = 20 } = req.query;
    const result = await getViolations(company_id, {
      cleaner_id,
      location_id,
      page,
      limit,
      currentUser: req.user
    });

    return res.status(200).json({
      success: true,
      data: serializeBigInt(result.violations),
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages
      }
    });
  } catch (error) {
    console.error("Error in getViolationsHandler:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const evaluateReviewHandler = async (req, res) => {
  try {
    const { reviewId } = req.params;
    const result = await evaluateReviewForSlaPenalty(reviewId);

    return res.status(200).json({
      success: true,
      message: "SLA Penalty evaluation triggered",
      data: serializeBigInt(result)
    });
  } catch (error) {
    console.error("Error in evaluateReviewHandler:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

