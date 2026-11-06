import prisma from "../config/prismaClient.mjs";
import clen_assign_router from "../routes/clen_assignRoutes.js";
import {
  parsePaginationParams,
  paginateWithPrisma,
} from "../utils/pagination.js";
import { serializeBigInt } from "../utils/serializer.js";

export const getAllCompanies = async (req, res) => {
  console.log("req")
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 6;
  const search = req.query.search || "";
  const sortField = req.query.sortField || "created_at";
  const sortOrder = req.query.sortOrder || "desc";

  // 2. Whitelist allowed sort fields
  const allowedSortFields = ["name", "contact_email", "status", "created_at"];
  const safeSortField = allowedSortFields.includes(sortField) ? sortField : "created_at";
  const safeSortOrder = sortOrder === "asc" ? "asc" : "desc";

  // 3. Calculate how many records to skip
  const skip = (page - 1) * limit;

  // 4. Build where clause for search
  const whereClause = {
    deleted_at: null,
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { contact_email: { contains: search, mode: 'insensitive' } },
      ]
    })
  };

  try {
    // 5. Fetch companies + count in parallel
    const [companies, totalCount] = await Promise.all([
      prisma.companies.findMany({
        where: whereClause,
        include: {
          _count: {
            select: {
              locations: { where: { deleted_at: null } },
            },
          },
        },
        skip: skip,
        take: limit,
        orderBy: { [safeSortField]: safeSortOrder },
      }),
      prisma.companies.count({ where: whereClause }),
    ]);

    // 6. Return data with totalCount
    res.status(200).json({
      data: serializeBigInt(companies),
      totalCount,
      pagination: {
        currentPage: page,
        pageSize: limit,
      },
    });

  } catch (error) {
    console.error("Error fetching companies:", error);
    res.status(500).json({ message: "Failed to fetch companies" });
  }
};


export const getCompaniesCount = async (req, res) => {
  const search = req.query.search || "";

  const whereClause = {
    deleted_at: null,
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { contact_email: { contains: search, mode: 'insensitive' } }
      ]
    })
  };

  try {
    const totalCount = await prisma.companies.count({
      where: whereClause,
    });

    res.status(200).json({ totalCount, success: true });
  } catch (error) {
    console.error("Error fetching count:", error);
    res.status(500).json({ message: "Failed to fetch count" });
  }
};

export const createCompany = async (req, res) => {
  try {
    const { name, description, contact_email, enable_stepper = true } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Company name is required" });
    }

    // If enable_stepper is false, mark is_onboarding_completed: true so stepper is skipped
    const isOnboardingCompleted = enable_stepper === false;

    const newCompany = await prisma.companies.create({
      data: {
        name,
        description,
        contact_email,
        is_onboarding_completed: isOnboardingCompleted,
      },
      include: {
        _count: {
          select: {
            locations: { where: { deleted_at: null } },
          },
        },
      },
    });

    res.status(201).json(serializeBigInt(newCompany));
  } catch (error) {
    console.error("Error creating company:", error);
    res.status(500).json({ message: "Failed to create company" });
  }
};

export const toggleCompanyStepper = async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = BigInt(id);

    const company = await prisma.companies.findUnique({
      where: { id: companyId },
      include: {
        _count: {
          select: {
            locations: { where: { deleted_at: null } },
          },
        },
      },
    });

    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }

    // Condition: when there is data in the company, the stepper toggle button will not take any effect
    if ((company._count?.locations ?? 0) > 0) {
      return res.status(400).json({
        message: "Cannot toggle stepper: Company already has locations/data deployed.",
      });
    }

    // If currently true (stepper skipped), new status is false (stepper enabled)
    // If currently false/null (stepper enabled), new status is true (stepper skipped)
    const newStatus = !Boolean(company.is_onboarding_completed);

    const updated = await prisma.companies.update({
      where: { id: companyId },
      data: {
        is_onboarding_completed: newStatus,
        updated_at: new Date(),
      },
      include: {
        _count: {
          select: {
            locations: { where: { deleted_at: null } },
          },
        },
      },
    });

    res.status(200).json({
      success: true,
      message: newStatus ? "Stepper disabled for this company" : "Stepper enabled for this company",
      data: serializeBigInt(updated),
    });
  } catch (error) {
    console.error("Error toggling company stepper:", error);
    res.status(500).json({ message: "Failed to toggle stepper status" });
  }
};

// @desc    Get a single company by ID
// @route   GET /api/companies/:id
// @access  Public
export const getCompanyById = async (req, res) => {
  try {
    const { id } = req.params;
    const company = await prisma.companies.findUnique({
      where: { id: parseInt(id) },
    });

    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }
    res.status(200).json(serializeBigInt(company));
  } catch (error) {
    console.error("Error fetching company:", error);
    res.status(500).json({ message: "Failed to fetch company" });
  }
};

// @desc    Update a company
// @route   POST /api/companies/:id
// @access  Public
export const updateCompany = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, contact_email } = req.body;

    console.log(req.body, "req body");

    if (!name) {
      return res.status(400).json({ message: "Company name is required" });
    }

    const updatedCompany = await prisma.companies.update({
      where: { id: parseInt(id) },
      data: {
        name,
        description,
        contact_email,
        updated_at: new Date(),
      },
    });

    res.status(200).json(serializeBigInt(updatedCompany));
  } catch (error) {
    console.error("Error updating company:", error);
    if (error.code === "P2025") {
      // Prisma code for record not found
      return res.status(404).json({ message: "Company not found" });
    }
    res.status(500).json({ message: "Failed to update company" });
  }
};

// @desc    Delete a company
// @route   DELETE /api/companies/:id
// @access  Public


export const deleteCompany = async (req, res) => {
  console.log('delete company endpoint hit');
  try {
    const { id } = req.params;
    const companyId = BigInt(id);
    const mode = (
      req.query.mode ||
      req.body?.mode ||
      (req.query.hard === "true" || req.query.type === "hard" ? "hard" : "soft")
    ).toLowerCase();

    console.log(`Deleting company ${companyId} with mode: ${mode}`);

    // Verify company exists
    const existingCompany = await prisma.companies.findUnique({
      where: { id: companyId },
    });

    if (!existingCompany) {
      return res.status(404).json({ message: "Company not found" });
    }

    // ==========================================
    // OPTION 1: SOFT DELETE (Archive & Deactivate)
    // ==========================================
    if (mode === "soft") {
      const now = new Date();

      // Soft delete the company record
      await prisma.companies.update({
        where: { id: companyId },
        data: {
          deleted_at: now,
          status: false,
        },
      });

      // Soft delete related entities where deleted_at column is supported
      await Promise.all([
        prisma.locations.updateMany({
          where: { company_id: companyId, deleted_at: null },
          data: { deleted_at: now },
        }),
        prisma.location_types.updateMany({
          where: { company_id: companyId, deleted_at: null },
          data: { deleted_at: now },
        }),
        prisma.users.updateMany({
          where: { company_id: companyId, deleted_at: null },
          data: { deleted_at: now, status: "inactive" },
        }),
        prisma.shifts.updateMany({
          where: { company_id: companyId, deleted_at: null },
          data: { deleted_at: now },
        }),
        prisma.cleaner_assignments.updateMany({
          where: { company_id: companyId, deleted_at: null },
          data: { deleted_at: now },
        }),
        prisma.facility_companies.updateMany({
          where: { company_id: companyId, deleted_at: null },
          data: { deleted_at: now, status: false },
        }),
        prisma.usage_category.updateMany({
          where: { company_id: companyId, deleted_at: null },
          data: { deleted_at: now },
        }),
      ]);

      return res.status(200).json({
        success: true,
        mode: "soft",
        message: "Company soft-deleted (archived) successfully.",
      });
    }

    // ==========================================
    // OPTION 2: HARD DELETE (Permanent Destruction)
    // ==========================================
    const targetIds = [companyId];

    // Step 1: Fetch ALL user IDs for this company
    const usersToDelete = await prisma.users.findMany({
      where: { company_id: { in: targetIds } },
      select: { id: true },
    });
    const userIds = usersToDelete.map((u) => u.id);

    // Step 2: Break self-referencing user foreign keys (created_by)
    if (userIds.length > 0) {
      await prisma.users.updateMany({
        where: { id: { in: userIds } },
        data: { created_by: null },
      });
    }

    // Step 3: Break circular FK between cleaner_review and sla_escalations
    await prisma.cleaner_review.updateMany({
      where: { company_id: { in: targetIds } },
      data: { escalation_id: null, parent_review_id: null },
    });

    // Step 4: Delete SLA logs & escalations
    await prisma.sla_escalation_logs.deleteMany({
      where: { escalation: { company_id: { in: targetIds } } },
    });
    await prisma.sla_escalations.deleteMany({
      where: { company_id: { in: targetIds } },
    });

    // Step 5: Delete all leaf-level dependent records in parallel
    await Promise.all([
      prisma.cleaner_review.deleteMany({ where: { company_id: { in: targetIds } } }),
      prisma.user_review.deleteMany({ where: { company_id: { in: targetIds } } }),
      prisma.user_review_qr.deleteMany({ where: { company_id: { in: targetIds } } }),
      prisma.hygiene_scores.deleteMany({ where: { company_id: { in: targetIds } } }),
      prisma.cleaner_assignments.deleteMany({ where: { company_id: { in: targetIds } } }),
      prisma.facility_companies.deleteMany({ where: { company_id: { in: targetIds } } }),
      prisma.usage_category.deleteMany({ where: { company_id: { in: targetIds } } }),
      prisma.configurations.deleteMany({ where: { company_id: { in: targetIds } } }),
      prisma.shifts.deleteMany({ where: { company_id: { in: targetIds } } }),
      prisma.registered_users.deleteMany({ where: { company_id: { in: targetIds } } }),
      ...(userIds.length > 0
        ? [
            prisma.activity_logs.deleteMany({ where: { user_id: { in: userIds } } }),
            prisma.shift_assignments.deleteMany({ where: { user_id: { in: userIds } } }),
            prisma.saved_locations.deleteMany({ where: { user_id: { in: userIds } } }),
            prisma.sessions.deleteMany({ where: { user_id: { in: userIds } } }),
            prisma.refresh_tokens.deleteMany({ where: { user_id: { in: userIds } } }),
            prisma.user_fcm_tokens.deleteMany({ where: { user_id: { in: userIds } } }),
          ]
        : []),
    ]);

    // Step 6: Delete ALL users
    if (userIds.length > 0) {
      await prisma.users.deleteMany({ where: { id: { in: userIds } } });
    }

    // Step 7: Nullify location FKs, then delete locations
    await prisma.locations.updateMany({
      where: { company_id: { in: targetIds } },
      data: { parent_id: null, type_id: null },
    });
    await prisma.locations.deleteMany({ where: { company_id: { in: targetIds } } });

    // Step 8: Nullify location_type parent FKs, then delete location types
    await prisma.location_types.updateMany({
      where: { company_id: { in: targetIds } },
      data: { parent_id: null },
    });
    await prisma.location_types.deleteMany({ where: { company_id: { in: targetIds } } });

    // Step 9: Delete System Limits
    await prisma.system_limits.deleteMany({ where: { company_id: { in: targetIds } } });

    // Step 10: Finally Delete Company
    await prisma.companies.delete({ where: { id: companyId } });

    return res.status(200).json({
      success: true,
      mode: "hard",
      message: "Company and all associated data permanently deleted.",
    });
  } catch (error) {
    console.error("Error deleting company:", error);
    if (error.code === "P2025") {
      return res.status(404).json({ message: "Company not found" });
    }
    res.status(500).json({ message: "Failed to delete company", error: error.message });
  }
};

// controllers/companyController.js

export const setupCompany = async (req, res) => {
  try {
    // 1. SAFELY HANDLE VERCEL'S STRINGIFIED BODY BEHAVIOR
    let payload = req.body;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch (e) {
        console.error("Failed to parse stringified body on Vercel:", e);
      }
    }

    // 2. DESTRUCTURE FROM THE SAFELY PARSED PAYLOAD
    const { organization_name, organization_type, operation_structure } =
      payload || {};
    const companyId = req.user?.company_id;

    console.log("Vercel Debug - Extracted Data:", {
      organization_name,
      organization_type,
      operation_structure,
      companyId,
    });

    if (!companyId) return res.status(401).json({ error: "Unauthorized" });

    // 3. CHECK FOR MISSING FIELDS
    if (!organization_name || !organization_type || !operation_structure) {
      // 🚨 FIX: Removed 'console.log(error)' which causes a ReferenceError
      return res.status(400).json({
        error: "All fields are required.",
        // Send back the payload Vercel received so you can see it in your Frontend Network tab!
        debug_vercel_payload: payload,
      });
    }

    // 4. UPDATE DATABASE
    const updatedCompany = await prisma.companies.update({
      where: { id: BigInt(companyId) },
      data: {
        name: organization_name,
        onboarding_metadata: {
          organization_type,
          operation_structure,
        },
      },
    });

    res.status(200).json({
      success: true,
      message: "Company profile updated successfully",
      data: serializeBigInt(updatedCompany),
    });
  } catch (error) {
    console.error("Company Setup Error:", error);
    res.status(500).json({ error: "Failed to save company profile" });
  }
};

// controllers/companyController.js

export const companyReset = async (req, res) => {
  console.log("Company Reset Started");
  try {
    const { companyId, companyIds } = req.body;

    let targetIds = [];
    if (companyIds && Array.isArray(companyIds)) {
      targetIds = companyIds.map((id) => BigInt(id));
    } else if (companyId) {
      targetIds = [BigInt(companyId)];
    }

    if (targetIds.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "Please provide companyId or companyIds in the request body." });
    }

    // Step 1: Fetch non-admin user IDs (outside transaction for speed)
    const usersToDelete = await prisma.users.findMany({
      where: { company_id: { in: targetIds }, role_id: { not: 2 } },
      select: { id: true },
    });
    const userIds = usersToDelete.map((u) => u.id);

    // Step 2: Delete all leaf-level dependent records in parallel (no FK conflicts between these)
    await Promise.all([
      prisma.cleaner_review.deleteMany({ where: { company_id: { in: targetIds } } }),
      prisma.user_review.deleteMany({ where: { company_id: { in: targetIds } } }),
      prisma.hygiene_scores.deleteMany({ where: { company_id: { in: targetIds } } }),
      prisma.cleaner_assignments.deleteMany({ where: { company_id: { in: targetIds } } }),
      ...(userIds.length > 0
        ? [
          prisma.activity_logs.deleteMany({ where: { user_id: { in: userIds } } }),
          prisma.shift_assignments.deleteMany({ where: { user_id: { in: userIds } } }),
          prisma.saved_locations.deleteMany({ where: { user_id: { in: userIds } } }),
          prisma.sessions.deleteMany({ where: { user_id: { in: userIds } } }),
          prisma.refresh_tokens.deleteMany({ where: { user_id: { in: userIds } } }),
        ]
        : []),
    ]);

    // Step 3: Delete non-admin users (now safe — all dependents are gone)
    if (userIds.length > 0) {
      await prisma.users.deleteMany({ where: { id: { in: userIds } } });
    }

    // Step 4: Nullify location FKs, then delete locations
    await prisma.locations.updateMany({
      where: { company_id: { in: targetIds } },
      data: { parent_id: null, type_id: null },
    });
    await prisma.locations.deleteMany({ where: { company_id: { in: targetIds } } });

    // Step 5: Nullify location_type parent FKs, then delete location types
    await prisma.location_types.updateMany({
      where: { company_id: { in: targetIds } },
      data: { parent_id: null },
    });
    await prisma.location_types.deleteMany({ where: { company_id: { in: targetIds } } });

    // Step 6: Reset system limits and company status in parallel
    await Promise.all([
      prisma.system_limits.updateMany({
        where: { company_id: { in: targetIds } },
        data: { current_value: 0 },
      }),
      prisma.companies.updateMany({
        where: { id: { in: targetIds } },
        data: { is_onboarding_completed: false },
      }),
    ]);

    console.log("Company Reset Completed Successfully");
    res
      .status(200)
      .json({ success: true, message: "Companies reset successfully." });
  } catch (error) {
    console.error("Company Reset Error:", error);
    res.status(500).json({
      success: false,
      error: "Reset failed.",
      details: error.message,
    });
  }
};
