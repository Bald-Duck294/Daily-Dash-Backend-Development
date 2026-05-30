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

    // 1. Apply Role-Based Access Control (Crucial for your multi-tenant setup)
    const roleFilter = await RBACFilterService.getLocationFilter(user);
    Object.assign(whereClause, roleFilter);

    // 2. Superadmin/Admin Company Overrides
    if ((user.role_id === 1 || user.role_id === 2) && company_id) {
      whereClause.company_id = BigInt(company_id);
    } else if (company_id) {
      whereClause.company_id = BigInt(company_id); // Assuming standard users pass this too
    }

    // 3. Optional Filters (Type and Facility)
    if (type_id) {
      whereClause.type_id = BigInt(type_id);
    }
    if (facility_company_id) {
      whereClause.facility_company_id = BigInt(facility_company_id);
    }

    // 4. Exclude soft-deleted records (Prevents deleted locations from showing in dropdowns)
    whereClause.deleted_at = null;

    // 5. Force Active Only (Dropdowns shouldn't show inactive/unavailable locations)
    whereClause.OR = [{ status: true }, { status: null }];

    // 6. Highly Optimized Prisma Query (Only grabbing id and name)
    const locations = await prisma.locations.findMany({
      where: Object.keys(whereClause).length ? whereClause : undefined,
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        name: 'asc', // Alphabetical order is best for UI dropdowns
      }
    });

    // 7. Format BigInt to String for JSON serialization
    const formattedLocations = locations.map(loc => ({
      id: loc.id.toString(),
      name: loc.name
    }));

    return res.status(200).json({
      success: true,
      data: formattedLocations
    });

  } catch (error) {
    console.error("Error fetching locations for dropdown:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to fetch locations for dropdown" 
    });
  }
};

export async function getUsersForDropdown(req, res) {
  try {
    // No page/limit params needed
    const { companyId, roleId, search } = req.query;

    // 1. Get Base RBAC Filter
    const userFilter = await RBACFilterService.getUserFilter(req.user, "getUser");

    // 2. Build standard Where Clause
    const whereClause = { 
      ...userFilter, 
      deleted_at: null // Ensures soft-deleted users are excluded
    };

    if (companyId) {
      whereClause.company_id = BigInt(companyId);
    }

    if (roleId && roleId !== "all") {
      whereClause.role_id = Number(roleId);
    }

    if (search) {
      whereClause.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } }
      ];
    }

    // 3. Highly Optimized Query
    // We only SELECT the exact fields a dropdown needs, saving RAM and Bandwidth
    const users = await prisma.users.findMany({
      where: Object.keys(whereClause).length ? whereClause : undefined,
      select: {
        id: true,
        name: true,
        email: true, // Useful to differentiate users with the same name
        role_id: true,
        role: {
          select: {
            name: true // Useful for showing "John Doe (Admin)" in the UI
          }
        }
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