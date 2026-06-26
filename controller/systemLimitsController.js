import { PrismaClient } from "@prisma/client";
import { serializeBigInt } from "../utils/serializer.js";
const prisma = new PrismaClient();

// 1. Set or Update a Limit (SuperAdmin Only)
export const setLimit = async (req, res) => {
  try {
    const { company_id, limit_key, limit_value, is_enabled } = req.body;
    const updated_by = req.user.id; // From authMiddleware

    const parsedCompanyId = company_id ? BigInt(company_id) : null;
    const parsedLimitValue = parseInt(limit_value);
    const parsedIsEnabled = is_enabled !== undefined ? is_enabled : true;

    // 🔥 FIX: Check if it exists manually (Bypasses Prisma's Upsert Bug with Nulls)
    const existingLimit = await prisma.system_limits.findFirst({
      where: {
        company_id: parsedCompanyId,
        limit_key: limit_key,
      },
    });

    let limit;

    if (existingLimit) {
      // ✅ UPDATE if already exists
      limit = await prisma.system_limits.update({
        where: { id: existingLimit.id },
        data: {
          limit_value: parsedLimitValue,
          is_enabled: parsedIsEnabled,
          updated_by: BigInt(updated_by),
        },
      });
    } else {
      // ✅ CREATE if it's a new limit
      limit = await prisma.system_limits.create({
        data: {
          company_id: parsedCompanyId,
          limit_key: limit_key,
          limit_value: parsedLimitValue,
          current_value: 0, // Fresh limit start from 0
          is_enabled: parsedIsEnabled,
          updated_by: BigInt(updated_by),
        },
      });
    }

    res.status(200).json({ success: true, data: serializeBigInt(limit) });
  } catch (error) {
    console.error("Error setting limit:", error);
    res.status(500).json({
      success: false,
      error: "Failed to set limit",
      details: error.message,
    });
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

    res.status(200).json({ success: true, data: serializeBigInt(limits) });
  } catch (error) {
    console.error("Error fetching limits:", error);
    res.status(500).json({ success: false, error: "Failed to fetch limits" });
  }
};
