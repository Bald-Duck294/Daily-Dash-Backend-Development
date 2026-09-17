import prisma from "../config/prismaClient.mjs";
import { DEFAULT_SLA_CONFIGURATION } from "../constant/slaDefaults.js";
import { getCompanySLAConfiguration } from "../services/slaConfigurationService.js";

// Helper to serialize BigInt for JSON responses
const serializeBigInt = (obj) => {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'bigint') return obj.toString();
    if (Array.isArray(obj)) return obj.map(serializeBigInt);
    if (typeof obj === 'object') {
        return Object.fromEntries(
            Object.entries(obj).map(([key, value]) => [key, serializeBigInt(value)])
        );
    }
    return obj;
};

export const getWashroomSLAConfiguration = async (req, res) => {
    try {
        const { location_id } = req.params;

        if (!location_id) {
            return res.status(400).json({ success: false, message: "location_id is required" });
        }

        const location = await prisma.locations.findUnique({
            where: { id: BigInt(location_id) },
            select: {
                id: true,
                name: true,
                company_id: true,
                sla_config: true,
                metadata: true
            }
        });

        if (!location) {
            return res.status(404).json({ success: false, message: "Washroom location not found" });
        }

        // 1. Fetch parent company master SLA status
        const companySla = location.company_id
            ? await getCompanySLAConfiguration(location.company_id)
            : { enabled: false, configuration: null };

        // 2. Read from sla_config (fallback to legacy metadata.sla if present)
        const sla = (location.sla_config && typeof location.sla_config === "object")
            ? location.sla_config
            : (location.metadata?.sla || {});

        const isEnabled = sla.enabled !== undefined
            ? Boolean(sla.enabled)
            : (sla.is_active !== undefined ? Boolean(sla.is_active) : false);

        const configuration = {
            threshold_score: Number(sla.threshold_score ?? companySla.configuration?.threshold_score ?? DEFAULT_SLA_CONFIGURATION.threshold_score),
            max_retry_attempts: Number(sla.max_retry_attempts ?? companySla.configuration?.max_retry_attempts ?? DEFAULT_SLA_CONFIGURATION.max_retry_attempts),
            notify_cleaner: sla.notify_cleaner !== undefined ? Boolean(sla.notify_cleaner) : (companySla.configuration?.notify_cleaner ?? DEFAULT_SLA_CONFIGURATION.notify_cleaner),
            notify_supervisor: sla.notify_supervisor !== undefined ? Boolean(sla.notify_supervisor) : (companySla.configuration?.notify_supervisor ?? DEFAULT_SLA_CONFIGURATION.notify_supervisor),
            max_score_updates_per_activity: Number(sla.max_score_updates_per_activity ?? companySla.configuration?.max_score_updates_per_activity ?? DEFAULT_SLA_CONFIGURATION.max_score_updates_per_activity)
        };

        return res.status(200).json({
            success: true,
            data: {
                location_id: location.id.toString(),
                location_name: location.name,
                company_id: location.company_id ? location.company_id.toString() : null,
                company_sla_enabled: Boolean(companySla.enabled),
                company_threshold: companySla.configuration?.threshold_score ?? 8,
                enabled: isEnabled,
                is_active: isEnabled,
                configuration,
                ...configuration,
                updated_at: sla.updated_at || null
            }
        });
    } catch (error) {
        console.error("Error in getWashroomSLAConfiguration:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

export const updateWashroomSLAConfiguration = async (req, res) => {
    try {
        const { location_id } = req.params;

        if (!req.user || Number(req.user.role_id) !== 1) {
            return res.status(403).json({
                success: false,
                message: "Forbidden: Only Super Admin can configure SLA settings"
            });
        }

        if (!location_id) {
            return res.status(400).json({ success: false, message: "location_id is required" });
        }

        const payload = req.body.configData || req.body.configuration || req.body;
        const {
            enabled,
            is_active,
            threshold_score,
            max_retry_attempts,
            notify_cleaner,
            notify_supervisor,
            max_score_updates_per_activity
        } = payload;

        const numericThreshold = threshold_score !== undefined ? Number(threshold_score) : undefined;
        if (numericThreshold !== undefined && (isNaN(numericThreshold) || numericThreshold < 0 || numericThreshold > 10)) {
            return res.status(400).json({
                success: false,
                message: "Threshold score must be a number between 0 and 10"
            });
        }

        const numericMaxRetry = max_retry_attempts !== undefined ? Number(max_retry_attempts) : undefined;
        if (numericMaxRetry !== undefined && (isNaN(numericMaxRetry) || numericMaxRetry < 0)) {
            return res.status(400).json({
                success: false,
                message: "Maximum Retry Attempts must be at least 0"
            });
        }

        const numericMaxUpdates = max_score_updates_per_activity !== undefined ? Number(max_score_updates_per_activity) : undefined;
        if (numericMaxUpdates !== undefined && (isNaN(numericMaxUpdates) || numericMaxUpdates < 1)) {
            return res.status(400).json({
                success: false,
                message: "Maximum Score Updates Per Activity must be at least 1"
            });
        }

        const existingLocation = await prisma.locations.findUnique({
            where: { id: BigInt(location_id) },
            select: { id: true, name: true, sla_config: true, company_id: true }
        });

        if (!existingLocation) {
            return res.status(404).json({ success: false, message: "Washroom location not found" });
        }

        // 🚨 MASTER SWITCH DEPENDENCY RULE:
        // Verify parent company SLA is enabled before allowing single washroom SLA to be set / enabled
        const companySla = existingLocation.company_id
            ? await getCompanySLAConfiguration(existingLocation.company_id)
            : { enabled: false };

        const targetEnabled = enabled !== undefined
            ? Boolean(enabled)
            : (is_active !== undefined ? Boolean(is_active) : false);

        if (!companySla || !companySla.enabled) {
            if (targetEnabled) {
                return res.status(400).json({
                    success: false,
                    message: "Cannot enable washroom SLA because company-level SLA is disabled. Please enable organizational SLA first."
                });
            }
        }

        const existingSla = (existingLocation.sla_config && typeof existingLocation.sla_config === "object")
            ? existingLocation.sla_config
            : {};

        const updatedSla = {
            enabled: targetEnabled,
            is_active: targetEnabled,
            threshold_score: numericThreshold !== undefined ? numericThreshold : (existingSla.threshold_score ?? DEFAULT_SLA_CONFIGURATION.threshold_score),
            max_retry_attempts: numericMaxRetry !== undefined ? numericMaxRetry : (existingSla.max_retry_attempts ?? DEFAULT_SLA_CONFIGURATION.max_retry_attempts),
            notify_cleaner: notify_cleaner !== undefined ? Boolean(notify_cleaner) : (existingSla.notify_cleaner ?? DEFAULT_SLA_CONFIGURATION.notify_cleaner),
            notify_supervisor: notify_supervisor !== undefined ? Boolean(notify_supervisor) : (existingSla.notify_supervisor ?? DEFAULT_SLA_CONFIGURATION.notify_supervisor),
            max_score_updates_per_activity: numericMaxUpdates !== undefined ? numericMaxUpdates : (existingSla.max_score_updates_per_activity ?? DEFAULT_SLA_CONFIGURATION.max_score_updates_per_activity),
            updated_at: new Date().toISOString(),
            updated_by: req.user.id ? req.user.id.toString() : "superadmin"
        };

        const updatedLocation = await prisma.locations.update({
            where: { id: BigInt(location_id) },
            data: {
                sla_config: updatedSla
            },
            select: {
                id: true,
                name: true,
                company_id: true,
                sla_config: true
            }
        });

        return res.status(200).json({
            success: true,
            message: "Washroom SLA configuration updated successfully",
            data: {
                location_id: updatedLocation.id.toString(),
                location_name: updatedLocation.name,
                company_id: updatedLocation.company_id ? updatedLocation.company_id.toString() : null,
                company_sla_enabled: Boolean(companySla?.enabled),
                enabled: updatedSla.enabled,
                is_active: updatedSla.is_active,
                configuration: {
                    threshold_score: updatedSla.threshold_score,
                    max_retry_attempts: updatedSla.max_retry_attempts,
                    notify_cleaner: updatedSla.notify_cleaner,
                    notify_supervisor: updatedSla.notify_supervisor,
                    max_score_updates_per_activity: updatedSla.max_score_updates_per_activity
                },
                ...updatedSla
            }
        });
    } catch (error) {
        console.error("Error in updateWashroomSLAConfiguration:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

