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
    // If cleaner submits another review or retry for this location scoring >= 7.0, resolve earlier breaches
    if (reviewScore >= 7.0) {
      // Find prior violations on earlier reviews for this location today that qualify for auto-waive
      const earlierViolations = await prisma.sla_violations.findMany({
        where: {
          company_id: companyId,
          cleaner_user_id: cleanerUserId,
          location_id: locationId,
          review_id: { not: review.id },
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
        // Mark violation as waived by passing re-cleaning
        await prisma.sla_violations.update({
          where: { id: viol.id },
          data: { evaluation_status: "WAIVED_BY_RETRY" }
        });

        // Reverse associated pending penalties
        for (const pen of viol.penalties) {
          if (["PENDING", "UNDER_REVIEW", "PENDING_APPROVAL"].includes(pen.status)) {
            await prisma.cleaner_penalties.update({
              where: { id: pen.id },
              data: {
                status: "REVERSED",
                reversal_reason: `Automatically waived by subsequent passing review #${review.id} (Attempt ${attemptNo}) scoring ${reviewScore.toFixed(1)}/10`
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
                comment: `Waived via passing corrective cleaning review #${review.id} scoring ${reviewScore.toFixed(1)}/10`
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

    // 5. Evaluate Active Rules (Filtered strictly for TASK_WISE scope)
    const taskWiseRules = (activeRuleBook.rules || []).filter(
      (rule) => (rule.scope || "TASK_WISE") === "TASK_WISE"
    );

    for (const rule of taskWiseRules) {
      const isMatch = evaluateConditionAst(rule.condition_config, context);

      if (isMatch) {
        // Build Deduplication Key for Task-Wise Scope
        const deduplicationKey = `PEN:${companyId}:${cleanerUserId}:${review.id}:${rule.rule_code}`;

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

        // Find assigned supervisor for this location using location in cleaner_assignments table
        const supervisorAssignment = await prisma.cleaner_assignments.findFirst({
          where: {
            location_id: locationId,
            OR: [
              { role_id: { in: [3, 7] } },
              { cleaner_user: { role_id: { in: [3, 7] } } }
            ],
            deleted_at: null
          },
          select: { cleaner_user_id: true }
        });

        const assignedApproverId = supervisorAssignment?.cleaner_user_id || null;
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

/**
 * End-of-Day SLA Penalty Evaluation Pipeline:
 * Evaluates all active published rules where scope === "DAY_WISE"
 * against the aggregated performance of each cleaner across the entire calendar day.
 *
 * @param {Object} options
 * @param {string|number|null} [options.companyId] - Filter to specific organization
 * @param {Date|string} [options.businessDate] - Target date for evaluation (defaults to today)
 */
export const evaluateDayWisePenaltiesForDate = async ({ companyId = null, businessDate = new Date() } = {}) => {
  const targetDate = new Date(businessDate);
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);
  const businessDateStr = startOfDay.toISOString().slice(0, 10);

  console.log(`🌙 [SLA DAY-WISE EVALUATION] Starting for business date: ${businessDateStr}...`);

  const stats = {
    businessDate: businessDateStr,
    companiesEvaluated: 0,
    cleanersEvaluated: 0,
    violationsCreated: 0,
    penaltiesCreated: 0,
    errors: []
  };

  try {
    const whereConfig = {
      name: "sla_rules",
      is_active: true
    };
    if (companyId) {
      whereConfig.company_id = BigInt(companyId);
    }

    const activeConfigs = await prisma.configurations.findMany({
      where: whereConfig,
      select: { company_id: true }
    });

    const activeCompanyIds = activeConfigs.map((c) => c.company_id).filter(Boolean);

    for (const compId of activeCompanyIds) {
      try {
        const activeRuleBook = await prisma.sla_rule_books.findFirst({
          where: {
            company_id: compId,
            status: "PUBLISHED"
          },
          orderBy: { version: "desc" },
          include: {
            rules: {
              where: { is_active: true }
            }
          }
        });

        if (!activeRuleBook || !activeRuleBook.rules) continue;

        const dayWiseRules = activeRuleBook.rules.filter(
          (r) => r.scope === "DAY_WISE"
        );

        if (dayWiseRules.length === 0) continue;

        stats.companiesEvaluated++;

        // Fetch all completed reviews for this company on this business date
        const dayReviews = await prisma.cleaner_review.findMany({
          where: {
            company_id: compId,
            status: "completed",
            score: { not: null },
            created_at: { gte: startOfDay, lte: endOfDay }
          },
          include: {
            cleaner_user: true,
            location: true
          },
          orderBy: { created_at: "asc" }
        });

        if (dayReviews.length === 0) continue;

        // Group reviews by cleaner_user_id
        const cleanerReviewMap = new Map();
        dayReviews.forEach((rev) => {
          if (!rev.cleaner_user_id) return;
          const cId = rev.cleaner_user_id.toString();
          if (!cleanerReviewMap.has(cId)) {
            cleanerReviewMap.set(cId, []);
          }
          cleanerReviewMap.get(cId).push(rev);
        });

        for (const [cleanerUserIdStr, reviewsList] of cleanerReviewMap.entries()) {
          try {
            stats.cleanersEvaluated++;
            const cleanerUserId = BigInt(cleanerUserIdStr);
            const cleanerUser = reviewsList[0]?.cleaner_user;
            const totalReviews = reviewsList.length;
            const failedReviews = reviewsList.filter((r) => Number(r.score) < 6.0);
            const failedCount = failedReviews.length;
            const distinctLocationsCount = new Set(
              failedReviews.map((r) => r.location_id?.toString()).filter(Boolean)
            ).size;
            const avgScore =
              totalReviews > 0
                ? reviewsList.reduce((acc, r) => acc + Number(r.score || 0), 0) / totalReviews
                : 0;

            const primaryLocation = reviewsList[reviewsList.length - 1]?.location || reviewsList[0]?.location;
            const primaryLocationId = primaryLocation?.id || null;

            const context = {
              review: {
                id: null,
                score: Number(avgScore.toFixed(2)),
                attempt_no: 1,
                review_type: "DAY_WISE_AGGREGATE",
                tasks_count: totalReviews
              },
              location: {
                id: primaryLocationId ? primaryLocationId.toString() : null,
                type_id: primaryLocation?.type_id ? primaryLocation.type_id.toString() : null
              },
              day_aggregate: {
                failed_review_count: failedCount,
                distinct_locations_breached: distinctLocationsCount,
                total_reviews: totalReviews,
                average_score: Number(avgScore.toFixed(2))
              }
            };

            for (const rule of dayWiseRules) {
              const isMatch = evaluateConditionAst(rule.condition_config, context);

              if (isMatch) {
                const deduplicationKey = `PEN:${compId}:${cleanerUserId}:${businessDateStr}:${rule.rule_code}`;

                const existingPenalty = await prisma.cleaner_penalties.findUnique({
                  where: { deduplication_key: deduplicationKey }
                });

                if (existingPenalty) continue;

                // Create Violation
                const violation = await prisma.sla_violations.create({
                  data: {
                    company_id: compId,
                    cleaner_user_id: cleanerUserId,
                    location_id: primaryLocationId,
                    review_id: null,
                    rule_id: rule.id,
                    rule_version: activeRuleBook.version,
                    violation_category: rule.violation_category,
                    violation_type: rule.violation_type || rule.violation_category,
                    occurrence_time: endOfDay,
                    business_date: startOfDay,
                    score: Number(avgScore.toFixed(2)),
                    threshold: null,
                    evidence_references: [],
                    evaluation_status: "QUALIFIED_FOR_PENALTY",
                    details: {
                      context,
                      scope: "DAY_WISE",
                      matched_rule: {
                        id: rule.id.toString(),
                        code: rule.rule_code,
                        name: rule.name
                      }
                    }
                  }
                });
                stats.violationsCreated++;

                // Calculate Financial Penalty
                const { calculated_amount, base_task_value, calculation_snapshot } = calculatePenalty(
                  rule,
                  context,
                  activeRuleBook.rate_cards || {}
                );

                // Resolve Approver & Designated Role
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

                const supervisorAssignment = primaryLocationId
                  ? await prisma.cleaner_assignments.findFirst({
                      where: {
                        location_id: primaryLocationId,
                        OR: [
                          { role_id: { in: [3, 7] } },
                          { cleaner_user: { role_id: { in: [3, 7] } } }
                        ],
                        deleted_at: null
                      },
                      select: { cleaner_user_id: true }
                    })
                  : null;

                const assignedApproverId = supervisorAssignment?.cleaner_user_id || null;
                const penaltyNumber = await generatePenaltyNumber();

                const penalty = await prisma.cleaner_penalties.create({
                  data: {
                    penalty_number: penaltyNumber,
                    deduplication_key: deduplicationKey,
                    company_id: compId,
                    cleaner_user_id: cleanerUserId,
                    violation_id: violation.id,
                    rule_id: rule.id,
                    rule_version: activeRuleBook.version,
                    scope: "DAY_WISE",
                    business_date: startOfDay,
                    location_id: primaryLocationId,
                    review_id: null,
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
                stats.penaltiesCreated++;

                await prisma.cleaner_penalty_logs.create({
                  data: {
                    penalty_id: penalty.id,
                    actor_user_id: null,
                    action: "CREATED",
                    previous_status: null,
                    new_status: "PENDING",
                    previous_amount: null,
                    new_amount: calculated_amount,
                    comment: `End-of-Day SLA rule [${rule.rule_code}] breached on ${businessDateStr}: ${failedCount} failed tasks (Avg score: ${avgScore.toFixed(1)}/10)`
                  }
                });

                dispatchSlaPenaltyBreachAlerts({
                  penalty,
                  rule,
                  violation,
                  review: { score: avgScore },
                  cleanerUser,
                  location: primaryLocation,
                  companyId: compId
                }).catch((alertErr) =>
                  console.error("Error dispatching Day-Wise SLA alert:", alertErr)
                );
              }
            }
          } catch (cleanerErr) {
            stats.errors.push({ cleanerId: cleanerUserIdStr, error: cleanerErr.message });
          }
        }
      } catch (compErr) {
        stats.errors.push({ companyId: compId.toString(), error: compErr.message });
      }
    }

    console.log(
      `✅ [SLA DAY-WISE EVALUATION COMPLETE] Date: ${businessDateStr} | Cleaners: ${stats.cleanersEvaluated} | Penalties: ${stats.penaltiesCreated}`
    );
    return stats;
  } catch (fatalErr) {
    console.error("❌ [SLA DAY-WISE FATAL ERROR]:", fatalErr);
    throw fatalErr;
  }
};


