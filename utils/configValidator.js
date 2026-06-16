// utils/configValidator.js

// utils/configValidator.js

const MACHINE_KEY_REGEX = /^[a-zA-Z0-9_]+$/;
const VALID_FIELD_TYPES = [
  "boolean",
  "number",
  "text",
  "select",
  "multiselect",
];

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

export function validateAdditionalFeatures(description) {
  if (!description || typeof description !== "object") {
    return { isValid: false, reason: "Payload must be a valid JSON object." };
  }
  if (description.type !== "additional_features") {
    return {
      isValid: false,
      reason: "The property 'type' must be 'additional_features'.",
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
  const fieldKeys = new Set();

  for (let c = 0; c < description.categories.length; c++) {
    const category = description.categories[c];

    if (
      !category.id ||
      typeof category.id !== "string" ||
      !MACHINE_KEY_REGEX.test(category.id)
    ) {
      return {
        isValid: false,
        reason: `Category at index ${c} requires a valid string 'id'.`,
      };
    }
    if (categoryIds.has(category.id)) {
      return {
        isValid: false,
        reason: `Duplicate category 'id' detected: '${category.id}'.`,
      };
    }
    categoryIds.add(category.id);

    if (
      !category.label ||
      typeof category.label !== "string" ||
      category.label.trim() === ""
    ) {
      return {
        isValid: false,
        reason: `Category '${category.id}' cannot have an empty label.`,
      };
    }

    if (typeof category.sortOrder !== "number") {
      return {
        isValid: false,
        reason: `Category '${category.id}' requires a numeric 'sortOrder'.`,
      };
    }

    if (!Array.isArray(category.fields)) {
      return {
        isValid: false,
        reason: `Category '${category.id}' must contain a 'fields' array.`,
      };
    }

    for (let f = 0; f < category.fields.length; f++) {
      const field = category.fields[f];

      if (
        !field.key ||
        typeof field.key !== "string" ||
        !MACHINE_KEY_REGEX.test(field.key)
      ) {
        return {
          isValid: false,
          reason: `Field at index ${f} in '${category.id}' requires a valid 'key'.`,
        };
      }
      if (fieldKeys.has(field.key)) {
        return {
          isValid: false,
          reason: `Duplicate field 'key' detected globally across categories: '${field.key}'.`,
        };
      }
      fieldKeys.add(field.key);

      if (
        !field.label ||
        typeof field.label !== "string" ||
        field.label.trim() === ""
      ) {
        return {
          isValid: false,
          reason: `Field '${field.key}' requires a label.`,
        };
      }

      if (!VALID_FIELD_TYPES.includes(field.type)) {
        return {
          isValid: false,
          reason: `Field '${field.key}' has an invalid type: '${field.type}'. Allowed: ${VALID_FIELD_TYPES.join(", ")}.`,
        };
      }

      if (typeof field.sortOrder !== "number") {
        return {
          isValid: false,
          reason: `Field '${field.key}' requires a numeric 'sortOrder'.`,
        };
      }

      // Enforce options for select/multiselect
      if (["select", "multiselect"].includes(field.type)) {
        if (!Array.isArray(field.options) || field.options.length === 0) {
          return {
            isValid: false,
            reason: `Field '${field.key}' is a ${field.type} and requires a non-empty 'options' array.`,
          };
        }
        for (let opt of field.options) {
          if (!opt.label || !opt.value) {
            return {
              isValid: false,
              reason: `Options in field '${field.key}' must have 'label' and 'value'.`,
            };
          }
        }
      }

      // Validate Conditional Logic
      if (field.visibleWhen) {
        if (
          !field.visibleWhen.field ||
          field.visibleWhen.equals === undefined
        ) {
          return {
            isValid: false,
            reason: `Field '${field.key}' has invalid 'visibleWhen' logic. Must contain 'field' and 'equals'.`,
          };
        }
      }
    }
  }

  return { isValid: true };
}
