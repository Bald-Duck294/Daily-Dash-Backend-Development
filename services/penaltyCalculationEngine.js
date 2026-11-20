/**
 * SLA Penalty Calculation Engine
 * High-precision mathematical evaluation with clamping, rate card resolution, and calculation snapshots.
 */

export const calculatePenalty = (rule, context = {}, rateCards = {}) => {
  if (!rule) {
    throw new Error("Rule definition is required for penalty calculation");
  }

  const method = rule.calculation_method || "FIXED_AMOUNT";
  let rawAmount = 0;
  let formulaDesc = "";
  let baseTaskValue = null;

  switch (method) {
    case "FIXED_AMOUNT": {
      rawAmount = Number(rule.penalty_value || 0);
      formulaDesc = `Fixed contractual fee of ₹${rawAmount.toFixed(2)}`;
      break;
    }

    case "TASK_VALUE_PERCENTAGE": {
      // Resolve task value baseline
      const locType = context.location?.type_id;
      baseTaskValue = Number(
        rule.task_value_reference ||
        (locType && rateCards[locType]) ||
        rateCards.standard_washroom ||
        100.00
      );
      const percentage = Number(rule.penalty_value || 0);
      rawAmount = (baseTaskValue * percentage) / 100;
      formulaDesc = `${percentage}% deduction against baseline task value ₹${baseTaskValue.toFixed(2)}`;
      break;
    }

    case "PER_MINUTE_DELAY": {
      const minutesDelayed = Number(context.review?.minutes_delayed || context.delay_minutes || 0);
      const gracePeriod = Number(rule.grace_period_minutes || 0);
      const billableMinutes = Math.max(0, minutesDelayed - gracePeriod);
      const perMinuteRate = Number(rule.per_minute_rate || rule.penalty_value || 1.0);
      rawAmount = billableMinutes * perMinuteRate;
      formulaDesc = `${billableMinutes} billable minutes delayed (past ${gracePeriod}m grace) at ₹${perMinuteRate.toFixed(2)}/min`;
      break;
    }

    case "TIERED_FLAT_RATE": {
      const breachCount = Number(context.day_aggregate?.failed_review_count || 1);
      const delayMinutes = Number(context.delay_minutes || context.review?.minutes_delayed || 0);
      const metricValue = delayMinutes > 0 ? delayMinutes : breachCount;
      const unitPenalty = Number(rule.penalty_value || 0);

      // Support explicit tier brackets if defined in tier_config
      if (Array.isArray(rule.tier_config) && rule.tier_config.length > 0) {
        let matchedTier = null;
        for (const tier of rule.tier_config) {
          const min = tier.min ?? tier.min_delay_minutes ?? 0;
          const max = tier.max ?? tier.max_delay_minutes ?? Infinity;
          if (metricValue >= min && metricValue <= max) {
            matchedTier = tier;
            break;
          }
        }
        if (matchedTier) {
          rawAmount = Number(matchedTier.amount || matchedTier.penalty || unitPenalty);
          formulaDesc = `Tiered flat rate matched bracket [${matchedTier.min ?? 0} - ${matchedTier.max ?? '∞'}] = ₹${rawAmount.toFixed(2)}`;
        } else {
          rawAmount = unitPenalty;
          formulaDesc = `Tiered flat deduction: baseline ₹${unitPenalty.toFixed(2)}`;
        }
      } else {
        rawAmount = breachCount * unitPenalty;
        formulaDesc = `Tiered flat deduction: ${breachCount} breach(es) × ₹${unitPenalty.toFixed(2)}`;
      }
      break;
    }

    default: {
      rawAmount = Number(rule.penalty_value || 0);
      formulaDesc = `Default fixed calculation of ₹${rawAmount.toFixed(2)}`;
    }
  }

  // Ensure non-negative
  if (rawAmount < 0 || isNaN(rawAmount)) {
    rawAmount = 0;
  }

  let finalAmount = rawAmount;
  let isCapped = false;

  // Enforce Max Penalty Cap
  if (rule.max_penalty_cap !== null && rule.max_penalty_cap !== undefined) {
    const maxCap = Number(rule.max_penalty_cap);
    if (!isNaN(maxCap) && finalAmount > maxCap) {
      finalAmount = maxCap;
      isCapped = true;
    }
  }

  // Enforce Min Penalty
  if (rule.min_penalty !== null && rule.min_penalty !== undefined && finalAmount > 0) {
    const minPen = Number(rule.min_penalty);
    if (!isNaN(minPen) && finalAmount < minPen) {
      finalAmount = minPen;
    }
  }

  finalAmount = Number(finalAmount.toFixed(2));

  // Build legally defensible calculation snapshot
  const calculation_snapshot = {
    method,
    rule_code: rule.rule_code,
    rule_name: rule.name,
    formula: formulaDesc,
    inputs: {
      review_id: context.review?.id || null,
      score: context.review?.score ?? null,
      attempt_no: context.review?.attempt_no ?? null,
      base_task_value: baseTaskValue,
      penalty_value: Number(rule.penalty_value || 0),
      max_penalty_cap: rule.max_penalty_cap ? Number(rule.max_penalty_cap) : null,
      min_penalty: rule.min_penalty ? Number(rule.min_penalty) : null
    },
    raw_amount: Number(rawAmount.toFixed(2)),
    final_amount: finalAmount,
    is_capped: isCapped,
    calculated_at: new Date().toISOString()
  };

  return {
    calculated_amount: finalAmount,
    base_task_value: baseTaskValue !== null ? Number(baseTaskValue.toFixed(2)) : null,
    calculation_snapshot
  };
};
