import prisma from "../config/prismaClient.mjs";
import { serializeBigInt } from "../utils/serializer.js";

/**
 * Ensures caller is superadmin (role_id === 1)
 */
const ensureSuperAdmin = (req, res) => {
  const roleId = Number(req.user?.role_id);
  if (roleId !== 1) {
    res.status(403).json({
      success: false,
      message: "Forbidden: Superadmin access required for Review Management.",
    });
    return false;
  }
  return true;
};

// ==========================================
// 1. CLEANER REVIEWS MANAGEMENT
// ==========================================

/**
 * Fetch cleaner reviews with pagination and filters (company, cleaner, date range, search)
 */
export const getCleanerReviewsForManagement = async (req, res) => {
  try {
    if (!ensureSuperAdmin(req, res)) return;

    const {
      company_id,
      cleaner_id,
      start_date,
      end_date,
      search,
      page = 1,
      limit = 20,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.max(1, parseInt(limit, 10) || 20);
    const skip = (pageNum - 1) * pageSize;

    const where = {};

    if (company_id && company_id !== "all") {
      where.company_id = BigInt(company_id);
    }

    if (cleaner_id && cleaner_id !== "all") {
      where.cleaner_user_id = BigInt(cleaner_id);
    }

    if (start_date || end_date) {
      where.created_at = {};
      if (start_date) {
        const start = new Date(start_date);
        start.setUTCHours(0, 0, 0, 0);
        where.created_at.gte = start;
      }
      if (end_date) {
        const end = new Date(end_date);
        end.setUTCHours(23, 59, 59, 999);
        where.created_at.lte = end;
      }
    }

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { initial_comment: { contains: q, mode: "insensitive" } },
        { final_comment: { contains: q, mode: "insensitive" } },
        {
          cleaner_user: {
            name: { contains: q, mode: "insensitive" },
          },
        },
        {
          location: {
            name: { contains: q, mode: "insensitive" },
          },
        },
      ];
    }

    const [total, reviews] = await Promise.all([
      prisma.cleaner_review.count({ where }),
      prisma.cleaner_review.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { created_at: "desc" },
        include: {
          cleaner_user: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              avatar_url: true,
            },
          },
          location: {
            select: {
              id: true,
              name: true,
              name: true,
              address: true,
              city: true,
            },
          },
          company: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: serializeBigInt(reviews),
      pagination: {
        page: pageNum,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error("Error in getCleanerReviewsForManagement:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch cleaner reviews",
      error: error.message,
    });
  }
};

/**
 * Permanently delete single or multiple cleaner reviews
 */
export const deleteCleanerReviews = async (req, res) => {
  try {
    if (!ensureSuperAdmin(req, res)) return;

    const { review_ids } = req.body;

    if (!review_ids || !Array.isArray(review_ids) || review_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: "review_ids array is required for deletion.",
      });
    }

    const ids = review_ids.map((id) => BigInt(id));

    await prisma.$transaction(async (tx) => {
      // 1. Break self-referential retry links
      await tx.cleaner_review.updateMany({
        where: { parent_review_id: { in: ids } },
        data: { parent_review_id: null },
      });

      // 2. Unlink escalation on the reviews to be deleted
      await tx.cleaner_review.updateMany({
        where: { id: { in: ids } },
        data: { escalation_id: null },
      });

      // 3. Handle escalations triggered by these reviews (triggered_by_review_id is required/non-nullable)
      const triggeredEscalations = await tx.sla_escalations.findMany({
        where: { triggered_by_review_id: { in: ids } },
        select: { id: true },
      });
      const escIds = triggeredEscalations.map((e) => e.id);

      if (escIds.length > 0) {
        // Unlink corrective reviews pointing to these escalations
        await tx.cleaner_review.updateMany({
          where: { escalation_id: { in: escIds } },
          data: { escalation_id: null },
        });
        // Delete logs for these escalations
        await tx.sla_escalation_logs.deleteMany({
          where: { escalation_id: { in: escIds } },
        });
        // Delete the escalations that were triggered by these reviews
        await tx.sla_escalations.deleteMany({
          where: { id: { in: escIds } },
        });
      }

      // 4. Unlink resolved_by_review_id (nullable)
      await tx.sla_escalations.updateMany({
        where: { resolved_by_review_id: { in: ids } },
        data: { resolved_by_review_id: null },
      });

      // 5. Delete logs associated directly with these reviews
      await tx.sla_escalation_logs.deleteMany({
        where: { review_id: { in: ids } },
      });

      // 6. Unlink penalties and violations
      await tx.cleaner_penalties.updateMany({
        where: { review_id: { in: ids } },
        data: { review_id: null },
      });

      await tx.sla_violations.updateMany({
        where: { review_id: { in: ids } },
        data: { review_id: null },
      });

      // 7. Permanently hard delete cleaner_review records
      await tx.cleaner_review.deleteMany({
        where: { id: { in: ids } },
      });
    });

    return res.status(200).json({
      success: true,
      message: `Successfully deleted ${ids.length} cleaner review(s) permanently.`,
      deleted_count: ids.length,
    });
  } catch (error) {
    console.error("Error in deleteCleanerReviews:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to permanently delete cleaner review(s)",
      error: error.message,
    });
  }
};

// ==========================================
// 2. USER REVIEWS MANAGEMENT
// ==========================================

// ==========================================
// 2. USER REVIEWS MANAGEMENT (user_review_qr)
// ==========================================

/**
 * Fetch user reviews with pagination and filters (company, date range, search)
 * Uses active user_review_qr table
 */
export const getUserReviewsForManagement = async (req, res) => {
  try {
    if (!ensureSuperAdmin(req, res)) return;

    const {
      company_id,
      start_date,
      end_date,
      search,
      page = 1,
      limit = 20,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.max(1, parseInt(limit, 10) || 20);
    const skip = (pageNum - 1) * pageSize;

    const where = {};

    if (company_id && company_id !== "all") {
      where.company_id = BigInt(company_id);
    }

    if (start_date || end_date) {
      where.created_at = {};
      if (start_date) {
        const start = new Date(start_date);
        start.setUTCHours(0, 0, 0, 0);
        where.created_at.gte = start;
      }
      if (end_date) {
        const end = new Date(end_date);
        end.setUTCHours(23, 59, 59, 999);
        where.created_at.lte = end;
      }
    }

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { description: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { token_number: { contains: q, mode: "insensitive" } },
        {
          locations: {
            name: { contains: q, mode: "insensitive" },
          },
        },
      ];
    }

    const [total, reviews] = await Promise.all([
      prisma.user_review_qr.count({ where }),
      prisma.user_review_qr.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { created_at: "desc" },
        include: {
          locations: {
            select: {
              id: true,
              name: true,
              address: true,
              city: true,
            },
          },
          companies: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: serializeBigInt(reviews),
      pagination: {
        page: pageNum,
        limit: pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error("Error in getUserReviewsForManagement:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch user reviews",
      error: error.message,
    });
  }
};

/**
 * Permanently delete single or multiple user reviews from user_review_qr
 */
export const deleteUserReviews = async (req, res) => {
  try {
    if (!ensureSuperAdmin(req, res)) return;

    const { review_ids } = req.body;

    if (!review_ids || !Array.isArray(review_ids) || review_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: "review_ids array is required for deletion.",
      });
    }

    const ids = review_ids.map((id) => BigInt(id));

    await prisma.user_review_qr.deleteMany({
      where: { id: { in: ids } },
    });

    return res.status(200).json({
      success: true,
      message: `Successfully deleted ${ids.length} user review(s) permanently.`,
      deleted_count: ids.length,
    });
  } catch (error) {
    console.error("Error in deleteUserReviews:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to permanently delete user review(s)",
      error: error.message,
    });
  }
};
