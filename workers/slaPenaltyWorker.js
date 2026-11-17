import "dotenv/config";
import cron from "node-cron";
import dotenv from "dotenv";
import prisma from "../config/prismaClient.mjs";
import {
  evaluateReviewForSlaPenalty,
  evaluateDayWisePenaltiesForDate
} from "../services/slaPenaltyEvaluationService.js";

let isPenaltyProcessing = false;

/**
 * Core execution loop for processing SLA penalties via background cron worker.
 * Scans completed reviews for organizations with contractual SLA rules active,
 * evaluates each review against the active published rule book, and generates
 * penalties/violations in the financial ledger.
 *
 * @param {Object} options
 * @param {string|number|null} [options.companyId] - Optional company filter
 * @param {number} [options.lookbackHours=72] - Time window for scanning reviews
 * @param {number} [options.limit=100] - Max reviews per company per cycle
 */
export async function processSlaPenaltyCronCycle({ companyId = null, lookbackHours = 72, limit = 100 } = {}) {
  if (isPenaltyProcessing) {
    console.log("⏳ [SLA PENALTY CRON] Previous penalty cron run still in progress. Skipping this cycle.");
    return { success: false, skipped: true, message: "Previous cycle in progress" };
  }

  isPenaltyProcessing = true;
  const startTime = Date.now();
  console.log(`🚀 [SLA PENALTY CRON] Starting penalty evaluation cycle at ${new Date().toISOString()}...`);

  const stats = {
    companiesEvaluated: 0,
    reviewsScanned: 0,
    violationsCreated: 0,
    penaltiesCreated: 0,
    penaltiesReversed: 0,
    errors: []
  };

  try {
    // 1. Identify companies where contractual SLA rules ('sla_rules') are enabled
    const whereConfig = {
      name: "sla_rules",
      is_active: true
    };
    if (companyId) {
      whereConfig.company_id = BigInt(companyId);
    }

    const activeSlaConfigs = await prisma.configurations.findMany({
      where: whereConfig,
      select: { company_id: true }
    });

    const activeCompanyIds = activeSlaConfigs.map((c) => c.company_id).filter(Boolean);

    if (activeCompanyIds.length === 0) {
      console.log("ℹ️ [SLA PENALTY CRON] No organizations have active 'sla_rules' enabled. Cycle complete.");
      return { success: true, ...stats, durationMs: Date.now() - startTime };
    }

    const sinceDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

    for (const compId of activeCompanyIds) {
      try {
        // 2. Check if this company has an active published Rule Book
        const activeRuleBook = await prisma.sla_rule_books.findFirst({
          where: {
            company_id: compId,
            status: "PUBLISHED"
          },
          select: { id: true, version: true }
        });

        if (!activeRuleBook) {
          continue;
        }

        stats.companiesEvaluated++;

        // 3. Scan completed reviews for this company within lookback window
        let reviews = await prisma.cleaner_review.findMany({
          where: {
            company_id: compId,
            status: "completed",
            score: { not: null },
            created_at: { gte: sinceDate }
          },
          select: {
            id: true,
            score: true,
            location_id: true,
            cleaner_user_id: true,
            created_at: true
          },
          orderBy: { created_at: "asc" },
          take: limit
        });

        // If no reviews in current lookback window (e.g., demo / testing data), pick up recent completed reviews
        if (reviews.length === 0) {
          reviews = await prisma.cleaner_review.findMany({
            where: {
              company_id: compId,
              status: "completed",
              score: { not: null }
            },
            select: {
              id: true,
              score: true,
              location_id: true,
              cleaner_user_id: true,
              created_at: true
            },
            orderBy: { created_at: "desc" },
            take: 20
          });
          reviews.reverse();
        }

        stats.reviewsScanned += reviews.length;

        // 4. Evaluate each review through the SLA penalty engine
        for (const rev of reviews) {
          try {
            const evalResult = await evaluateReviewForSlaPenalty(rev.id);
            if (evalResult?.violations?.length) {
              stats.violationsCreated += evalResult.violations.length;
            }
            if (evalResult?.penalties?.length) {
              stats.penaltiesCreated += evalResult.penalties.length;
            }
          } catch (reviewErr) {
            stats.errors.push({ reviewId: rev.id.toString(), error: reviewErr.message });
          }
        }
      } catch (companyErr) {
        console.error(`❌ [SLA PENALTY CRON] Error processing company #${compId}:`, companyErr.message);
        stats.errors.push({ companyId: compId.toString(), error: companyErr.message });
      }
    }

    // Also run Day-Wise evaluation cycle for the target company/companies
    try {
      const dailyStats = await evaluateDayWisePenaltiesForDate({ companyId });
      stats.dailyPenaltiesCreated = dailyStats.penaltiesCreated || 0;
      stats.penaltiesCreated += stats.dailyPenaltiesCreated;
    } catch (dayErr) {
      console.error("❌ [SLA PENALTY CRON] Error running day-wise evaluation:", dayErr.message);
    }

    const durationMs = Date.now() - startTime;
    console.log(
      `✅ [SLA PENALTY CRON] Cycle finished in ${durationMs}ms | Companies: ${stats.companiesEvaluated} | Reviews: ${stats.reviewsScanned} | Penalties: ${stats.penaltiesCreated}`
    );

    return {
      success: true,
      ...stats,
      durationMs,
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    console.error("❌ [SLA PENALTY CRON FATAL ERROR]:", err);
    return {
      success: false,
      error: err.message,
      ...stats,
      durationMs: Date.now() - startTime
    };
  } finally {
    isPenaltyProcessing = false;
  }
}

/**
 * Initializes the node-cron scheduler for SLA penalties:
 * 1. Runs review scans every 60 seconds (* * * * *) for TASK_WISE rules.
 * 2. Runs end-of-day daily performance aggregation at 23:59 (59 23 * * *) for DAY_WISE rules.
 */
export function startSlaPenaltyWorker() {
  console.log("🚀 [SLA PENALTY WORKER] Penalty cron worker initialized (Task scan: every 60s | Day-Wise: daily at 23:59)");

  // 1. Task-wise review scanner
  const taskScanJob = cron.schedule("* * * * *", async () => {
    try {
      await processSlaPenaltyCronCycle();
    } catch (error) {
      console.error("❌ [SLA PENALTY WORKER] Uncaught error in task-wise cron iteration:", error);
    }
  });

  // 2. End-of-Day daily evaluation job
  const dailyJob = cron.schedule("59 23 * * *", async () => {
    try {
      console.log("🌙 [SLA PENALTY WORKER] Firing scheduled End-of-Day (23:59) penalty evaluation job...");
      await evaluateDayWisePenaltiesForDate();
    } catch (error) {
      console.error("❌ [SLA PENALTY WORKER] Uncaught error in end-of-day cron iteration:", error);
    }
  });

  return { taskScanJob, dailyJob };
}

/**
 * One-shot CLI runner for manual / external triggers.
 */
export async function runPenaltyCronOnce({ companyId = null } = {}) {
  dotenv.config();
  console.log("🏁 [SLA PENALTY WORKER] Starting one-shot SLA penalty evaluation cycle...");
  try {
    const result = await processSlaPenaltyCronCycle({ companyId });
    console.log("✅ [SLA PENALTY WORKER] Result:", JSON.stringify(result, null, 2));
    return result;
  } catch (err) {
    console.error("❌ [SLA PENALTY WORKER] Fatal error in one-shot run:", err);
    throw err;
  }
}

