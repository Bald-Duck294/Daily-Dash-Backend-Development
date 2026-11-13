/**
 * SLA Rule Condition Validator and Safe AST Evaluator
 * Strict No-eval Guarantee: Uses AST evaluation for security and determinism.
 */

export const ALLOWED_OPERATORS = ['AND', 'OR', 'NOT'];
export const ALLOWED_COMPARATORS = ['<', '<=', '>', '>=', '==', '!=', 'IN', 'NOT_IN', 'CONTAINS'];
export const ALLOWED_SCOPES = ['TASK_WISE', 'DAY_WISE'];
export const ALLOWED_CALCULATION_METHODS = [
  'FIXED_AMOUNT',
  'TASK_VALUE_PERCENTAGE',
  'PER_MINUTE_DELAY',
  'TIERED_FLAT_RATE'
];

export const STANDARD_VIOLATION_CATEGORIES = [
  'HYGIENE_SCORE_BREACH',
  'RETRY_FAILURE',
  'MAX_RETRIES_EXCEEDED',
  'MISSED_CLEANING_SCHEDULE',
  'LATE_COMPLETION',
  'REPEATED_DAILY_FAILURE',
  'CHECKLIST_DEFICIENCY'
];

/**
 * Validates a single condition node or nested logical node.
 * @param {object} node 
 * @param {string} path 
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateConditionNode = (node, path = 'root') => {
  const errors = [];

  if (!node || typeof node !== 'object') {
    return { isValid: false, errors: [`${path}: Condition must be a valid JSON object`] };
  }

  // Branch 1: Logical Combinator (operator: AND | OR | NOT)
  if (node.operator) {
    const op = String(node.operator).toUpperCase();
    if (!ALLOWED_OPERATORS.includes(op)) {
      errors.push(`${path}: Invalid logical operator "${node.operator}". Allowed: ${ALLOWED_OPERATORS.join(', ')}`);
    }

    if (!Array.isArray(node.conditions) || node.conditions.length === 0) {
      errors.push(`${path}: Operator "${op}" requires a non-empty "conditions" array.`);
    } else {
      node.conditions.forEach((subNode, idx) => {
        const subRes = validateConditionNode(subNode, `${path}.conditions[${idx}]`);
        if (!subRes.isValid) {
          errors.push(...subRes.errors);
        }
      });
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Branch 2: Leaf Condition ({ field, comparator, value })
  if (!node.field || typeof node.field !== 'string' || node.field.trim() === '') {
    errors.push(`${path}: Condition must include a valid string "field" path (e.g. "review.score").`);
  }

  if (!node.comparator || !ALLOWED_COMPARATORS.includes(String(node.comparator))) {
    errors.push(`${path}: Comparator "${node.comparator}" is invalid. Allowed: ${ALLOWED_COMPARATORS.join(', ')}`);
  }

  if (node.value === undefined) {
    errors.push(`${path}: Condition must specify a "value" for comparison.`);
  }

  if (['IN', 'NOT_IN'].includes(node.comparator) && !Array.isArray(node.value)) {
    errors.push(`${path}: Comparator "${node.comparator}" requires "value" to be an array.`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Validates full rule payload before database insertion or update.
 * @param {object} ruleData 
 * @returns {{ isValid: boolean, errors: string[] }}
 */
export const validateRuleItem = (ruleData) => {
  const errors = [];

  if (!ruleData || typeof ruleData !== 'object') {
    return { isValid: false, errors: ['Rule data must be an object'] };
  }

  if (!ruleData.rule_code || typeof ruleData.rule_code !== 'string' || !/^[A-Za-z0-9_-]+$/.test(ruleData.rule_code.trim())) {
    errors.push('rule_code is required and must only contain alphanumeric characters, hyphens, and underscores.');
  }

  if (!ruleData.name || typeof ruleData.name !== 'string' || ruleData.name.trim() === '') {
    errors.push('name is required and cannot be empty.');
  }

  if (!ruleData.violation_category || typeof ruleData.violation_category !== 'string') {
    errors.push('violation_category is required.');
  }

  if (ruleData.scope && !ALLOWED_SCOPES.includes(ruleData.scope)) {
    errors.push(`scope must be one of: ${ALLOWED_SCOPES.join(', ')}.`);
  }

  if (ruleData.calculation_method && !ALLOWED_CALCULATION_METHODS.includes(ruleData.calculation_method)) {
    errors.push(`calculation_method must be one of: ${ALLOWED_CALCULATION_METHODS.join(', ')}.`);
  }

  if (ruleData.penalty_value !== undefined && ruleData.penalty_value !== null) {
    const val = Number(ruleData.penalty_value);
    if (isNaN(val) || val < 0) {
      errors.push('penalty_value must be a non-negative number.');
    }
  }

  if (ruleData.max_penalty_cap !== undefined && ruleData.max_penalty_cap !== null) {
    const cap = Number(ruleData.max_penalty_cap);
    if (isNaN(cap) || cap < 0) {
      errors.push('max_penalty_cap must be a non-negative number.');
    }
  }

  if (ruleData.condition_config) {
    const condRes = validateConditionNode(ruleData.condition_config);
    if (!condRes.isValid) {
      errors.push(...condRes.errors);
    }
  } else {
    errors.push('condition_config is required.');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Safe nested property extractor (prevents prototype pollution or undefined errors)
 * @param {object} obj 
 * @param {string} path e.g. "review.score"
 * @returns {any}
 */
export const getNestedValue = (obj, path) => {
  if (!obj || typeof obj !== 'object' || !path) return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Object.prototype.hasOwnProperty.call(current, part)) {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return current;
};

/**
 * Pure, deterministic condition AST evaluator (Zero eval())
 * @param {object} node 
 * @param {object} context 
 * @returns {boolean}
 */
export const evaluateConditionAst = (node, context = {}) => {
  if (!node || typeof node !== 'object') return false;

  // Handle Logical Nodes
  if (node.operator) {
    const op = String(node.operator).toUpperCase();
    const conditions = Array.isArray(node.conditions) ? node.conditions : [];

    if (op === 'AND') {
      return conditions.length > 0 && conditions.every(c => evaluateConditionAst(c, context));
    }
    if (op === 'OR') {
      return conditions.length > 0 && conditions.some(c => evaluateConditionAst(c, context));
    }
    if (op === 'NOT') {
      return conditions.length > 0 && !evaluateConditionAst(conditions[0], context);
    }
    return false;
  }

  // Handle Leaf Conditions
  const rawActual = getNestedValue(context, node.field);
  const target = node.value;
  const comp = node.comparator;

  // Numeric comparisons with safe coercion
  const numActual = Number(rawActual);
  const numTarget = Number(target);
  const isBothNumeric = !isNaN(numActual) && !isNaN(numTarget) && rawActual !== '' && target !== '';

  switch (comp) {
    case '<':
      return isBothNumeric ? numActual < numTarget : String(rawActual) < String(target);
    case '<=':
      return isBothNumeric ? numActual <= numTarget : String(rawActual) <= String(target);
    case '>':
      return isBothNumeric ? numActual > numTarget : String(rawActual) > String(target);
    case '>=':
      return isBothNumeric ? numActual >= numTarget : String(rawActual) >= String(target);
    case '==':
      if (isBothNumeric) return numActual === numTarget;
      return String(rawActual) === String(target);
    case '!=':
      if (isBothNumeric) return numActual !== numTarget;
      return String(rawActual) !== String(target);
    case 'IN':
      if (!Array.isArray(target)) return false;
      return target.some(t => (isBothNumeric && !isNaN(Number(t)) ? Number(t) === numActual : String(t) === String(rawActual)));
    case 'NOT_IN':
      if (!Array.isArray(target)) return true;
      return !target.some(t => (isBothNumeric && !isNaN(Number(t)) ? Number(t) === numActual : String(t) === String(rawActual)));
    case 'CONTAINS':
      if (Array.isArray(rawActual)) {
        return rawActual.includes(target);
      }
      return String(rawActual || '').toLowerCase().includes(String(target || '').toLowerCase());
    default:
      return false;
  }
};
