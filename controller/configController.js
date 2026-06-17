import prisma from "../config/prismaClient.mjs";
import {
  validateUsageCategory,
  validateAdditionalFeatures,
} from "../utils/configValidator.js";
import { DYNAMIC_MODULES } from "../utils/configRegistry.js";
// Safe JSON Serialization Utility for BigInt structural bounds
function convertBigInts(obj) {
  if (Array.isArray(obj)) return obj.map(convertBigInts);
  if (obj && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [
        key,
        typeof value === "bigint" ? value.toString() : convertBigInts(value),
      ]),
    );
  }
  return obj;
}

/**
 * Route 1: GET /api/configurations/modules
 * Lists currently registered extensible configuration targets
 */
// export async function getDynamicModules(req, res) {
//   try {
//     const modules = [
//       {
//         name: "LOCATION_FACILITY_METRICS",
//         label: "Usage Categories",
//         phase: 1,
//         description:
//           "Manages functional space categories and AI photographic criteria structural parameters",
//       },
//     ];
//     return res.status(200).json({ status: "success", data: modules });
//   } catch (error) {
//     console.error("Discovery error:", error);
//     return res.status(500).json({
//       status: "error",
//       message: "Internal application processing failure.",
//     });
//   }
// }

/**
 * Route 1: GET /api/configurations/modules
 * Returns the centralized registry of extensible modules
 */
export async function getDynamicModules(req, res) {
  try {
    return res.status(200).json({
      status: "success",
      data: DYNAMIC_MODULES,
    });
  } catch (error) {
    console.error("Discovery error:", error);
    return res
      .status(500)
      .json({ status: "error", message: "Internal server error." });
  }
}

/**
 * Route 2: GET /api/configurations/name/:name
 * Performs hierarchical lookup for global/tenant matches
 */
export async function getConfigByRouteName(req, res) {
  const { name } = req.params;
  const companyId = req.query.company_id || req.query.companyId;

  if (!name) {
    return res.status(400).json({
      status: "error",
      message: "Target token key name argument parameter required.",
    });
  }

  try {
    let configurationRecord = null;

    if (companyId) {
      configurationRecord = await prisma.configurations.findFirst({
        where: { name, company_id: BigInt(companyId) },
      });
    }

    if (!configurationRecord) {
      configurationRecord = await prisma.configurations.findFirst({
        where: { name, company_id: null },
      });
    }

    if (!configurationRecord) {
      return res.status(404).json({
        status: "error",
        message: `Configuration criteria definition identifier '${name}' not initialized inside database layer.`,
      });
    }

    return res.status(200).json({
      status: "success",
      data: convertBigInts(configurationRecord),
    });
  } catch (error) {
    console.error("Lookup evaluation exception error:", error);
    return res
      .status(500)
      .json({ status: "error", message: "Database lookup execution error." });
  }
}

/**
 * Route 3: PUT /api/configurations/name/:name
 */
export async function updateConfigByRouteName(req, res) {
  const { name } = req.params;
  const { description, company_id, is_active, notes } = req.body;

  // Branching Validation based on Module Name
  if (name === "LOCATION_USAGE_CATEGORY") {
    const validation = validateUsageCategory(description);
    if (!validation.isValid)
      return res
        .status(422)
        .json({ status: "error", message: validation.reason });
  } else if (name === "LOCATION_ADDITIONAL_FEATURES") {
    const validation = validateAdditionalFeatures(description);
    if (!validation.isValid)
      return res
        .status(422)
        .json({ status: "error", message: validation.reason });
  }

  const targetedCompanyId = company_id ? BigInt(company_id) : null;

  try {
    const activeTargetRecord = await prisma.configurations.findFirst({
      where: { name, company_id: targetedCompanyId },
    });

    let savedResultRecord;

    if (activeTargetRecord) {
      savedResultRecord = await prisma.configurations.update({
        where: { id: activeTargetRecord.id },
        data: {
          description: description,
          is_active:
            is_active !== undefined ? is_active : activeTargetRecord.is_active,
          notes: notes !== undefined ? notes : activeTargetRecord.notes,
          updated_at: new Date(),
        },
      });
    } else {
      savedResultRecord = await prisma.configurations.create({
        data: {
          name,
          description: description,
          company_id: targetedCompanyId,
          is_active: is_active !== undefined ? is_active : true,
          notes: notes || "System generated configuration.",
        },
      });
    }

    return res.status(200).json({
      status: "success",
      message: "Configuration updated successfully.",
      data: convertBigInts(savedResultRecord),
    });
  } catch (error) {
    console.error("Update error:", error);
    return res
      .status(500)
      .json({ status: "error", message: "Failed to update configuration." });
  }
}

/**
 * Route 4: GET /api/configurations/location-schema
 * Aggregates multiple configuration modules into a single schema for the frontend
 */
export async function getLocationSchema(req, res) {
  const companyId = req.query.company_id || req.query.companyId;
  const targetedCompanyId = companyId ? BigInt(companyId) : null;

  try {
    // 1. Fetch Usage Category
    const usageConfig = await prisma.configurations.findFirst({
      where: {
        name: "LOCATION_USAGE_CATEGORY",
        is_active: true,
        OR: targetedCompanyId
          ? [{ company_id: targetedCompanyId }, { company_id: null }]
          : [{ company_id: null }],
      },
      orderBy: { company_id: "asc" },
    });

    // 2. Fetch Additional Features
    const featuresConfig = await prisma.configurations.findFirst({
      where: {
        name: "LOCATION_ADDITIONAL_FEATURES",
        is_active: true,
        OR: targetedCompanyId
          ? [{ company_id: targetedCompanyId }, { company_id: null }]
          : [{ company_id: null }],
      },
      orderBy: { company_id: "asc" },
    });

    // Process Usage Categories
    let formattedUsageCategories = [];
    if (usageConfig?.description?.categories) {
      formattedUsageCategories = usageConfig.description.categories.map(
        (category) => ({
          id: category.id,
          label: category.label,
          entities: (category.entities || []).map((entity) => ({
            id: entity.id,
            label: entity.label,
            isAiScoringEnabled: entity.isAiScoringEnabled,
            defaultValue: 0,
          })),
        }),
      );
    }

    // Process Additional Features
    let formattedAdditionalFeatures = [];
    if (featuresConfig?.description?.categories) {
      const sortedCategories = [...featuresConfig.description.categories].sort(
        (a, b) => a.sortOrder - b.sortOrder,
      );

      formattedAdditionalFeatures = sortedCategories.map((category) => ({
        id: category.id,
        label: category.label,
        sortOrder: category.sortOrder,
        fields: (category.fields || [])
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((field) => ({
            key: field.key,
            type: field.type,
            label: field.label,
            defaultValue:
              field.defaultValue ?? (field.type === "boolean" ? false : null),
            options: field.options || undefined,
            visibleWhen: field.visibleWhen || undefined,
          })),
      }));
    }

    return res.status(200).json({
      status: "success",
      data: {
        usageCategories: formattedUsageCategories,
        additionalFeatures: formattedAdditionalFeatures,
      },
    });
  } catch (error) {
    console.error("Schema generation error:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to generate location schema.",
    });
  }
}

export async function duplicateConfiguration(req, res) {
  const { id } = req.params;
  const { company_id, name } = req.body;

  if (!id) {
    return res.status(400).json({
      status: "error",
      message: "Missing 'id' in request parameters.",
    });
  }

  try {
    // Get the original configuration
    const originalConfig = await prisma.configurations.findUnique({
      where: { id: BigInt(id) },
    });

    if (!originalConfig) {
      return res.status(404).json({
        status: "error",
        message: "Original configuration not found.",
      });
    }

    // Create the duplicate
    const duplicateConfig = await prisma.configurations.create({
      data: {
        name: name || `${originalConfig.name}_copy`,
        description: originalConfig.description,
        company_id: company_id ? BigInt(company_id) : null,
        is_active: false, // Start as inactive
        notes: `Duplicated from ${originalConfig.name} (ID: ${originalConfig.id})`,
      },
    });

    const safeDuplicate = convertBigInts(duplicateConfig);

    res.status(201).json({
      status: "success",
      data: safeDuplicate,
      message: "Configuration duplicated successfully!",
    });
  } catch (error) {
    console.error("Error duplicating configuration:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error.",
    });
  }
}

export async function deleteConfiguration(req, res) {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({
      status: "error",
      message: "Missing 'id' in request parameters.",
    });
  }

  try {
    // Check if configuration exists
    const existingConfig = await prisma.configurations.findUnique({
      where: { id: BigInt(id) },
    });

    if (!existingConfig) {
      return res.status(404).json({
        status: "error",
        message: "Configuration not found.",
      });
    }

    await prisma.configurations.delete({
      where: { id: BigInt(id) },
    });

    res.json({
      status: "success",
      message: "Configuration deleted successfully!",
    });
  } catch (error) {
    console.error("Error deleting configuration:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error.",
    });
  }
}

// ✅ Get All Configurations
export async function getAllConfigurations(req, res) {
  const { company_id, is_active, name, include_global } = req.query;

  try {
    const whereClause = {};

    // Secure multi-tenant fetching logic
    if (company_id) {
      if (include_global === "true") {
        whereClause.OR = [
          { company_id: BigInt(company_id) },
          { company_id: null }, // Include system global template
        ];
      } else {
        whereClause.company_id = BigInt(company_id);
      }
    } else {
      // Security Failsafe: If no company_id is passed, ONLY return global templates.
      // This prevents a generic request from leaking every company's private configs.
      whereClause.company_id = null;
    }

    if (is_active !== undefined) {
      whereClause.is_active = is_active === "true";
    }
    if (name) {
      whereClause.name = name; // Exact match is safer than contains for config keys
    }

    const configs = await prisma.configurations.findMany({
      where: whereClause,
      orderBy: { updated_at: "desc" },
    });

    const safeConfigs = convertBigInts(configs);

    res.json({
      status: "success",
      data: safeConfigs,
      message: "Configurations retrieved successfully!",
    });
  } catch (error) {
    console.error("Error fetching configurations:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error.",
    });
  }
}
// ✅ Get Configuration by ID (Your existing one - enhanced)
export async function getConfigurationById(req, res) {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({
      status: "error",
      message: "Missing 'id' in request parameters.",
    });
  }

  try {
    const config = await prisma.configurations.findUnique({
      where: {
        id: BigInt(id),
      },
    });

    if (!config) {
      return res.status(404).json({
        status: "error",
        message: `Configuration with id '${id}' not found.`,
      });
    }

    const safeConfig = convertBigInts(config);

    res.json({
      status: "success",
      data: safeConfig,
      message: "Data retrieved successfully!",
    });
  } catch (error) {
    console.error("Error fetching configuration:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error.",
    });
  }
}

// ✅ Get available templates
export async function getConfigurationTemplates(req, res) {
  try {
    const templates = getAllTemplates();

    res.json({
      status: "success",
      data: templates,
      message: "Templates retrieved successfully!",
    });
  } catch (error) {
    console.error("Error fetching templates:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error.",
    });
  }
}

// ✅ Enhanced getConfigurationByName with template fallback
export async function getConfigurationByName(req, res) {
  console.log("Get config by name");
  const { name } = req.params;
  const { company_id } = req.query;

  if (!name) {
    return res.status(400).json({
      status: "error",
      message: "Missing 'name' in request parameters.",
    });
  }

  try {
    let config = null;

    // Try to get company-specific config first
    if (company_id) {
      config = await prisma.configurations.findFirst({
        where: {
          name: name,
          company_id: BigInt(company_id),
        },
      });
    }

    // If no company-specific config, try global config
    if (!config) {
      config = await prisma.configurations.findFirst({
        where: {
          name: name,
          company_id: null,
        },
      });
    }

    // If still no config, check if it's a valid template and return default
    if (!config) {
      const template = getTemplateByName(name);
      if (template) {
        return res.json({
          status: "success",
          data: [
            {
              name: template.name,
              description: template.defaultSchema,
              is_template_default: true,
              template_info: {
                displayName: template.displayName,
                description: template.description,
                category: template.category,
              },
            },
          ],
          message: "Template default retrieved successfully!",
        });
      } else {
        return res.status(404).json({
          status: "error",
          message: `Configuration with name '${name}' not found.`,
        });
      }
    }

    const safeConfig = convertBigInts([config]);

    res.json({
      status: "success",
      data: safeConfig,
      message: "Data retrieved successfully!",
    });
  } catch (error) {
    console.error("Error fetching configuration:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error.",
    });
  }
}

// ✅ Get Configuration by Name (Your existing one - enhanced)
// export async function getConfigurationByName(req, res) {
//   console.log('Get config by name');
//   const { name } = req.params;
//   const { company_id } = req.query;
//   console.log(name, "name from the request");
//   console.log(company_id, "company_id from the request");

//   if (!name) {
//     return res.status(400).json({
//       status: "error",
//       message: "Missing 'name' in request parameters.",
//     });
//   }

//   try {
//     console.log(`Fetching configuration with name: ${name}`);

//     const whereClause = { name: name };

//     // If company_id is provided, prioritize company-specific config
//     if (company_id) {
//       whereClause.company_id = BigInt(company_id);
//     }

//     let config = await prisma.configurations.findMany({
//       where: whereClause,
//     });

//     // If no company-specific config found and company_id was provided,
//     // fallback to global config (company_id = null)
//     if ((!config || config.length === 0) && company_id) {
//       config = await prisma.configurations.findMany({
//         where: {
//           name: name,
//           company_id: null
//         },
//       });
//     }

//     if (!config || config.length === 0) {
//       return res.status(404).json({
//         status: "error",
//         message: `Configuration with name '${name}' not found.`,
//       });
//     }

//     const safeConfig = convertBigInts(config);

//     res.json({
//       status: "success",
//       data: safeConfig,
//       message: "Data retrieved successfully!",
//     });
//   } catch (error) {
//     console.error("Error fetching configuration:", error);
//     res.status(500).json({
//       status: "error",
//       message: "Internal server error."
//     });
//   }
// }

// ✅ Create Configuration
export async function createConfiguration(req, res) {
  const { name, description, company_id, is_active, notes } = req.body;

  if (!id) {
    return res.status(400).json({
      status: "error",
      message: "Missing 'id' in request parameters.",
    });
  }

  try {
    const existingConfig = await prisma.configurations.findUnique({
      where: { id: BigInt(id) },
    });

    if (!existingConfig) {
      return res.status(404).json({
        status: "error",
        message: "Configuration not found.",
      });
    }

    const config = await prisma.configurations.update({
      where: { id: BigInt(id) },
      data: {
        is_active: !existingConfig.is_active,
        updated_at: new Date(),
      },
    });

    const safeConfig = convertBigInts(config);

    res.json({
      status: "success",
      data: safeConfig,
      message: `Configuration ${config.is_active ? "activated" : "deactivated"} successfully!`,
    });
  } catch (error) {
    console.error("Error toggling configuration status:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error.",
    });
  }
}

// ✅ Update Configuration
export async function updateConfiguration(req, res) {
  const { id } = req.params;
  const { name, description, company_id, is_active, notes } = req.body;

  if (!id) {
    return res.status(400).json({
      status: "error",
      message: "Missing 'id' in request parameters.",
    });
  }

  try {
    // Check if configuration exists
    const existingConfig = await prisma.configurations.findUnique({
      where: { id: BigInt(id) },
    });

    if (!existingConfig) {
      return res.status(404).json({
        status: "error",
        message: "Configuration not found.",
      });
    }

    const updateData = {
      updated_at: new Date(),
    };

    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (company_id !== undefined) {
      updateData.company_id = company_id ? BigInt(company_id) : null;
    }
    if (is_active !== undefined) updateData.is_active = is_active;
    if (notes !== undefined) updateData.notes = notes;

    const config = await prisma.configurations.update({
      where: { id: BigInt(id) },
      data: updateData,
    });

    const safeConfig = convertBigInts(config);

    res.json({
      status: "success",
      data: safeConfig,
      message: "Configuration updated successfully!",
    });
  } catch (error) {
    console.error("Error updating configuration:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error.",
    });
  }
}
