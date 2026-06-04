// utils/configValidator.js

const MACHINE_KEY_REGEX = /^[a-z0-9_]+$/;

export function validateUsageCategory(description) {
  if (!description || typeof description !== "object") {
    return { isValid: false, reason: "Payload must be a valid JSON object." };
  }
  if (description.type !== "usage_category") {
    return {
      isValid: false,
      reason: "The property 'type' must be 'usage_category'.",
    };
  }
  if (typeof description.version !== "number") {
    return { isValid: false, reason: "The 'version' must be a number." };
  }
  if (!Array.isArray(description.categories)) {
    return {
      isValid: false,
      reason: "The 'categories' property must be an array.",
    };
  }

  const categoryIds = new Set();

  for (let c = 0; c < description.categories.length; c++) {
    const category = description.categories[c];

    // 1. Category ID Normalization & Validation
    if (
      !category.id ||
      typeof category.id !== "string" ||
      !MACHINE_KEY_REGEX.test(category.id)
    ) {
      return {
        isValid: false,
        reason: `Category at index ${c} requires a lowercase, snake_case string 'id'.`,
      };
    }
    if (categoryIds.has(category.id)) {
      return {
        isValid: false,
        reason: `Duplicate category 'id' detected: '${category.id}'.`,
      };
    }
    categoryIds.add(category.id);

    // 2. Empty Category Label Validation
    if (
      !category.label ||
      typeof category.label !== "string" ||
      category.label.trim().length === 0
    ) {
      return {
        isValid: false,
        reason: `Category '${category.id}' cannot have an empty label.`,
      };
    }

    // 3. Empty Category Validation (Must have entities)
    if (!Array.isArray(category.entities) || category.entities.length === 0) {
      return {
        isValid: false,
        reason: `Category '${category.id}' must contain at least one entity.`,
      };
    }

    const entityIds = new Set();

    for (let e = 0; e < category.entities.length; e++) {
      const entity = category.entities[e];

      // 4. Entity ID Normalization & Validation
      if (
        !entity.id ||
        typeof entity.id !== "string" ||
        !MACHINE_KEY_REGEX.test(entity.id)
      ) {
        return {
          isValid: false,
          reason: `Entity inside '${category.id}' at index ${e} requires a lowercase, snake_case string 'id'.`,
        };
      }
      if (entityIds.has(entity.id)) {
        return {
          isValid: false,
          reason: `Duplicate entity 'id' detected: '${entity.id}' inside '${category.id}'.`,
        };
      }
      entityIds.add(entity.id);

      // 5. Empty Entity Label Validation
      if (
        !entity.label ||
        typeof entity.label !== "string" ||
        entity.label.trim().length === 0
      ) {
        return {
          isValid: false,
          reason: `Entity '${entity.id}' inside '${category.id}' cannot have an empty label.`,
        };
      }

      if (typeof entity.isAiScoringEnabled !== "boolean") {
        return {
          isValid: false,
          reason: `Entity '${entity.id}' requires boolean 'isAiScoringEnabled'.`,
        };
      }
    }
  }

  return { isValid: true };
}
