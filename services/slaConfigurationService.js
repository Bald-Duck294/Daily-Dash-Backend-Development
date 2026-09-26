import prisma from "../config/prismaClient.mjs";
import { DEFAULT_SLA_CONFIGURATION } from "../constant/slaDefaults.js";

export const getCompanySLAConfiguration = async (company_id) => {
    try {
        const config = await prisma.configurations.findFirst({
            where: {
                name: "SLA_CONFIGURATION",
                company_id: BigInt(company_id)
            }
        });

        if (!config) {
            return {
                enabled: false,
                configuration: DEFAULT_SLA_CONFIGURATION
            };
        }

        const rawDesc = (config.description && typeof config.description === 'object') ? config.description : {};
        const mergedConfiguration = {
            ...DEFAULT_SLA_CONFIGURATION,
            ...rawDesc,
            escalation: rawDesc.escalation || DEFAULT_SLA_CONFIGURATION.escalation
        };

        return {
            enabled: Boolean(config.is_active),
            configuration: mergedConfiguration
        };
    } catch (error) {
        console.error("Error fetching SLA Configuration for company:", error);
        throw error;
    }
};

/**
 * Resolves effective SLA for a washroom location, strictly enforcing the Master Switch:
 * 1. Checks Parent Company SLA. If inactive or missing -> SLA is completely DISABLED.
 * 2. If Parent Company SLA is active:
 *    - Checks location.sla_config.
 *    - If washroom SLA is active -> uses Washroom SLA override.
 *    - If washroom SLA is not active or null -> FALLS BACK to Parent Company SLA baseline.
 */
export const resolveEffectiveWashroomSLA = async (locationId, companyId = null) => {
    try {
        const location = await prisma.locations.findUnique({
            where: { id: BigInt(locationId) },
            select: {
                id: true,
                name: true,
                company_id: true,
                sla_config: true
            }
        });

        if (!location) {
            return { enabled: false, reason: "LOCATION_NOT_FOUND", configuration: null };
        }

        const finalCompanyId = companyId || location.company_id;
        if (!finalCompanyId) {
            return { enabled: false, reason: "NO_COMPANY_ID", configuration: null };
        }

        // 1. Verify Parent Company Master SLA
        const companySLA = await getCompanySLAConfiguration(finalCompanyId);
        if (!companySLA || !companySLA.enabled) {
            return {
                enabled: false,
                isCompanyDisabled: true,
                reason: "COMPANY_SLA_DISABLED",
                location_name: location.name,
                configuration: null
            };
        }

        // 2. Check Washroom SLA override in location.sla_config
        const washroomSla = (location.sla_config && typeof location.sla_config === "object")
            ? location.sla_config
            : null;

        const isWashroomActive = washroomSla && (washroomSla.enabled === true || washroomSla.is_active === true);

        if (isWashroomActive) {
            const threshold = Number(washroomSla.threshold_score ?? companySLA.configuration?.threshold_score ?? 7.0);
            return {
                enabled: true,
                source: "WASHROOM_OVERRIDE",
                location_id: location.id.toString(),
                location_name: location.name,
                company_id: finalCompanyId.toString(),
                threshold,
                configuration: {
                    ...companySLA.configuration,
                    ...washroomSla,
                    threshold_score: threshold
                }
            };
        }

        // 3. Fallback to Company SLA Baseline
        const fallbackThreshold = Number(companySLA.configuration?.threshold_score ?? 8.0);
        return {
            enabled: true,
            source: "COMPANY_FALLBACK",
            location_id: location.id.toString(),
            location_name: location.name,
            company_id: finalCompanyId.toString(),
            threshold: fallbackThreshold,
            configuration: companySLA.configuration
        };
    } catch (error) {
        console.error("Error resolving effective washroom SLA:", error);
        throw error;
    }
};
