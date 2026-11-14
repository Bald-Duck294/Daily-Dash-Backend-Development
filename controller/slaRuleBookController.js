import {
  createRuleBook,
  getRuleBooks,
  getRuleBookById,
  getActiveRuleBook,
  updateRuleBook,
  publishRuleBook,
  addRuleToBook,
  updateRule,
  deleteRule,
  seedDefaultRuleBook,
  previewRuleSimulation
} from "../services/slaRuleBookService.js";

// Helper to serialize BigInt and Decimal for JSON responses
export const serializeBigInt = (obj) => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (typeof obj === 'object') {
    if (obj instanceof Date) return obj.toISOString();
    if (typeof obj.toNumber === 'function') return obj.toNumber();
    if (Array.isArray(obj)) return obj.map(serializeBigInt);
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, serializeBigInt(v)])
    );
  }
  return obj;
};

/**
 * Resolve company_id safely from body, query, or authenticated user
 */
const resolveCompanyId = (req) => {
  return req.body?.company_id || req.query?.company_id || req.user?.company_id;
};

export const createRuleBookHandler = async (req, res) => {
  try {
    const company_id = resolveCompanyId(req);
    if (!company_id) {
      return res.status(400).json({ success: false, message: "company_id is required" });
    }

    const { name, rate_cards, business_day_start_hour, approval_policy } = req.body;
    const ruleBook = await createRuleBook({
      company_id,
      name,
      rate_cards,
      business_day_start_hour,
      approval_policy,
      created_by: req.user?.id
    });

    return res.status(201).json({
      success: true,
      message: "Rule Book created successfully in DRAFT mode",
      data: serializeBigInt(ruleBook)
    });
  } catch (error) {
    console.error("Error in createRuleBookHandler:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getRuleBooksHandler = async (req, res) => {
  try {
    const company_id = resolveCompanyId(req);
    if (!company_id) {
      return res.status(400).json({ success: false, message: "company_id is required" });
    }

    const { status, page = 1, limit = 20 } = req.query;
    const result = await getRuleBooks(company_id, { status, page, limit });

    return res.status(200).json({
      success: true,
      data: serializeBigInt(result.ruleBooks),
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages
      }
    });
  } catch (error) {
    console.error("Error in getRuleBooksHandler:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getActiveRuleBookHandler = async (req, res) => {
  try {
    const company_id = resolveCompanyId(req);
    if (!company_id) {
      return res.status(400).json({ success: false, message: "company_id is required" });
    }

    const ruleBook = await getActiveRuleBook(company_id);

    return res.status(200).json({
      success: true,
      data: serializeBigInt(ruleBook)
    });
  } catch (error) {
    console.error("Error in getActiveRuleBookHandler:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getRuleBookByIdHandler = async (req, res) => {
  try {
    const company_id = resolveCompanyId(req);
    if (!company_id) {
      return res.status(400).json({ success: false, message: "company_id is required" });
    }

    const { id } = req.params;
    const ruleBook = await getRuleBookById(id, company_id);

    return res.status(200).json({
      success: true,
      data: serializeBigInt(ruleBook)
    });
  } catch (error) {
    console.error("Error in getRuleBookByIdHandler:", error);
    return res.status(404).json({ success: false, message: error.message });
  }
};

export const updateRuleBookHandler = async (req, res) => {
  try {
    const company_id = resolveCompanyId(req);
    if (!company_id) {
      return res.status(400).json({ success: false, message: "company_id is required" });
    }

    const { id } = req.params;
    const updated = await updateRuleBook(id, company_id, req.body);

    return res.status(200).json({
      success: true,
      message: "Rule book updated successfully",
      data: serializeBigInt(updated)
    });
  } catch (error) {
    console.error("Error in updateRuleBookHandler:", error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const publishRuleBookHandler = async (req, res) => {
  try {
    const company_id = resolveCompanyId(req);
    if (!company_id) {
      return res.status(400).json({ success: false, message: "company_id is required" });
    }

    const { id } = req.params;
    const published = await publishRuleBook(id, company_id, req.user?.id);

    return res.status(200).json({
      success: true,
      message: `Rule Book #${id} published successfully as Version ${published.version}`,
      data: serializeBigInt(published)
    });
  } catch (error) {
    console.error("Error in publishRuleBookHandler:", error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const addRuleHandler = async (req, res) => {
  try {
    const company_id = resolveCompanyId(req);
    if (!company_id) {
      return res.status(400).json({ success: false, message: "company_id is required" });
    }

    const { id } = req.params; // rule_book_id
    const createdRule = await addRuleToBook(id, company_id, req.body);

    return res.status(201).json({
      success: true,
      message: "Rule added successfully",
      data: serializeBigInt(createdRule)
    });
  } catch (error) {
    console.error("Error in addRuleHandler:", error);
    return res.status(400).json({
      success: false,
      message: error.message,
      validationErrors: error.validationErrors || null
    });
  }
};

export const updateRuleHandler = async (req, res) => {
  try {
    const company_id = resolveCompanyId(req);
    if (!company_id) {
      return res.status(400).json({ success: false, message: "company_id is required" });
    }

    const { ruleId } = req.params;
    const updated = await updateRule(ruleId, company_id, req.body);

    return res.status(200).json({
      success: true,
      message: "Rule updated successfully",
      data: serializeBigInt(updated)
    });
  } catch (error) {
    console.error("Error in updateRuleHandler:", error);
    return res.status(400).json({
      success: false,
      message: error.message,
      validationErrors: error.validationErrors || null
    });
  }
};

export const deleteRuleHandler = async (req, res) => {
  try {
    const company_id = resolveCompanyId(req);
    if (!company_id) {
      return res.status(400).json({ success: false, message: "company_id is required" });
    }

    const { ruleId } = req.params;
    const result = await deleteRule(ruleId, company_id);

    return res.status(200).json({
      success: true,
      message: result.message
    });
  } catch (error) {
    console.error("Error in deleteRuleHandler:", error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

export const seedDefaultRuleBookHandler = async (req, res) => {
  try {
    const company_id = resolveCompanyId(req);
    if (!company_id) {
      return res.status(400).json({ success: false, message: "company_id is required" });
    }

    const autoPublish = Boolean(req.body.auto_publish);
    const result = await seedDefaultRuleBook(company_id, req.user?.id, autoPublish);

    return res.status(200).json({
      success: true,
      message: result.message || "Default SLA penalty rule book created",
      data: serializeBigInt(result.ruleBook)
    });
  } catch (error) {
    console.error("Error in seedDefaultRuleBookHandler:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const previewRuleHandler = async (req, res) => {
  try {
    const company_id = resolveCompanyId(req);
    if (!company_id) {
      return res.status(400).json({ success: false, message: "company_id is required" });
    }

    const { rule_definition, sample_review_ids } = req.body;
    if (!rule_definition) {
      return res.status(400).json({ success: false, message: "rule_definition is required" });
    }

    const simulation = await previewRuleSimulation(company_id, rule_definition, sample_review_ids);

    return res.status(200).json({
      success: true,
      data: serializeBigInt(simulation)
    });
  } catch (error) {
    console.error("Error in previewRuleHandler:", error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

