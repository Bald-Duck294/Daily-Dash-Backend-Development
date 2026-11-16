import express from "express";
import { processDueSlaEscalations } from "../workers/slaEscalationWorker.js";
import { processSlaPenaltyCronCycle } from "../workers/slaPenaltyWorker.js";

const router = express.Router();

/**
 * Middleware to verify cron secret token.
 * Accepts key via:
 * 1. Header: 'x-cron-key'
 * 2. Header: 'Authorization: Bearer <token>'
 * 3. Query param: '?key=<token>'
 */

function verifyCronSecret(req, res, next) {
  const configuredSecret =
    process.env.CRON_SECRET || "safai-sla-cron-secret-2026";

  const tokenFromHeader = req.headers["x-cron-key"];
  const tokenFromBearer = req.headers["authorization"]?.startsWith("Bearer ")
    ? req.headers["authorization"].split(" ")[1]
    : null;
  const tokenFromQuery = req.query.key;

  const providedToken = tokenFromHeader || tokenFromBearer || tokenFromQuery;

  if (!providedToken || providedToken !== configuredSecret) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized. Invalid or missing cron secret key.",
    });
  }

  next();
}

/**
 * Handler function for executing the SLA escalation worker.
 */
async function handleSlaCronTrigger(req, res) {
  console.log(
    "🌐 [SLA CRON API] External trigger received from cron-job.org / scheduler",
  );
  try {
    const startTime = Date.now();
    const result = await processDueSlaEscalations();
    const durationMs = Date.now() - startTime;

    return res.status(200).json({
      success: true,
      message: "SLA escalation cycle executed successfully.",
      durationMs,
      timestamp: new Date().toISOString(),
      result,
    });
  } catch (error) {
    console.error("❌ [SLA CRON API ERROR]:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to execute SLA escalation cycle.",
    });
  }
}

// Support both GET and POST for cron-job.org and webhook callers
router.get("/trigger", verifyCronSecret, handleSlaCronTrigger);
router.post("/trigger", verifyCronSecret, handleSlaCronTrigger);

/**
 * Handler function for executing the SLA penalty worker cycle.
 */
async function handlePenaltyCronTrigger(req, res) {
  console.log("🌐 [SLA PENALTY CRON API] External trigger received");
  try {
    const startTime = Date.now();
    const result = await processSlaPenaltyCronCycle({
      companyId: req.query.company_id || req.body?.company_id || null
    });
    const durationMs = Date.now() - startTime;

    return res.status(200).json({
      success: true,
      message: "SLA penalty cron cycle executed successfully.",
      durationMs,
      timestamp: new Date().toISOString(),
      result,
    });
  } catch (error) {
    console.error("❌ [SLA PENALTY CRON API ERROR]:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to execute SLA penalty cycle.",
    });
  }
}

router.get("/trigger-penalties", verifyCronSecret, handlePenaltyCronTrigger);
router.post("/trigger-penalties", verifyCronSecret, handlePenaltyCronTrigger);

export default router;
