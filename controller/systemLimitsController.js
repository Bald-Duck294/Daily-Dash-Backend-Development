import { PrismaClient } from "@prisma/client";
import { serializeBigInt } from "../utils/serializer.js";
const prisma = new PrismaClient();

export const setLimit = async (req, res) => {
  try {
    const { company_id, limit_key, limit_value, is_enabled } = req.body;
    const updated_by = req.user.id; // From authMiddleware

    const limit = await prisma.system_limits.upsert({
      where: {
        company_id_limit_key: {
          company_id: company_id ? BigInt(company_id) : null,
          limit_key: limit_key,
        },
      },
      update: {
        limit_value: parseInt(limit_value),
        is_enabled: is_enabled !== undefined ? is_enabled : true,
        updated_by: BigInt(updated_by),
      },
      create: {
        company_id: company_id ? BigInt(company_id) : null,
        limit_key: limit_key,
        limit_value: parseInt(limit_value),
        current_value: 0, // Fresh limit start from 0 (Or write a logic to count current DB rows here)
        is_enabled: is_enabled !== undefined ? is_enabled : true,
        updated_by: BigInt(updated_by),
      },
    });

    res.status(200).json({ success: true, data: safeSerialize(limit) });
  } catch (error) {
    console.error("Error setting limit:", error);
    res.status(500).json({ success: false, error: "Failed to set limit" });
  }
};

// 2. View All Limits
export const getLimits = async (req, res) => {
  try {
    const { company_id } = req.query;

    const whereClause = {};
    if (company_id) {
      whereClause.company_id = BigInt(company_id);
    }

    const limits = await prisma.system_limits.findMany({
      where: whereClause,
      orderBy: { created_at: "desc" },
    });

    res.status(200).json({ success: true, data: safeSerialize(limits) });
  } catch (error) {
    console.error("Error fetching limits:", error);
    res.status(500).json({ success: false, error: "Failed to fetch limits" });
  }
};
