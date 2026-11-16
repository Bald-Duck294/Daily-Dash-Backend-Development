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

/**
 * 1. GET /api/sla-penalty/company-status
 * Super Admin only (role_id === 1): List all companies with their sla_rules configuration status
 */
export const getAllCompaniesSlaRulesStatus = async (req, res) => {
  try {
    const userRole = Number(req.user?.role_id);
    if (userRole !== 1) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Super Admin access required."
      });
    }

    // 1. Fetch active companies
    const companies = await prisma.companies.findMany({
      where: {
        deleted_at: null,
        status: true
      },
      select: {
        id: true,
        name: true,
        contact_email: true,
        created_at: true,
        status: true
      },
      orderBy: { name: "asc" }
    });

    // 2. Fetch all configurations records for 'sla_rules'
    const configs = await prisma.configurations.findMany({
      where: {
        name: "sla_rules"
      }
    });

    const configMap = {};
    for (const c of configs) {
      if (c.company_id) {
        configMap[c.company_id.toString()] = c;
      }
    }

    const result = companies.map((comp) => {
      const compIdStr = comp.id.toString();
      const cfg = configMap[compIdStr];
      return {
        company_id: compIdStr,
        company_name: comp.name || `Company #${compIdStr}`,
        contact_email: comp.contact_email || null,
        is_active: Boolean(cfg?.is_active),
        updated_at: cfg?.updated_at || null,
        config_id: cfg?.id ? cfg.id.toString() : null
      };
    });

    return res.status(200).json({
      success: true,
      data: result,
      total: result.length,
      active_count: result.filter((r) => r.is_active).length,
      inactive_count: result.filter((r) => !r.is_active).length
    });
  } catch (error) {
    console.error("Error in getAllCompaniesSlaRulesStatus:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 2. GET /api/sla-penalty/company-status/:companyId
 * Check if sla_rules is active for a specific company
 */
export const getCompanySlaRulesStatus = async (req, res) => {
  try {
    const companyId = req.params.companyId || req.query.company_id || req.user?.company_id;
    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: "company_id is required"
      });
    }

    const companyIdBigInt = BigInt(companyId);

    const config = await prisma.configurations.findFirst({
      where: {
        name: "sla_rules",
        company_id: companyIdBigInt
      }
    });

    return res.status(200).json({
      success: true,
      data: {
        company_id: companyId.toString(),
        is_active: Boolean(config?.is_active),
        updated_at: config?.updated_at || null
      }
    });
  } catch (error) {
    console.error("Error in getCompanySlaRulesStatus:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 3. POST /api/sla-penalty/toggle-status
 * Super Admin only: Toggle sla_rules on/off for a company in configurations table
 */
export const toggleCompanySlaRules = async (req, res) => {
  try {
    const userRole = Number(req.user?.role_id);
    if (userRole !== 1) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Only Super Admin (role_id 1) can configure organization SLA access."
      });
    }

    const { company_id, is_active } = req.body;
    if (!company_id) {
      return res.status(400).json({
        success: false,
        message: "company_id is required"
      });
    }

    const companyIdBigInt = BigInt(company_id);
    const activeBool = Boolean(is_active);

    const updatedConfig = await prisma.configurations.upsert({
      where: {
        name_company_id: {
          name: "sla_rules",
          company_id: companyIdBigInt
        }
      },
      update: {
        is_active: activeBool,
        updated_at: new Date()
      },
      create: {
        name: "sla_rules",
        company_id: companyIdBigInt,
        is_active: activeBool,
        notes: "Managed via Super Admin SLA Feature Control"
      }
    });

    return res.status(200).json({
      success: true,
      message: `SLA Rules module ${activeBool ? "enabled" : "disabled"} successfully`,
      data: serializeBigInt(updatedConfig)
    });
  } catch (error) {
    console.error("Error in toggleCompanySlaRules:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
