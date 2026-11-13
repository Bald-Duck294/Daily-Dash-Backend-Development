import prisma from "../config/prismaClient.mjs";
import { validateRuleItem, evaluateConditionAst } from "./slaRuleConditionValidator.js";

/**
 * Standard seed rules for default rule book creation
 */
export const DEFAULT_SEED_RULES = [
  {
    rule_code: "R-HYG-FAIL-01",
    name: "Hygiene Score Failure (< 6.0)",
    description: "Standard penalty triggered when an inspection hygiene score falls below acceptable baseline (6.0).",
    violation_category: "HYGIENE_SCORE_BREACH",
    violation_type: "SCORE_BELOW_THRESHOLD",
    scope: "TASK_WISE",
    condition_config: {
      operator: "AND",
      conditions: [
        { field: "review.score", comparator: "<", value: 6.0 },
        { field: "review.attempt_no", comparator: "==", value: 1 }
      ]
    },
    calculation_method: "FIXED_AMOUNT",
    penalty_value: 75.0,
    max_penalty_cap: 150.0,
    retry_resolution_policy: "AUTO_WAIVE_ON_RETRY_PASS",
    is_active: true
  },
  {
    rule_code: "R-RETRY-FAIL-01",
    name: "Retry Inspection Failure",
    description: "Applied when a corrective retry cleaning submission still scores below 7.0.",
    violation_category: "RETRY_FAILURE",
    violation_type: "RETRY_SCORE_UNRESOLVED",
    scope: "TASK_WISE",
    condition_config: {
      operator: "AND",
      conditions: [
        { field: "review.attempt_no", comparator: ">=", value: 2 },
        { field: "review.score", comparator: "<", value: 7.0 }
      ]
    },
    calculation_method: "FIXED_AMOUNT",
    penalty_value: 100.0,
    max_penalty_cap: 200.0,
    retry_resolution_policy: "WAIT_FOR_RETRY_OUTCOME",
    is_active: true
  },
  {
    rule_code: "R-MAX-RETRY-01",
    name: "Max Retries Exceeded",
    description: "Penalty imposed when retry attempts reach 3 or more without passing standard.",
    violation_category: "MAX_RETRIES_EXCEEDED",
    violation_type: "ESCALATION_EXHAUSTED",
    scope: "TASK_WISE",
    condition_config: {
      operator: "AND",
      conditions: [
        { field: "review.attempt_no", comparator: ">=", value: 3 },
        { field: "review.score", comparator: "<", value: 7.0 }
      ]
    },
    calculation_method: "FIXED_AMOUNT",
    penalty_value: 150.0,
    max_penalty_cap: 300.0,
    retry_resolution_policy: "WAIT_FOR_RETRY_OUTCOME",
    is_active: true
  },
  {
    rule_code: "R-DAILY-REPEAT-01",
    name: "Repeated Daily Failures (3+ breaches)",
    description: "Day-wise penalty when a cleaner records 3 or more hygiene score breaches in a single business day.",
    violation_category: "REPEATED_DAILY_FAILURE",
    violation_type: "CHRONIC_DAILY_DEFICIENCY",
    scope: "DAY_WISE",
    condition_config: {
      operator: "AND",
      conditions: [
        { field: "day_aggregate.failed_review_count", comparator: ">=", value: 3 }
      ]
    },
    calculation_method: "FIXED_AMOUNT",
    penalty_value: 200.0,
    max_penalty_cap: 500.0,
    retry_resolution_policy: "WAIT_FOR_RETRY_OUTCOME",
    is_active: true
  }
];

export const createRuleBook = async ({
  company_id,
  name,
  rate_cards = {},
  business_day_start_hour = 0,
  approval_policy = null,
  created_by = null
}) => {
  const companyIdBigInt = BigInt(company_id);

  // Compute next version
  const lastBook = await prisma.sla_rule_books.findFirst({
    where: { company_id: companyIdBigInt },
    orderBy: { version: 'desc' }
  });

  const nextVersion = lastBook ? lastBook.version + 1 : 1;

  const ruleBook = await prisma.sla_rule_books.create({
    data: {
      company_id: companyIdBigInt,
      name: name || `SLA Penalty Rule Book v${nextVersion}`,
      version: nextVersion,
      status: "DRAFT",
      effective_from: new Date(),
      rate_cards: rate_cards || {},
      business_day_start_hour: Number(business_day_start_hour) || 0,
      approval_policy: approval_policy || {
        routing_strategy: "TIERED_AMOUNT",
        tiers: [
          { tier: 1, role: "SUPERVISOR", max_limit: 100 },
          { tier: 2, role: "FACILITY_MANAGER", max_limit: 300 },
          { tier: 3, role: "COMPANY_ADMIN", max_limit: null }
        ]
      },
      created_by: created_by ? BigInt(created_by) : null
    }
  });

  return ruleBook;
};

export const getRuleBooks = async (company_id, { status, page = 1, limit = 20 } = {}) => {
  const companyIdBigInt = BigInt(company_id);
  const where = { company_id: companyIdBigInt };
  if (status) {
    where.status = String(status).toUpperCase();
  }

  const skip = (Number(page) - 1) * Number(limit);
  const take = Number(limit);

  const [ruleBooks, total] = await Promise.all([
    prisma.sla_rule_books.findMany({
      where,
      skip,
      take,
      orderBy: { version: 'desc' },
      include: {
        _count: {
          select: { rules: true }
        },
        creator: {
          select: { id: true, name: true, email: true }
        },
        approver: {
          select: { id: true, name: true, email: true }
        }
      }
    }),
    prisma.sla_rule_books.count({ where })
  ]);

  return {
    ruleBooks,
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / take)
  };
};

export const getRuleBookById = async (id, company_id) => {
  const ruleBook = await prisma.sla_rule_books.findFirst({
    where: {
      id: BigInt(id),
      company_id: BigInt(company_id)
    },
    include: {
      rules: {
        orderBy: { id: 'asc' }
      },
      creator: {
        select: { id: true, name: true, email: true }
      },
      approver: {
        select: { id: true, name: true, email: true }
      }
    }
  });

  if (!ruleBook) {
    throw new Error(`Rule book #${id} not found for company #${company_id}`);
  }

  return ruleBook;
};

export const getActiveRuleBook = async (company_id) => {
  const companyIdBigInt = BigInt(company_id);
  const publishedBook = await prisma.sla_rule_books.findFirst({
    where: {
      company_id: companyIdBigInt,
      status: "PUBLISHED"
    },
    orderBy: { version: 'desc' },
    include: {
      rules: {
        where: { is_active: true },
        orderBy: { id: 'asc' }
      }
    }
  });

  return publishedBook;
};

export const updateRuleBook = async (id, company_id, updateData) => {
  const ruleBookId = BigInt(id);
  const companyIdBigInt = BigInt(company_id);

  const existing = await prisma.sla_rule_books.findFirst({
    where: { id: ruleBookId, company_id: companyIdBigInt }
  });

  if (!existing) {
    throw new Error(`Rule book #${id} not found`);
  }

  if (existing.status !== 'DRAFT') {
    throw new Error(`Only DRAFT rule books can be updated. Status is "${existing.status}". Create a new version instead.`);
  }

  const allowedUpdates = {};
  if (updateData.name !== undefined) allowedUpdates.name = updateData.name;
  if (updateData.rate_cards !== undefined) allowedUpdates.rate_cards = updateData.rate_cards;
  if (updateData.business_day_start_hour !== undefined) allowedUpdates.business_day_start_hour = Number(updateData.business_day_start_hour);
  if (updateData.approval_policy !== undefined) allowedUpdates.approval_policy = updateData.approval_policy;

  const updated = await prisma.sla_rule_books.update({
    where: { id: ruleBookId },
    data: allowedUpdates
  });

  return updated;
};

export const publishRuleBook = async (id, company_id, approved_by = null) => {
  const ruleBookId = BigInt(id);
  const companyIdBigInt = BigInt(company_id);

  const candidate = await prisma.sla_rule_books.findFirst({
    where: { id: ruleBookId, company_id: companyIdBigInt },
    include: {
      rules: {
        where: { is_active: true }
      }
    }
  });

  if (!candidate) {
    throw new Error(`Rule book #${id} not found`);
  }

  if (candidate.status === 'PUBLISHED') {
    return candidate;
  }

  if (candidate.rules.length === 0) {
    throw new Error(`Cannot publish rule book with no active rules.`);
  }

  // Atomically archive current published book and publish new one
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    // 1. Archive previously published books for this company
    await tx.sla_rule_books.updateMany({
      where: {
        company_id: companyIdBigInt,
        status: "PUBLISHED"
      },
      data: {
        status: "ARCHIVED",
        effective_to: now
      }
    });

    // 2. Mark this candidate as PUBLISHED
    const published = await tx.sla_rule_books.update({
      where: { id: ruleBookId },
      data: {
        status: "PUBLISHED",
        effective_from: now,
        effective_to: null,
        approved_by: approved_by ? BigInt(approved_by) : null
      },
      include: {
        rules: true
      }
    });

    return published;
  });

  return result;
};

export const addRuleToBook = async (ruleBookId, company_id, ruleData) => {
  const bookIdBigInt = BigInt(ruleBookId);
  const companyIdBigInt = BigInt(company_id);

  const book = await prisma.sla_rule_books.findFirst({
    where: { id: bookIdBigInt, company_id: companyIdBigInt }
  });

  if (!book) {
    throw new Error(`Rule book #${ruleBookId} not found`);
  }

  if (book.status !== 'DRAFT') {
    throw new Error(`Cannot add rules to a ${book.status} rule book. Only DRAFT rule books can be modified.`);
  }

  const validation = validateRuleItem(ruleData);
  if (!validation.isValid) {
    const error = new Error(`Rule validation failed: ${validation.errors.join('; ')}`);
    error.validationErrors = validation.errors;
    throw error;
  }

  // Check unique rule_code in this book
  const existingCode = await prisma.sla_penalty_rules.findFirst({
    where: {
      rule_book_id: bookIdBigInt,
      rule_code: ruleData.rule_code.trim()
    }
  });

  if (existingCode) {
    throw new Error(`Rule with code "${ruleData.rule_code}" already exists in rule book #${ruleBookId}`);
  }

  const createdRule = await prisma.sla_penalty_rules.create({
    data: {
      rule_book_id: bookIdBigInt,
      company_id: companyIdBigInt,
      rule_code: ruleData.rule_code.trim(),
      name: ruleData.name.trim(),
      description: ruleData.description || null,
      violation_category: ruleData.violation_category,
      violation_type: ruleData.violation_type || ruleData.violation_category,
      scope: ruleData.scope || "TASK_WISE",
      condition_config: ruleData.condition_config,
      calculation_method: ruleData.calculation_method || "FIXED_AMOUNT",
      penalty_value: ruleData.penalty_value !== undefined ? Number(ruleData.penalty_value) : 0,
      max_penalty_cap: ruleData.max_penalty_cap !== undefined && ruleData.max_penalty_cap !== null ? Number(ruleData.max_penalty_cap) : null,
      min_penalty: ruleData.min_penalty !== undefined && ruleData.min_penalty !== null ? Number(ruleData.min_penalty) : null,
      per_minute_rate: ruleData.per_minute_rate !== undefined && ruleData.per_minute_rate !== null ? Number(ruleData.per_minute_rate) : null,
      grace_period_minutes: ruleData.grace_period_minutes !== undefined ? Number(ruleData.grace_period_minutes) : 0,
      task_value_reference: ruleData.task_value_reference !== undefined && ruleData.task_value_reference !== null ? Number(ruleData.task_value_reference) : null,
      retry_resolution_policy: ruleData.retry_resolution_policy || "WAIT_FOR_RETRY_OUTCOME",
      approval_override_policy: ruleData.approval_override_policy || null,
      is_active: ruleData.is_active !== undefined ? Boolean(ruleData.is_active) : true
    }
  });

  return createdRule;
};

export const updateRule = async (ruleId, company_id, updateData) => {
  const ruleIdBigInt = BigInt(ruleId);
  const companyIdBigInt = BigInt(company_id);

  const existing = await prisma.sla_penalty_rules.findFirst({
    where: { id: ruleIdBigInt, company_id: companyIdBigInt },
    include: { rule_book: true }
  });

  if (!existing) {
    throw new Error(`Rule #${ruleId} not found`);
  }

  if (existing.rule_book.status !== 'DRAFT') {
    throw new Error(`Cannot edit rule in a ${existing.rule_book.status} rule book.`);
  }

  if (updateData.condition_config) {
    const condRes = validateRuleItem({ ...existing, ...updateData });
    if (!condRes.isValid) {
      const error = new Error(`Condition validation failed: ${condRes.errors.join('; ')}`);
      error.validationErrors = condRes.errors;
      throw error;
    }
  }

  const dataToUpdate = {};
  if (updateData.name !== undefined) dataToUpdate.name = updateData.name;
  if (updateData.description !== undefined) dataToUpdate.description = updateData.description;
  if (updateData.violation_category !== undefined) dataToUpdate.violation_category = updateData.violation_category;
  if (updateData.violation_type !== undefined) dataToUpdate.violation_type = updateData.violation_type;
  if (updateData.scope !== undefined) dataToUpdate.scope = updateData.scope;
  if (updateData.condition_config !== undefined) dataToUpdate.condition_config = updateData.condition_config;
  if (updateData.calculation_method !== undefined) dataToUpdate.calculation_method = updateData.calculation_method;
  if (updateData.penalty_value !== undefined) dataToUpdate.penalty_value = Number(updateData.penalty_value);
  if (updateData.max_penalty_cap !== undefined) dataToUpdate.max_penalty_cap = updateData.max_penalty_cap !== null ? Number(updateData.max_penalty_cap) : null;
  if (updateData.min_penalty !== undefined) dataToUpdate.min_penalty = updateData.min_penalty !== null ? Number(updateData.min_penalty) : null;
  if (updateData.per_minute_rate !== undefined) dataToUpdate.per_minute_rate = updateData.per_minute_rate !== null ? Number(updateData.per_minute_rate) : null;
  if (updateData.grace_period_minutes !== undefined) dataToUpdate.grace_period_minutes = Number(updateData.grace_period_minutes);
  if (updateData.task_value_reference !== undefined) dataToUpdate.task_value_reference = updateData.task_value_reference !== null ? Number(updateData.task_value_reference) : null;
  if (updateData.retry_resolution_policy !== undefined) dataToUpdate.retry_resolution_policy = updateData.retry_resolution_policy;
  if (updateData.approval_override_policy !== undefined) dataToUpdate.approval_override_policy = updateData.approval_override_policy;
  if (updateData.is_active !== undefined) dataToUpdate.is_active = Boolean(updateData.is_active);

  const updated = await prisma.sla_penalty_rules.update({
    where: { id: ruleIdBigInt },
    data: dataToUpdate
  });

  return updated;
};

export const deleteRule = async (ruleId, company_id) => {
  const ruleIdBigInt = BigInt(ruleId);
  const companyIdBigInt = BigInt(company_id);

  const existing = await prisma.sla_penalty_rules.findFirst({
    where: { id: ruleIdBigInt, company_id: companyIdBigInt },
    include: { rule_book: true }
  });

  if (!existing) {
    throw new Error(`Rule #${ruleId} not found`);
  }

  if (existing.rule_book.status !== 'DRAFT') {
    throw new Error(`Cannot delete rule from a ${existing.rule_book.status} rule book.`);
  }

  await prisma.sla_penalty_rules.delete({
    where: { id: ruleIdBigInt }
  });

  return { success: true, message: `Rule #${ruleId} deleted successfully` };
};

export const seedDefaultRuleBook = async (company_id, created_by = null, autoPublish = false) => {
  const companyIdBigInt = BigInt(company_id);

  // Check if an active rule book already exists
  const existingActive = await getActiveRuleBook(company_id);
  if (existingActive) {
    return {
      created: false,
      message: "An active rule book already exists for this company.",
      ruleBook: existingActive
    };
  }

  // Create rule book
  const book = await createRuleBook({
    company_id: companyIdBigInt,
    name: "Standard Baseline SLA Penalty Rule Book",
    rate_cards: { standard_washroom: 100.0, urinal_bank: 60.0 },
    business_day_start_hour: 0,
    created_by
  });

  // Add default rules
  for (const ruleDef of DEFAULT_SEED_RULES) {
    await addRuleToBook(book.id, companyIdBigInt, ruleDef);
  }

  if (autoPublish) {
    const published = await publishRuleBook(book.id, companyIdBigInt, created_by);
    return {
      created: true,
      published: true,
      ruleBook: published
    };
  }

  const populated = await getRuleBookById(book.id, companyIdBigInt);
  return {
    created: true,
    published: false,
    ruleBook: populated
  };
};

export const previewRuleSimulation = async (company_id, ruleDefinition, sampleReviewIds = []) => {
  const companyIdBigInt = BigInt(company_id);

  const validation = validateRuleItem(ruleDefinition);
  if (!validation.isValid) {
    throw new Error(`Invalid rule definition: ${validation.errors.join('; ')}`);
  }

  let reviews = [];
  if (sampleReviewIds && sampleReviewIds.length > 0) {
    reviews = await prisma.cleaner_review.findMany({
      where: {
        id: { in: sampleReviewIds.map(id => BigInt(id)) },
        company_id: companyIdBigInt
      },
      take: 20
    });
  } else {
    // Pick the most recent 10 reviews
    reviews = await prisma.cleaner_review.findMany({
      where: { company_id: companyIdBigInt },
      orderBy: { id: 'desc' },
      take: 10
    });
  }

  const results = reviews.map(r => {
    const context = {
      review: {
        id: r.id.toString(),
        score: r.score !== null ? Number(r.score) : 0,
        attempt_no: Number(r.attempt_no || 1),
        review_type: r.review_type || 'ORIGINAL',
        tasks_count: Array.isArray(r.tasks) ? r.tasks.length : 0
      },
      location: {
        id: r.location_id ? r.location_id.toString() : null
      },
      day_aggregate: {
        failed_review_count: 1
      }
    };

    const isMatch = evaluateConditionAst(ruleDefinition.condition_config, context);
    let simulatedPenalty = 0;
    if (isMatch) {
      if (ruleDefinition.calculation_method === 'FIXED_AMOUNT') {
        simulatedPenalty = Number(ruleDefinition.penalty_value || 0);
      } else if (ruleDefinition.calculation_method === 'TASK_VALUE_PERCENTAGE') {
        const base = Number(ruleDefinition.task_value_reference || 100);
        simulatedPenalty = (base * Number(ruleDefinition.penalty_value || 0)) / 100;
      }
      if (ruleDefinition.max_penalty_cap && simulatedPenalty > Number(ruleDefinition.max_penalty_cap)) {
        simulatedPenalty = Number(ruleDefinition.max_penalty_cap);
      }
    }

    return {
      review_id: r.id.toString(),
      review_score: r.score,
      attempt_no: r.attempt_no,
      matched: isMatch,
      simulated_penalty: simulatedPenalty
    };
  });

  return {
    rule_code: ruleDefinition.rule_code,
    tested_count: reviews.length,
    matched_count: results.filter(res => res.matched).length,
    results
  };
};
