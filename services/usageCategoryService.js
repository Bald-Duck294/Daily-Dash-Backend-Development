import prisma from "../config/prismaClient.mjs";

/**
 * Extracts entities array safely from a usage_category record's fixtures/metadata
 */
export function getCategoryEntities(category) {
  if (!category) return [];
  if (Array.isArray(category.fixtures)) return category.fixtures;
  if (Array.isArray(category.fixtures?.entities)) return category.fixtures.entities;
  if (Array.isArray(category.metadata?.entities)) return category.metadata.entities;

  // If fixtures is stored as a count map like { wc: 2, urinals: 4 }
  if (category.fixtures && typeof category.fixtures === "object") {
    const keys = Object.keys(category.fixtures).filter(
      (k) => k !== "entities" && k !== "defaultCounts"
    );
    if (keys.length > 0) {
      return keys.map((k) => ({
        id: k,
        label: k.charAt(0).toUpperCase() + k.slice(1),
        isAiScoringEnabled: true,
        defaultValue: typeof category.fixtures[k] === "number" ? category.fixtures[k] : 0,
      }));
    }
  }

  return [];
}

/**
 * Synchronizes a dynamic configuration description (from LOCATION_USAGE_CATEGORY)
 * into the dedicated usage_category table.
 *
 * @param {Object} description - The description JSON with categories array
 * @param {string|number|BigInt|null} companyId - Target company ID or null for global
 */
export async function syncDynamicConfigToUsageCategory(description, companyId = null) {
  if (!description || !Array.isArray(description.categories)) {
    return [];
  }

  const targetCompanyId = companyId ? BigInt(companyId) : null;
  const categories = description.categories;
  const synchronizedCategories = [];
  const processedCodes = new Set();

  for (const cat of categories) {
    const code = (cat.id || "").trim();
    const name = (cat.label || code).trim();
    if (!name) continue;

    processedCodes.add(code);

    const fixturesPayload = {
      entities: Array.isArray(cat.entities) ? cat.entities : [],
    };

    // Check if category already exists for this company scope
    const existing = await prisma.usage_category.findFirst({
      where: {
        company_id: targetCompanyId,
        OR: [
          { code: code },
          { name: { equals: name, mode: "insensitive" } },
        ],
      },
    });

    if (existing) {
      const updated = await prisma.usage_category.update({
        where: { id: existing.id },
        data: {
          name,
          code,
          fixtures: fixturesPayload,
          is_active: true,
          deleted_at: null,
          metadata: {
            ...(existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {}),
            type: "usage_category",
            version: description.version || 1,
            last_synced_at: new Date().toISOString(),
          },
          updated_at: new Date(),
        },
      });
      synchronizedCategories.push(updated);
    } else {
      const created = await prisma.usage_category.create({
        data: {
          company_id: targetCompanyId,
          name,
          code,
          fixtures: fixturesPayload,
          is_active: true,
          metadata: {
            type: "usage_category",
            version: description.version || 1,
            source: "dynamic_configuration",
            synced_at: new Date().toISOString(),
          },
        },
      });
      synchronizedCategories.push(created);
    }
  }

  // Deactivate or soft-delete any categories for this company that were removed in the config
  const existingActiveCategories = await prisma.usage_category.findMany({
    where: {
      company_id: targetCompanyId,
      deleted_at: null,
      is_active: true,
    },
  });

  for (const existingCat of existingActiveCategories) {
    if (!processedCodes.has(existingCat.code)) {
      await prisma.usage_category.update({
        where: { id: existingCat.id },
        data: {
          deleted_at: new Date(),
          is_active: false,
        },
      });
    }
  }

  return synchronizedCategories;
}

/**
 * Reconstructs a dynamic configuration payload from usage_category table records
 * matching what Frontend UsageCategoryEditor expects.
 */
export async function getUsageCategoriesAsDynamicConfig(companyId = null) {
  const targetCompanyId = companyId ? BigInt(companyId) : null;

  // 1. Try company-specific categories first
  let categories = [];
  if (targetCompanyId) {
    categories = await prisma.usage_category.findMany({
      where: {
        company_id: targetCompanyId,
        deleted_at: null,
        is_active: true,
      },
      orderBy: { id: "asc" },
    });
  }

  // 2. If no company categories, fetch global templates (company_id = null)
  if (categories.length === 0) {
    categories = await prisma.usage_category.findMany({
      where: {
        company_id: null,
        deleted_at: null,
        is_active: true,
      },
      orderBy: { id: "asc" },
    });
  }

  if (categories.length === 0) {
    return null;
  }

  return {
    type: "usage_category",
    version: 1,
    categories: categories.map((cat) => ({
      id: cat.code || cat.name.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      label: cat.name,
      usageCategoryId: cat.id,
      entities: getCategoryEntities(cat),
    })),
  };
}

/**
 * Ensures a company has its own local usage categories in usage_category table.
 * If company has none, it automatically clones from Global Master Templates.
 * If usage_category table is completely empty, it syncs from configurations table first.
 * Returns the company's local usage categories (with standard integer IDs).
 */
export async function getOrCreateCompanyUsageCategories(companyId) {
  if (!companyId) {
    // If no company context, return global templates
    let globals = await prisma.usage_category.findMany({
      where: { company_id: null, deleted_at: null, is_active: true },
      orderBy: { id: "asc" },
    });

    if (globals.length === 0) {
      await syncAllExistingConfigurationsToUsageCategories();
      globals = await prisma.usage_category.findMany({
        where: { company_id: null, deleted_at: null, is_active: true },
        orderBy: { id: "asc" },
      });
    }

    return globals;
  }

  const parsedCompanyId = BigInt(companyId);

  // 1. Check if the company already has local categories in usage_category
  const existingCompanyCategories = await prisma.usage_category.findMany({
    where: {
      company_id: parsedCompanyId,
      deleted_at: null,
      is_active: true,
    },
    orderBy: { id: "asc" },
  });

  if (existingCompanyCategories.length > 0) {
    return existingCompanyCategories;
  }

  // 2. Check if the company had a legacy configuration in configurations table
  const legacyCompanyConfig = await prisma.configurations.findFirst({
    where: {
      name: "LOCATION_USAGE_CATEGORY",
      company_id: parsedCompanyId,
      is_active: true,
    },
  });

  if (legacyCompanyConfig?.description?.categories?.length > 0) {
    const synced = await syncDynamicConfigToUsageCategory(
      legacyCompanyConfig.description,
      parsedCompanyId
    );
    if (synced.length > 0) return synced;
  }

  // 3. First-time access: Fetch Global Master Templates
  let globalTemplates = await prisma.usage_category.findMany({
    where: {
      company_id: null,
      deleted_at: null,
      is_active: true,
    },
    orderBy: { id: "asc" },
  });

  // If no global templates in usage_category, sync from configurations table first
  if (globalTemplates.length === 0) {
    await syncAllExistingConfigurationsToUsageCategories();
    globalTemplates = await prisma.usage_category.findMany({
      where: {
        company_id: null,
        deleted_at: null,
        is_active: true,
      },
      orderBy: { id: "asc" },
    });
  }

  if (globalTemplates.length === 0) {
    return [];
  }

  // 4. COPY-ON-DEMAND: Clone global templates into company's local scope
  const categoriesToCreate = globalTemplates.map((template) => ({
    company_id: parsedCompanyId,
    name: template.name,
    code: template.code,
    fixtures: template.fixtures,
    is_active: true,
    metadata: {
      cloned_from_global_id: template.id,
      cloned_at: new Date().toISOString(),
    },
  }));

  await prisma.usage_category.createMany({
    data: categoriesToCreate,
  });

  // 5. Return the newly created company-local categories
  return await prisma.usage_category.findMany({
    where: {
      company_id: parsedCompanyId,
      deleted_at: null,
      is_active: true,
    },
    orderBy: { id: "asc" },
  });
}

/**
 * Migration & Sync utility: Migrates all existing LOCATION_USAGE_CATEGORY configurations
 * from configurations table into usage_category table.
 */
export async function syncAllExistingConfigurationsToUsageCategories() {
  const configs = await prisma.configurations.findMany({
    where: {
      name: "LOCATION_USAGE_CATEGORY",
      is_active: true,
    },
    orderBy: { id: "asc" },
  });

  let totalSynced = 0;
  for (const cfg of configs) {
    if (cfg.description?.categories) {
      const synced = await syncDynamicConfigToUsageCategory(
        cfg.description,
        cfg.company_id
      );
      totalSynced += synced.length;
    }
  }

  return { totalConfigurationsProcessed: configs.length, totalCategoriesSynced: totalSynced };
}

