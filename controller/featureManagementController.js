import prisma from "../config/prismaClient.mjs";

// Helper to safely serialize BigInt for JSON responses
export const serializeBigInt = (obj) => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "bigint") return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeBigInt);
  if (typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [key, serializeBigInt(value)])
    );
  }
  return obj;
};

// Supported feature keys
export const SUPPORTED_FEATURES = [
  "cleaner_assignment",
  "cleaning_request",
  "sla_rules",
  "service_req_threshold",
  "service_req_thredshold",
];

// Default state if no configuration record exists
export const DEFAULT_FEATURE_STATES = {
  cleaner_assignment: true, // Default to true so existing deployments have cleaner assignment
  cleaning_request: false,  // Default to false until superadmin enables it
  sla_rules: false,         // Default to false until superadmin enables it
  service_req_threshold: false, // Default to false until superadmin enables it
  service_req_threshold_value: 3, // Default threshold: 3 requests
};

/**
 * 1. GET /api/feature-management/companies
 * Super Admin only (role_id === 1): List all companies with their feature flags
 */
export const getAllCompaniesFeatures = async (req, res) => {
  try {
    const userRole = Number(req.user?.role_id);
    if (userRole !== 1) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Super Admin access required.",
      });
    }

    // 1. Fetch active companies
    const companies = await prisma.companies.findMany({
      where: {
        deleted_at: null,
        status: true,
      },
      select: {
        id: true,
        name: true,
        contact_email: true,
        created_at: true,
        status: true,
      },
      orderBy: { name: "asc" },
    });

    // 2. Fetch all configurations records for supported features
    const configs = await prisma.configurations.findMany({
      where: {
        name: { in: SUPPORTED_FEATURES },
      },
    });

    // Map by company_id -> feature_name -> { is_active, threshold }
    const companyFeatureMap = {};
    for (const c of configs) {
      if (c.company_id) {
        const cId = c.company_id.toString();
        if (!companyFeatureMap[cId]) {
          companyFeatureMap[cId] = {};
        }
        companyFeatureMap[cId][c.name] = Boolean(c.is_active);

        // Capture threshold if present in description
        if (c.name === "service_req_threshold" || c.name === "service_req_thredshold") {
          const desc = c.description && typeof c.description === "object" ? c.description : {};
          const tVal = Number(desc.threshold || desc.value) || 3;
          companyFeatureMap[cId]["service_req_threshold"] = Boolean(c.is_active);
          companyFeatureMap[cId]["service_req_threshold_value"] = tVal;
        }
      }
    }

    const result = companies.map((comp) => {
      const compIdStr = comp.id.toString();
      const companyConfig = companyFeatureMap[compIdStr] || {};

      const features = {
        cleaner_assignment:
          companyConfig.cleaner_assignment !== undefined
            ? companyConfig.cleaner_assignment
            : DEFAULT_FEATURE_STATES.cleaner_assignment,
        cleaning_request:
          companyConfig.cleaning_request !== undefined
            ? companyConfig.cleaning_request
            : DEFAULT_FEATURE_STATES.cleaning_request,
        sla_rules:
          companyConfig.sla_rules !== undefined
            ? companyConfig.sla_rules
            : DEFAULT_FEATURE_STATES.sla_rules,
        service_req_threshold:
          companyConfig.service_req_threshold !== undefined
            ? companyConfig.service_req_threshold
            : DEFAULT_FEATURE_STATES.service_req_threshold,
        service_req_threshold_value:
          companyConfig.service_req_threshold_value !== undefined
            ? companyConfig.service_req_threshold_value
            : DEFAULT_FEATURE_STATES.service_req_threshold_value,
      };

      return {
        company_id: compIdStr,
        company_name: comp.name || `Company #${compIdStr}`,
        contact_email: comp.contact_email || null,
        features,
      };
    });

    return res.status(200).json({
      success: true,
      data: result,
      total: result.length,
    });
  } catch (error) {
    console.error("Error in getAllCompaniesFeatures:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 2. GET /api/feature-management/company/:companyId
 * Get feature flags for a specific company
 */
export const getCompanyFeatures = async (req, res) => {
  try {
    const companyId =
      req.params.companyId || req.query.company_id || req.user?.company_id;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: "company_id is required",
      });
    }

    const companyIdBigInt = BigInt(companyId);

    // Fetch feature configs for this company
    const configs = await prisma.configurations.findMany({
      where: {
        company_id: companyIdBigInt,
        name: { in: SUPPORTED_FEATURES },
      },
    });

    const configMap = {};
    let thresholdValue = DEFAULT_FEATURE_STATES.service_req_threshold_value;

    for (const c of configs) {
      configMap[c.name] = Boolean(c.is_active);
      if (c.name === "service_req_threshold" || c.name === "service_req_thredshold") {
        const desc = c.description && typeof c.description === "object" ? c.description : {};
        thresholdValue = Number(desc.threshold || desc.value) || 3;
        configMap["service_req_threshold"] = Boolean(c.is_active);
      }
    }

    const features = {
      cleaner_assignment:
        configMap.cleaner_assignment !== undefined
          ? configMap.cleaner_assignment
          : DEFAULT_FEATURE_STATES.cleaner_assignment,
      cleaning_request:
        configMap.cleaning_request !== undefined
          ? configMap.cleaning_request
          : DEFAULT_FEATURE_STATES.cleaning_request,
      sla_rules:
        configMap.sla_rules !== undefined
          ? configMap.sla_rules
          : DEFAULT_FEATURE_STATES.sla_rules,
      service_req_threshold:
        configMap.service_req_threshold !== undefined
          ? configMap.service_req_threshold
          : DEFAULT_FEATURE_STATES.service_req_threshold,
      service_req_threshold_value: thresholdValue,
    };

    return res.status(200).json({
      success: true,
      company_id: companyId.toString(),
      features,
    });
  } catch (error) {
    console.error("Error in getCompanyFeatures:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 3. POST /api/feature-management/toggle
 * Super Admin only: Toggle a feature for a company in configurations table
 * Supports dynamic threshold value for 'service_req_threshold'
 */
export const toggleCompanyFeature = async (req, res) => {
  try {
    const userRole = Number(req.user?.role_id);
    if (userRole !== 1) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Only Super Admin (role_id 1) can configure organization feature access.",
      });
    }

    const { company_id, feature_key, is_active, threshold } = req.body;

    if (!company_id) {
      return res.status(400).json({
        success: false,
        message: "company_id is required",
      });
    }

    if (!feature_key || !SUPPORTED_FEATURES.includes(feature_key)) {
      return res.status(400).json({
        success: false,
        message: `Invalid feature_key. Allowed values: ${SUPPORTED_FEATURES.join(", ")}`,
      });
    }

    const companyIdBigInt = BigInt(company_id);
    const activeBool = Boolean(is_active);

    // Normalize key name to standard 'service_req_threshold'
    const normalizedKey =
      feature_key === "service_req_thredshold" ? "service_req_threshold" : feature_key;

    const isThresholdFeature =
      normalizedKey === "service_req_threshold";

    const thresholdNum = isThresholdFeature && threshold !== undefined
      ? Math.max(1, parseInt(threshold, 10) || 3)
      : undefined;

    const updatePayload = {
      is_active: activeBool,
      updated_at: new Date(),
    };

    if (isThresholdFeature && thresholdNum !== undefined) {
      updatePayload.description = { threshold: thresholdNum };
    }

    const createPayload = {
      name: normalizedKey,
      company_id: companyIdBigInt,
      is_active: activeBool,
      notes: `Feature ${normalizedKey} set to ${activeBool} by Super Admin`,
    };

    if (isThresholdFeature) {
      createPayload.description = { threshold: thresholdNum || 3 };
    }

    const updatedConfig = await prisma.configurations.upsert({
      where: {
        name_company_id: {
          name: normalizedKey,
          company_id: companyIdBigInt,
        },
      },
      update: updatePayload,
      create: createPayload,
    });

    const savedThreshold =
      updatedConfig.description && typeof updatedConfig.description === "object"
        ? updatedConfig.description.threshold
        : 3;

    return res.status(200).json({
      success: true,
      message: `Feature '${normalizedKey}' successfully ${activeBool ? "enabled" : "disabled"} for company #${company_id}`,
      data: {
        company_id: company_id.toString(),
        feature_key: normalizedKey,
        is_active: updatedConfig.is_active,
        threshold: isThresholdFeature ? savedThreshold : undefined,
        updated_at: updatedConfig.updated_at,
      },
    });
  } catch (error) {
    console.error("Error in toggleCompanyFeature:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
