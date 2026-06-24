import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export const checkLimit = (limitKey) => {
  return async (req, res, next) => {
    try {
      // 🔥 FIX: Extract companyId from req.query as well!
      const company_id =
        req.query?.companyId || req.body?.company_id || req.user?.company_id;
      let limitRecord = null;

      if (company_id) {
        // Ensure this matches your Prisma schema (system_limits)
        limitRecord = await prisma.system_limits.findFirst({
          where: {
            company_id: BigInt(company_id),
            limit_key: limitKey,
            is_enabled: true,
          },
        });
      }

      // Fallback for global limits
      if (!limitRecord) {
        limitRecord = await prisma.system_limits.findFirst({
          where: {
            company_id: null,
            limit_key: limitKey,
            is_enabled: true,
          },
        });
      }

      // If no limit set for this key, let it pass
      if (!limitRecord) {
        return next();
      }

      // Check if current value exceeds limit
      if (limitRecord.current_value >= limitRecord.limit_value) {
        return res.status(403).json({
          success: false,
          error: "LIMIT_REACHED",
          message: `You have reached the maximum limit of ${limitRecord.limit_value} for ${limitKey}. Contact Super Admin.`,
        });
      }

      // Pass the ID to controller so it can increment the count
      req.systemLimitId = limitRecord.id;
      next();
    } catch (error) {
      console.error(`Limit Middleware Error [${limitKey}]:`, error);
      return res
        .status(500)
        .json({ success: false, error: "Error validating system limits." });
    }
  };
};
