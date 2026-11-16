import prisma from "../config/prismaClient.mjs";
import { evaluateConditionAst } from "./slaRuleConditionValidator.js";
import { calculatePenalty } from "./penaltyCalculationEngine.js";
import { dispatchSlaPenaltyBreachAlerts } from "./slaPenaltyNotificationService.js";

/**
 * Generate human-readable unique penalty number (e.g. PEN-202611-00123)
 */
const generatePenaltyNumber = async () => {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const countToday = await prisma.cleaner_penalties.count();
  const sequence = String(countToday + 1).padStart(5, '0');
  return `PEN-${yearMonth}-${sequence}`;
};

/**
 * Core evaluation pipeline: detects breaches, logs violations, and writes financial ledger penalties.
 */
export const evaluateReviewForSlaPenalty = async (reviewId) => {
  if (!reviewId) return { evaluated: false, message: "Missing reviewId" };

  try {
    const review = await prisma.cleaner_review.findUnique({
      where: { id: BigInt(reviewId) },
      include: {
        cleaner_user: true,
        location: true,
        company: true
      }
    });

    if (!review) {
      console.warn(`[SLA Penalty] Review #${reviewId} not found`);
      return { evaluated: false, message: "Review not found" };
    }

    if (!review.company_id || !review.cleaner_user_id || !review.location_id) {
      return { evaluated: false, message: "Incomplete review metadata for SLA evaluation" };
    }

    if (review.score === null || review.score === undefined) {
      return { evaluated: false, message: "Review not scored yet" };
    }

    const companyId = review.company_id;
    const cleanerUserId = review.cleaner_user_id;
    const locationId = review.location_id;
    const reviewScore = Number(review.score);
    const attemptNo = Number(review.attempt_no || 1);
    const reviewType = review.review_type || "ORIGINAL";

    // 0. Verify if SLA Rules feature is enabled for this organization in configurations table
    const slaRulesConfig = await prisma.configurations.findFirst({
      where: {
        name: "sla_rules",
        company_id: companyId,
        is_active: true
      }
    });

    if (!slaRulesConfig) {
      // Feature flag is OFF for this company
      return { evaluated: false, message: "SLA Rules module is not enabled for this organization" };
    }

    // 1. Fetch active PUBLISHED rule book for this company
    const activeRuleBook = await prisma.sla_rule_books.findFirst({
      where: {
        company_id: companyId,
        status: "PUBLISHED"
      },
      orderBy: { version: 'desc' },
      include: {
        rules: {
          where: { is_active: true }
        }
      }
    });

    if (!activeRuleBook || !activeRuleBook.rules || activeRuleBook.rules.length === 0) {
      // Mark review as evaluated so we don't re-poll indefinitely
      await prisma.cleaner_review.update({
        where: { id: review.id },
        data: { sla_evaluated: true }
      });
      return { evaluated: false, message: "No active published rule book found for company" };
    }

    // 2. Handle Retry Auto-Waive Workflow (AUTO_WAIVE_ON_RETRY_PASS)
    // If this is a retry attempt (attempt_no >= 2) and score is passing (>= 7.0)
    if (attemptNo >= 2 && reviewScore >= 7.0) {
      // Find prior violations on parent review or earlier attempts for this location today
      const earlierViolations = await prisma.sla_violations.findMany({
        where: {
          company_id: companyId,
          cleaner_user_id: cleanerUserId,
          location_id: locationId,
          evaluation_status: { in: ["DETECTED", "QUALIFIED_FOR_PENALTY"] },
          rule: {
            retry_resolution_policy: "AUTO_WAIVE_ON_RETRY_PASS"
          }
        },
        include: {
          penalties: true
        }
      });

      for (const viol of earlierViolations) {
        // Mark violation as waived
        await prisma.sla_violations.update({
          where: { id: viol.id },
          data: { evaluation_status: "WAIVED_BY_RETRY" }
        });

        // Reverse associated pending penalties
        for (const pen of viol.penalties) {
          if (["PENDING", "UNDER_REVIEW"].includes(pen.status)) {
            await prisma.cleaner_penalties.update({
              where: { id: pen.id },
              data: {
                status: "REVERSED",
                reversal_reason: `Automatically waived by successful retry attempt #${attemptNo} scoring ${reviewScore.toFixed(1)}/10`
              }
            });

            await prisma.cleaner_penalty_logs.create({
              data: {
                penalty_id: pen.id,
                actor_user_id: null,
                action: "REVERSED_BY_RETRY",
                previous_status: pen.status,
                new_status: "REVERSED",
                previous_amount: pen.calculated_amount,
                new_amount: 0,
                comment: `Waived via passing corrective cleaning retry #${attemptNo}`
              }
            });
          }
        }
      }
    }

    // 3. Compute Day Aggregate Stats for Cleaner
    const businessDate = new Date();
    businessDate.setHours(0, 0, 0, 0);

    const dailyFailedReviews = await prisma.cleaner_review.findMany({
      where: {
        cleaner_user_id: cleanerUserId,
        created_at: { gte: businessDate },
        score: { lt: 6.0 }
      },
      select: { location_id: true }
    });

    const dailyFailedCount = dailyFailedReviews.length;
    const dailyLocationsCount = new Set(dailyFailedReviews.map(r => r.location_id?.toString())).size;

    // 4. Build Sanitized Context Object
    const context = {
      review: {
        id: review.id.toString(),
        score: reviewScore,
        attempt_no: attemptNo,
        review_type: reviewType,
        tasks_count: Array.isArray(review.tasks) ? review.tasks.length : 0
      },
      location: {
        id: locationId.toString(),
        type_id: review.location?.type_id ? review.location.type_id.toString() : null
      },
      day_aggregate: {
        failed_review_count: dailyFailedCount,
        distinct_locations_breached: dailyLocationsCount
      }
    };

    const businessDateStr = businessDate.toISOString().slice(0, 10);
    const createdPenalties = [];
    const detectedViolations = [];

    // 5. Evaluate Active Rules
    for (const rule of activeRuleBook.rules) {
      const isMatch = evaluateConditionAst(rule.condition_config, context);

      if (isMatch) {
        // Build Deduplication Key
        const deduplicationKey = rule.scope === "TASK_WISE"
          ? `PEN:${companyId}:${cleanerUserId}:${review.id}:${rule.rule_code}`
          : `PEN:${companyId}:${cleanerUserId}:${businessDateStr}:${rule.rule_code}`;

        // Idempotency check: verify if penalty already exists
        const existingPenalty = await prisma.cleaner_penalties.findUnique({
          where: { deduplication_key: deduplicationKey }
        });

        if (existingPenalty) {
          // Skip duplicate to ensure financial integrity
          continue;
        }

        // 6. Record Violation in sla_violations
        const violation = await prisma.sla_violations.create({
          data: {
            company_id: companyId,
            cleaner_user_id: cleanerUserId,
            location_id: locationId,
            review_id: review.id,
            rule_id: rule.id,
            rule_version: activeRuleBook.version,
            violation_category: rule.violation_category,
            violation_type: rule.violation_type || rule.violation_category,
            occurrence_time: review.created_at || new Date(),
            business_date: businessDate,
            score: reviewScore,
            threshold: null,
            evidence_references: Array.isArray(review.after_photo) ? review.after_photo : [],
            evaluation_status: "QUALIFIED_FOR_PENALTY",
            details: {
              context,
              matched_rule: {
                id: rule.id.toString(),
                code: rule.rule_code,
                name: rule.name
              }
            }
          }
        });
        detectedViolations.push(violation);

        // 7. Calculate Financial Penalty (Decimal Math)
        const { calculated_amount, base_task_value, calculation_snapshot } = calculatePenalty(
          rule,
          context,
          activeRuleBook.rate_cards || {}
        );

        // 8. Resolve Approver & Initial Stage from approval_policy
        let designatedRole = "SUPERVISOR";
        const approvalPolicy = activeRuleBook.approval_policy;
        if (approvalPolicy && Array.isArray(approvalPolicy.tiers)) {
          for (const tier of approvalPolicy.tiers) {
            if (tier.max_limit === null || calculated_amount <= Number(tier.max_limit)) {
              designatedRole = tier.role || "SUPERVISOR";
              break;
            }
          }
        }

        // Find assigned supervisor for this cleaner
        const assignment = await prisma.cleaner_assignments.findFirst({
          where: {
            cleaner_user_id: cleanerUserId,
            location_id: locationId
          },
          select: { supervisor_id: true }
        });

        const assignedApproverId = assignment?.supervisor_id || null;
        const penaltyNumber = await generatePenaltyNumber();

        // 9. Write Financial Ledger Item in cleaner_penalties
        const penalty = await prisma.cleaner_penalties.create({
          data: {
            penalty_number: penaltyNumber,
            deduplication_key: deduplicationKey,
            company_id: companyId,
            cleaner_user_id: cleanerUserId,
            violation_id: violation.id,
            rule_id: rule.id,
            rule_version: activeRuleBook.version,
            scope: rule.scope,
            business_date: businessDate,
            location_id: locationId,
            review_id: review.id,
            calculation_method: rule.calculation_method,
            base_task_value: base_task_value !== null ? base_task_value : null,
            calculated_amount: calculated_amount,
            approved_amount: calculated_amount,
            calculation_snapshot: calculation_snapshot,
            current_approval_tier: 1,
            designated_role_name: designatedRole,
            assigned_approver_id: assignedApproverId,
            approval_stage: "PENDING_STAGE_1",
            status: "PENDING"
          }
        });

        // 10. Append Audit Log in cleaner_penalty_logs
        await prisma.cleaner_penalty_logs.create({
          data: {
            penalty_id: penalty.id,
            actor_user_id: null,
            action: "CREATED",
            previous_status: null,
            new_status: "PENDING",
            previous_amount: null,
            new_amount: calculated_amount,
            comment: `Automated SLA deduction generated by rule [${rule.rule_code}] for score ${reviewScore.toFixed(1)}/10`,
            metadata: {
              rule_code: rule.rule_code,
              calculation_snapshot
            }
          }
        });

        createdPenalties.push(penalty);

        // 11. Dispatch notifications & activity logs to respective roles (Admin, Supervisor, Cleaner)
        dispatchSlaPenaltyBreachAlerts({
          penalty,
          rule,
          violation,
          review,
          cleanerUser: review.cleaner_user,
          location: review.location,
          companyId
        }).catch((alertErr) =>
          console.error("Error dispatching SLA penalty breach alerts:", alertErr)
        );
      }
    }

    // Mark review evaluated
    await prisma.cleaner_review.update({
      where: { id: review.id },
      data: { sla_evaluated: true }
    });

    return {
      evaluated: true,
      review_id: review.id.toString(),
      violations_count: detectedViolations.length,
      penalties_count: createdPenalties.length,
      penalties: createdPenalties.map(p => ({
        id: p.id.toString(),
        penalty_number: p.penalty_number,
        amount: Number(p.calculated_amount)
      }))
    };
  } catch (err) {
    console.error(`[SLA Penalty] Evaluation error on review #${reviewId}:`, err);
    throw err;
  }
};

