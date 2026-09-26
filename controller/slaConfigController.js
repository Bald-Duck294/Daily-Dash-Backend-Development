import prisma from "../config/prismaClient.mjs";
import { DEFAULT_SLA_CONFIGURATION } from "../constant/slaDefaults.js";
import { getCompanySLAConfiguration } from "../services/slaConfigurationService.js";
import { validateSlaConfiguration } from "../validators/slaHierarchyValidator.js";

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

export const enableSLA = async (req, res) => {
    try {
        const { company_id } = req.body;

        if (!company_id) {
            return res.status(400).json({ success: false, message: "company_id is required" });
        }

        const companyIdBigInt = BigInt(company_id);

        const config = await prisma.configurations.upsert({
            where: {
                name_company_id: {
                    name: "SLA_CONFIGURATION",
                    company_id: companyIdBigInt
                }
            },
            update: {
                is_active: true
            },
            create: {
                name: "SLA_CONFIGURATION",
                company_id: companyIdBigInt,
                is_active: true,
                description: DEFAULT_SLA_CONFIGURATION
            }
        });

        return res.status(200).json({
            success: true,
            message: "SLA Configuration enabled successfully",
            data: serializeBigInt(config)
        });
    } catch (error) {
        console.error("Error in enableSLA:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

export const disableSLA = async (req, res) => {
    try {
        const { company_id } = req.body;

        if (!company_id) {
            return res.status(400).json({ success: false, message: "company_id is required" });
        }

        const companyIdBigInt = BigInt(company_id);

        const config = await prisma.configurations.updateMany({
            where: {
                name: "SLA_CONFIGURATION",
                company_id: companyIdBigInt
            },
            data: {
                is_active: false
            }
        });

        if (config.count === 0) {
            return res.status(404).json({ success: false, message: "SLA Configuration not found for this company" });
        }

        return res.status(200).json({
            success: true,
            message: "SLA Configuration disabled successfully"
        });
    } catch (error) {
        console.error("Error in disableSLA:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

export const getSLAConfiguration = async (req, res) => {
    try {
        const { company_id } = req.params;

        if (!company_id) {
            return res.status(400).json({ success: false, message: "company_id is required" });
        }

        const result = await getCompanySLAConfiguration(company_id);

        return res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error("Error in getSLAConfiguration:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

export const updateSLAConfiguration = async (req, res) => {
    try {
        const { company_id } = req.params;
        const updates = req.body;

        if (!company_id) {
            return res.status(400).json({ success: false, message: "company_id is required" });
        }

        const companyIdBigInt = BigInt(company_id);

        // Validate allowed properties
        const allowedProperties = [
            'version',
            'threshold_score',
            'max_retry_attempts',
            'notify_cleaner',
            'notify_supervisor',
            'max_score_updates_per_activity',
            'escalation'
        ];

        for (const key of Object.keys(updates)) {
            if (!allowedProperties.includes(key)) {
                return res.status(400).json({
                    success: false,
                    message: `Property '${key}' is not allowed to be updated.`
                });
            }
        }

        // Validate hierarchy, ranges, and types
        const validation = validateSlaConfiguration(updates);
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: validation.error
            });
        }

        const sanitizedUpdates = validation.sanitizedUpdates;
        if (Object.keys(sanitizedUpdates).length === 0) {
            return res.status(400).json({ success: false, message: "No valid properties to update." });
        }

        // Fetch existing config (if any)
        const existingConfig = await prisma.configurations.findFirst({
            where: {
                name: "SLA_CONFIGURATION",
                company_id: companyIdBigInt
            }
        });

        const baseDescription = existingConfig?.description && typeof existingConfig.description === 'object'
            ? existingConfig.description
            : DEFAULT_SLA_CONFIGURATION;

        const newDescription = {
            ...DEFAULT_SLA_CONFIGURATION,
            ...baseDescription,
            ...sanitizedUpdates
        };

        const updatedConfig = await prisma.configurations.upsert({
            where: {
                name_company_id: {
                    name: "SLA_CONFIGURATION",
                    company_id: companyIdBigInt
                }
            },
            update: {
                description: newDescription
            },
            create: {
                name: "SLA_CONFIGURATION",
                company_id: companyIdBigInt,
                is_active: true,
                description: newDescription
            }
        });

        return res.status(200).json({
            success: true,
            message: "SLA Configuration updated successfully",
            data: serializeBigInt(updatedConfig)
        });
    } catch (error) {
        console.error("Error in updateSLAConfiguration:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

export const getCompanySLAList = async (req, res) => {
    try {
        const configs = await prisma.configurations.findMany({
            where: {
                name: "SLA_CONFIGURATION"
            },
            select: {
                company_id: true,
                is_active: true
            }
        });

        const list = configs.map(c => ({
            company_id: c.company_id ? c.company_id.toString() : null,
            enabled: c.is_active
        }));

        return res.status(200).json({
            success: true,
            data: list
        });
    } catch (error) {
        console.error("Error in getCompanySLAList:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};
