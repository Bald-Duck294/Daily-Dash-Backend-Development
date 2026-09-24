/**
 * SLA & Escalation Hierarchy Validator
 * Validates SLA configuration payloads and escalation ladders.
 */

export const ALLOWED_TARGET_ROLES = [
    "cleaner",
    "supervisor",
    "admin",
    "super_admin",
    "zonal_admin",
    "facility_supv",
    "facility_admin"
];

/**
 * Validates the levels array of an escalation configuration.
 * @param {Array} levels - Array of escalation levels
 * @param {boolean} isEnabled - Whether escalation is active
 * @returns {{ isValid: boolean, error?: string, normalizedLevels?: Array }}
 */
export const validateEscalationLevels = (levels, isEnabled = true) => {
    if (!Array.isArray(levels)) {
        return { isValid: false, error: "Escalation 'levels' must be an array." };
    }

    if (isEnabled && levels.length === 0) {
        return { isValid: false, error: "At least one escalation level is required when escalation is enabled." };
    }

    if (levels.length > 10) {
        return { isValid: false, error: "Maximum of 10 escalation levels allowed." };
    }

    const seenLevels = new Set();
    const normalizedLevels = [];

    for (let i = 0; i < levels.length; i++) {
        const item = levels[i];

        if (!item || typeof item !== "object") {
            return { isValid: false, error: `Invalid level definition at index ${i}. Must be an object.` };
        }

        // Validate target_role
        const role = String(item.target_role || "").trim().toLowerCase();
        if (!role) {
            return { isValid: false, error: `Target role is required for Level ${i + 1}.` };
        }

        // Validate delay_minutes
        const delay = Number(item.delay_minutes);
        if (isNaN(delay) || delay < 0 || !Number.isInteger(delay)) {
            return { isValid: false, error: `Delay minutes for Level ${i + 1} must be an integer >= 0.` };
        }

        // Validate delay progression (non-decreasing)
        if (i > 0) {
            const prevDelay = Number(normalizedLevels[i - 1].delay_minutes);
            if (delay < prevDelay) {
                return {
                    isValid: false,
                    error: `Level ${i + 1} delay (${delay}m) cannot be less than Level ${i} delay (${prevDelay}m). Escalation delays must be chronological.`
                };
            }
        }

        const levelNum = Number(item.level ?? (i + 1));
        if (seenLevels.has(levelNum)) {
            return { isValid: false, error: `Duplicate level number '${levelNum}' detected.` };
        }
        seenLevels.add(levelNum);

        normalizedLevels.push({
            level: i + 1, // Sequential re-indexing
            target_role: role,
            delay_minutes: delay,
            send_notification: item.send_notification !== false
        });
    }

    return { isValid: true, normalizedLevels };
};

/**
 * Validates the full SLA configuration update payload.
 * @param {object} payload - Key-value map of updates
 * @returns {{ isValid: boolean, error?: string, sanitizedUpdates?: object }}
 */
export const validateSlaConfiguration = (payload) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return { isValid: false, error: "Payload must be a valid JSON object." };
    }

    const sanitizedUpdates = {};

    // 1. threshold_score
    if (payload.threshold_score !== undefined) {
        const score = Number(payload.threshold_score);
        if (isNaN(score) || score < 0 || score > 10) {
            return { isValid: false, error: "threshold_score must be a number between 0 and 10." };
        }
        sanitizedUpdates.threshold_score = Math.round(score * 10) / 10;
    }

    // 2. max_retry_attempts
    if (payload.max_retry_attempts !== undefined) {
        const retries = Number(payload.max_retry_attempts);
        if (isNaN(retries) || !Number.isInteger(retries) || retries < 0 || retries > 10) {
            return { isValid: false, error: "max_retry_attempts must be an integer between 0 and 10." };
        }
        sanitizedUpdates.max_retry_attempts = retries;
    }

    // 3. notify_cleaner
    if (payload.notify_cleaner !== undefined) {
        sanitizedUpdates.notify_cleaner = Boolean(payload.notify_cleaner);
    }

    // 4. notify_supervisor
    if (payload.notify_supervisor !== undefined) {
        sanitizedUpdates.notify_supervisor = Boolean(payload.notify_supervisor);
    }

    // 5. max_score_updates_per_activity
    if (payload.max_score_updates_per_activity !== undefined) {
        const updates = Number(payload.max_score_updates_per_activity);
        if (isNaN(updates) || !Number.isInteger(updates) || updates < 1 || updates > 10) {
            return { isValid: false, error: "max_score_updates_per_activity must be an integer between 1 and 10." };
        }
        sanitizedUpdates.max_score_updates_per_activity = updates;
    }

    // 6. version
    if (payload.version !== undefined) {
        const ver = Number(payload.version);
        sanitizedUpdates.version = isNaN(ver) ? 1 : ver;
    }

    // 7. escalation
    if (payload.escalation !== undefined) {
        if (!payload.escalation || typeof payload.escalation !== "object" || Array.isArray(payload.escalation)) {
            return { isValid: false, error: "escalation must be a valid JSON object." };
        }

        const isEnabled = payload.escalation.enabled !== undefined
            ? Boolean(payload.escalation.enabled)
            : true;

        const levelsValidation = validateEscalationLevels(payload.escalation.levels || [], isEnabled);
        if (!levelsValidation.isValid) {
            return { isValid: false, error: levelsValidation.error };
        }

        sanitizedUpdates.escalation = {
            enabled: isEnabled,
            levels: levelsValidation.normalizedLevels
        };
    }

    return { isValid: true, sanitizedUpdates };
};
