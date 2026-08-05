import RBACFilterService from "../utils/rbacFilterService.js";
import prisma from "../config/prismaClient.mjs";

export const requireLocationAccess = async (req, res, next) => {
  try {
    // 1. SUPER ADMIN BYPASS: Let them through immediately if role ID is 1
    if (req.user.role_id === 1) {
      return next();
    }

    // 1.5 ADMIN BYPASS: Allow but restrict to their own company's locations
    if (req.user.role_id === 2) {
      if (req.params.location_id) {
        const location = await prisma.locations.findUnique({
          where: { id: BigInt(req.params.location_id) },
          select: { company_id: true },
        });

        if (!location || location.company_id !== BigInt(req.user.company_id)) {
          return res.status(403).json({
            error:
              "Forbidden: You do not have access to this location as it belongs to another company.",
          });
        }
      }
      return next();
    }

    const userId = req.user.id;
    const companyId = req.user.company_id;

    // 2. Fetch authorized locations for regular users
    const authorizedBigInts = await RBACFilterService.getAuthorizedLocationIds(
      userId,
      companyId,
    );

    // 3. Convert to strings so JavaScript arrays can easily use .includes()
    const authorizedIds = authorizedBigInts.map((id) => id.toString());

    // 4. Attach to the request so your controllers can use it
    req.authorizedLocationIds = authorizedIds;

    // 5. Block direct access if they request a specific location they don't own
    if (
      req.params.location_id &&
      !authorizedIds.includes(req.params.location_id)
    ) {
      return res
        .status(403)
        .json({ error: "Forbidden: You do not have access to this location." });
    }

    next();
  } catch (error) {
    console.error("RBAC Error:", error);
    res
      .status(500)
      .json({ error: "Internal Server Error during authorization." });
  }
};
