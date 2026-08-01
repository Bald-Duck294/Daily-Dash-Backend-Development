import prisma from "../config/prismaClient.mjs";

export const getCompanySLAConfiguration = async (company_id) => {
    try {
        const config = await prisma.configurations.findFirst({
            where: {
                name: "SLA_CONFIGURATION",
                company_id: BigInt(company_id),
                is_active: true
            }
        });

        if (!config) {
            return {
                enabled: false,
                configuration: null
            };
        }

        return {
            enabled: true,
            configuration: config.description
        };
    } catch (error) {
        console.error("Error fetching SLA Configuration for company:", error);
        throw error;
    }
};
