import prisma from "../config/prismaClient.mjs";
import db from "../db.js";
// import RBACFilterService from "../services/rbacFilterService.js";
import RBACFilterService from "../utils/rbacFilterService.js";

export const getLocationsForDropdown = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { company_id, type_id, facility_company_id } = req.query;
    const whereClause = {};

    // 1. Apply Role-Based Access Control
    const roleFilter = await RBACFilterService.getLocationFilter(user);
    Object.assign(whereClause, roleFilter);

    // 2. Superadmin/Admin Company Overrides
    // ✅ FIX: Explicitly check that company_id is NOT the string "all" before using BigInt()
    const isValidCompanyId =
      company_id && company_id !== "all" && company_id !== "null";

    if ((user.role_id === 1 || user.role_id === 2) && isValidCompanyId) {
      whereClause.company_id = BigInt(company_id);
    } else if (isValidCompanyId) {
      whereClause.company_id = BigInt(company_id);
    }

    // 3. Optional Filters (Type and Facility)
    // Also added safety checks here just in case "all" gets passed to these in the future
    if (type_id && type_id !== "all") {
      whereClause.type_id = BigInt(type_id);
    }
    if (facility_company_id && facility_company_id !== "all") {
      whereClause.facility_company_id = BigInt(facility_company_id);
    }

    // 4. Exclude soft-deleted records
    whereClause.deleted_at = null;

    // 5. Force Active Only
    whereClause.OR = [{ status: true }, { status: null }];

    // 6. Highly Optimized Prisma Query
    const locations = await prisma.locations.findMany({
      where: Object.keys(whereClause).length ? whereClause : undefined,
      select: {
        id: true,
        name: true,
        type_id: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    // 7. Format BigInt to String
    const formattedLocations = locations.map((loc) => ({
      id: loc.id.toString(),
      name: loc.name,
      type_id:loc.type_id.toString()
    }));

    return res.status(200).json({
      success: true,
      data: formattedLocations,
    });
  } catch (error) {
    console.error("Error fetching locations for dropdown:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch locations for dropdown",
    });
  }
};

export async function getUsersForDropdown(req, res) {
  try {
    // No page/limit params needed
    const { companyId, roleId, search } = req.query;

    const loggedInUserId = req.user ? BigInt(req.user.id) : null;
    const loggedInUserRole = req.user ? Number(req.user.role_id) : null;

    // 1. Get Base RBAC Filter (Assignment Logic)
    const userFilter = await RBACFilterService.getUserFilter(
      req.user,
      "getUser"
    );

    // 2. Build Base Where Clause
    const whereClause = {
      deleted_at: null, // Ensures soft-deleted users are excluded
      AND: [] // Use an AND array to stack rules safely
    };

    // Exclude the logged-in user from the dropdown so they don't assign themselves
    if (loggedInUserId) {
      whereClause.AND.push({ id: { not: loggedInUserId } });
    }

    if (companyId) {
      whereClause.company_id = BigInt(companyId);
    }

    // ✅ NEW: Merge Assignment logic with "Created By" logic for Supervisors
    // Role 3 = Supervisor, Role 8 = Facility Admin
    if (loggedInUserRole === 3 || loggedInUserRole === 8) {
      whereClause.AND.push({
        OR: [
          userFilter, // Users assigned to them
          { created_by: loggedInUserId } // Users created by them
        ]
      });
    } else {
      // For Admins/Superadmins, just apply standard filter if it's not empty
      if (Object.keys(userFilter).length > 0) {
        whereClause.AND.push(userFilter);
      }
    }

    // Apply specific Role ID filter if selected
    if (roleId && roleId !== "all") {
      whereClause.AND.push({ role_id: Number(roleId) });
    }

    // Apply Search filter
    if (search) {
      whereClause.AND.push({
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
        ]
      });
    }

    // Clean up empty AND array to prevent Prisma errors
    if (whereClause.AND.length === 0) {
      delete whereClause.AND;
    }

    // 3. Highly Optimized Query
    const users = await prisma.users.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        email: true, // Useful to differentiate users with the same name
        role_id: true,
        role: {
          select: {
            name: true, // Useful for showing "John Doe (Admin)" in the UI
          },
        },
      },
      orderBy: {
        name: "asc", // Alphabetical sorting is best for dropdowns
      },
    });

    // 4. Format BigInt IDs to strings
    const formattedUsers = users.map((user) => ({
      id: user.id.toString(),
      name: user.name,
      email: user.email,
      role_id: user.role_id,
      role_name: user.role?.name || "No Role",
    }));

    // Return simple array format
    res.status(200).json({
      success: true,
      data: formattedUsers,
    });
  } catch (error) {
    console.error("Error fetching users for dropdown:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error fetching dropdown users.",
    });
  }
}

export const getCompaniesForDropdown = async (req, res) => {
  try {
    // CHANGE THIS LINE to match your exact Prisma model name
    const companies = await prisma.companies.findMany({
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    const formattedCompanies = companies.map((company) => ({
      id: company.id.toString(),
      name: company.name,
    }));

    return res.status(200).json({
      success: true,
      data: formattedCompanies,
    });
  } catch (error) {
    console.error("Error fetching companies for dropdown:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error fetching dropdown companies.",
    });
  }
};

export async function getCleanersForDropdown(req, res) {
  try {
    const { companyId, search } = req.query;

    // 1. Get Base RBAC Filter
    const userFilter = await RBACFilterService.getUserFilter(
      req.user,
      "getUser",
    );

    // 2. Build standard Where Clause strictly for Cleaners
    const whereClause = {
      ...userFilter,
      deleted_at: null, // <-- Explicitly excludes soft-deleted users
      role: {
        name: {
          equals: "cleaner",
          mode: "insensitive",
        },
      },
    };

    if (companyId) {
      whereClause.company_id = BigInt(companyId);
    }

    if (search) {
      whereClause.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }

    // 3. Highly Optimized Query
    const cleaners = await prisma.users.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        email: true,
        role_id: true,
        role: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        name: "asc", // Alphabetical sorting
      },
    });

    // 4. Format BigInt IDs to strings
    const formattedCleaners = cleaners.map((cleaner) => ({
      id: cleaner.id.toString(),
      name: cleaner.name,
      email: cleaner.email,
      role_id: cleaner.role_id,
      role_name: cleaner.role?.name || "Cleaner",
    }));

    // Return simple array format
    res.status(200).json({
      success: true,
      data: formattedCleaners,
    });
  } catch (error) {
    console.error("Error fetching cleaners for dropdown:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error fetching cleaner dropdown.",
    });
  }
}

export const getZonesForDropdown = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { company_id } = req.query;
    const whereClause = {};

    // 1. Role-Based Access Control
    // Note: Ensure RBACFilterService.getZoneFilter(user) is defined,
    // or comment this out if it is still throwing the TypeError
    try {
      if (
        typeof RBACFilterService !== "undefined" &&
        RBACFilterService.getZoneFilter
      ) {
        const roleFilter = await RBACFilterService.getZoneFilter(user);
        if (roleFilter) {
          Object.assign(whereClause, roleFilter);
        }
      }
    } catch (e) {
      console.warn("RBAC Filter skipped or failed:", e.message);
    }

    // 2. Company Override Logic
    const isValidCompanyId =
      company_id && company_id !== "all" && company_id !== "null";
    if ((user.role_id === 1 || user.role_id === 2) && isValidCompanyId) {
      whereClause.company_id = BigInt(company_id);
    } else if (isValidCompanyId) {
      whereClause.company_id = BigInt(company_id);
    }

    // 3. Exclude soft-deleted records
    whereClause.deleted_at = null;

    // ==========================================
    // 4. THE TWO-LEVEL HIERARCHY FETCH
    // ==========================================

    // STEP A: Get all Top-Level Zones (parent_id is null)
    const topLevelZones = await prisma.location_types.findMany({
      where: {
        ...whereClause,
        parent_id: null,
      },
      select: { id: true },
    });

    // Extract just the IDs into an array
    const topLevelIds = topLevelZones.map((zone) => zone.id);

    // STEP B: Fetch Level 1 (Top) AND Level 2 (Sub-Zones)
    const zones = await prisma.location_types.findMany({
      where: {
        ...whereClause,
        OR: [
          { parent_id: null }, // Keep Top-Level (e.g., Nagpur)
          { parent_id: { in: topLevelIds } }, // Keep Sub-Zones (e.g., Dighori)
        ],
      },
      select: {
        id: true,
        name: true,
        parent_id: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    // 5. Format BigInt to String to prevent JSON serialization errors
    const formattedZones = zones.map((zone) => ({
      id: zone.id.toString(),
      name: zone.name,
      // Optional: Send parent_id to the frontend if you want to visually indent sub-zones later
      parent_id: zone.parent_id ? zone.parent_id.toString() : null,
    }));

    return res.status(200).json({
      success: true,
      data: formattedZones,
    });
  } catch (error) {
    console.error("Error fetching zones from location_types:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch zones for dropdown",
    });
  }
};

export const getRolesForDropdown = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const currentRoleId = parseInt(user.role_id);
    let allowedRoleIds = [];

    // --- ROLE HIERARCHY LOGIC ---
    // 1: Superadmin | 2: Admin | 6: Zonal Admin | 8: Facility Admin
    // 3: Supervisor | 7: Facility Supv | 5: Cleaner
    switch (currentRoleId) {
      case 1:
        // ✅ FIX: Superadmin can see everything BELOW Superadmin (Removed '1')
        allowedRoleIds = [ 2, 8, 3,7, 5];
        break;
      case 2:
        // Admin: Can see everything BELOW Admin
        allowedRoleIds = [ 8, 3, 7, 5];
        break;
      case 6: // Zonal Admin
      case 8: // Facility Admin
        // Level 3 Admins: Can see Supervisors and Cleaners
        allowedRoleIds = [3,  5];
        break;
      case 3: // Supervisor
      case 7: // Facility Supv
        // Level 4 Supervisors: Can only see Cleaners
        allowedRoleIds = [5];
        break;
      default:
        // Cleaners (5) or unknown roles cannot see the dropdown
        allowedRoleIds = [];
    }

    // --- FETCH FROM DATABASE ---
    const roles = await prisma.role.findMany({
      where: {
        is_active: true,
        id: { in: allowedRoleIds },
      },
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        id: "asc",
      },
    });

    // --- FORMAT BIGINT (If your role IDs are BigInt) ---
    const formattedRoles = roles.map((role) => ({
      id: role.id.toString(),
      name: role.name,
    }));

    return res.status(200).json({
      success: true,
      data: formattedRoles,
    });
  } catch (error) {
    console.error("Error fetching roles for dropdown:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch roles",
    });
  }
};
