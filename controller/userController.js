import prisma from "../config/prismaClient.mjs";
import bcrypt from "bcryptjs";
import express from "express";
import RBACFilterService from "../utils/rbacFilterService.js";

// export async function getUser(req, res) {

//   try {

//     const { companyId } = req.query;

//     console.log(companyId, "companyId")
//     const users = await prisma.users.findMany({
//       where: {
//         company_id: companyId,
//       },

//       include: {
//         role: true
//       }
//     });
//     // console.log(users, "users");

//     // Convert BigInt to string
//     const usersWithStringIds = users.map((user) => ({
//       ...user,
//       id: user.id.toString(),
//       company_id: user.company_id?.toString() || null,
//     }));

//     console.log(usersWithStringIds, "ids");
//     res.json(usersWithStringIds);
//   } catch (err) {
//     console.error(err);
//     res.status(500).send({ msg: "Error fetching users", err });
//   }
// }

export async function getclientUser(req, res) {
  try {
    const { companyId, roleId, page = 1, limit = 15, search } = req.query;
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const parsedLimit = Math.max(parseInt(limit, 10) || 15, 1);
    const skip = (parsedPage - 1) * parsedLimit;

    const loggedInUserId = BigInt(req.user.id);
    const loggedInUserRole = Number(req.user.role_id);

    // 1. Get Base RBAC Filter
    const userFilter = await RBACFilterService.getUserFilter(
      req.user,
      "getUser",
    );

    const hiddenRoles =
      loggedInUserRole === 1 || loggedInUserRole === 2 ? [6] : [2, 6];

    // 2. Base Where
    const baseWhere = {
      deleted_at: null,
      role_id: { notIn: hiddenRoles },
      AND: [{ id: { not: loggedInUserId } }],
    };

    if (companyId) {
      baseWhere.company_id = BigInt(companyId);
    }

    if (loggedInUserRole === 3 || loggedInUserRole === 8) {
      baseWhere.AND.push({
        OR: [userFilter, { created_by: loggedInUserId }],
      });
    } else {
      if (Object.keys(userFilter).length > 0) {
        baseWhere.AND.push(userFilter);
      }
    }

    // 3. Main Where
    const mainWhere = { ...baseWhere };
    mainWhere.AND = [...baseWhere.AND];

    if (roleId && roleId !== "all") {
      mainWhere.AND.push({ role_id: Number(roleId) });
    }

    if (search) {
      mainWhere.AND.push({
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } },
        ],
      });
    }

    if (mainWhere.AND.length === 0) delete mainWhere.AND;
    if (baseWhere.AND && baseWhere.AND.length === 0) delete baseWhere.AND;

    // 4. Execute Queries
    const [users, totalCount, roleCountsRaw] = await prisma.$transaction([
      prisma.users.findMany({
        where: mainWhere,
        skip: skip,
        take: parsedLimit,
        include: { role: true },
        orderBy: { id: "desc" },
      }),
      prisma.users.count({
        where: mainWhere,
      }),
      prisma.users.groupBy({
        by: ["role_id"],
        where: baseWhere,
        _count: { _all: true },
      }),
    ]);

    // Format role counts safely
    const roleCounts = roleCountsRaw.reduce((acc, item) => {
      if (item.role_id) acc[item.role_id.toString()] = Number(item._count._all);
      return acc;
    }, {});

    // --- 🚨 THE BULLETPROOF FIX 🚨 ---
    // This helper recursively finds ANY BigInt in an object/array and makes it a String
    const serializeBigInt = (obj) => {
      if (typeof obj === "bigint") return obj.toString();
      if (Array.isArray(obj)) return obj.map(serializeBigInt);
      if (obj !== null && typeof obj === "object") {
        // Handle Date objects safely so they don't get destroyed
        if (obj instanceof Date) return obj.toISOString();
        return Object.fromEntries(
          Object.entries(obj).map(([key, value]) => [
            key,
            serializeBigInt(value),
          ]),
        );
      }
      return obj;
    };

    // Serialize everything before sending
    const safeData = serializeBigInt({
      data: users,
      roleCounts: roleCounts,
      meta: {
        totalCount: totalCount,
        totalPages: Math.ceil(totalCount / parsedLimit),
        currentPage: parsedPage,
        itemsPerPage: parsedLimit,
      },
    });

    // Return Data
    res.status(200).json(safeData);
  } catch (error) {
    console.error("Error fetching users with RBAC and Pagination:", error);
    res.status(500).json({
      status: "error",
      message: "Internal Server Error fetching users.",
    });
  }
}

// export async function getclientUser(req, res) {
//   try {
//     const { companyId, roleId, page = 1, limit = 15, search } = req.query;
//     const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
//     const parsedLimit = Math.max(parseInt(limit, 10) || 15, 1);
//     const skip = (parsedPage - 1) * parsedLimit;

//     // 1. Get Base RBAC Filter
//     const userFilter = await RBACFilterService.getUserFilter(req.user, "getUser");

//     // 2. Base Where (used for grouping all available roles)
//     const baseWhere = { ...userFilter, deleted_at: null };
//     if (companyId) {
//       baseWhere.company_id = BigInt(companyId);
//     }

//     // 3. Main Where (used for the table list and total pagination count)
//     const mainWhere = { ...baseWhere };
//     if (roleId && roleId !== "all") {
//       mainWhere.role_id = Number(roleId);
//     }

//     if (search) {
//       mainWhere.OR = [
//         { name: { contains: search, mode: 'insensitive' } },
//         { email: { contains: search, mode: 'insensitive' } },
//         { phone: { contains: search, mode: 'insensitive' } }
//       ];
//     }

//     // 4. THE FIX: Added the groupBy query back into the transaction array!
//     const [users, totalCount, roleCountsRaw] = await prisma.$transaction([
//       // Query 1: Get the actual user rows
//       prisma.users.findMany({
//         where: mainWhere,
//         skip: skip,
//         take: parsedLimit,
//         include: { role: true },
//         orderBy: { id: "desc" },
//       }),
//       // Query 2: Get total count for pagination
//       prisma.users.count({
//         where: mainWhere
//       }),
//       // Query 3: Get the individual role counts for the top cards
//       prisma.users.groupBy({
//         by: ['role_id'],
//         where: baseWhere, // Use baseWhere so cards show ALL counts, regardless of search
//         _count: { _all: true }
//       })
//     ]);

//     // Format role counts for frontend cards safely
//     const roleCounts = roleCountsRaw.reduce((acc, item) => {
//       if (item.role_id) acc[item.role_id.toString()] = item._count._all;
//       return acc;
//     }, {});

//     // Format user IDs
//     const formattedUsers = users.map((user) => ({
//       ...user,
//       id: user.id.toString(),
//       company_id: user.company_id?.toString() || null,
//     }));

//     // Return Data
//     res.status(200).json({
//       data: formattedUsers,
//       roleCounts: roleCounts, // Now this will successfully pass to the frontend
//       meta: {
//         totalCount: totalCount,
//         totalPages: Math.ceil(totalCount / parsedLimit),
//         currentPage: parsedPage,
//         itemsPerPage: parsedLimit,
//       },
//     });

//   } catch (error) {
//     console.error("Error fetching users with RBAC and Pagination:", error);
//     res.status(500).json({
//       status: "error",
//       message: "Internal Server Error fetching users."
//     });
//   }
// }

export async function getUser(req, res) {
  try {
    const { companyId, roleId, page = 1, limit = 10 } = req.query;
    const parsedPage = parseInt(page, 10);
    const parsedLimit = parseInt(limit, 10);
    const skip = (parsedPage - 1) * parsedLimit;
    const currentUser = req.user;

    const userFilter = await RBACFilterService.getUserFilter(
      currentUser,
      "getUser",
    );

    const whereClause = { ...userFilter, deleted_at: null };
    if (companyId) whereClause.company_id = BigInt(companyId);
    if (roleId) whereClause.role_id = Number(roleId);

    // Run both queries in one transaction
    const [users, totalCount] = await prisma.$transaction([
      prisma.users.findMany({
        where: whereClause,
        skip: skip,
        take: parsedLimit,
        include: {
          role: true,
          cleaner_assignments_as_cleaner: {
            where: { deleted_at: null },
            select: { name: true, locations: { select: { name: true } } },
          },
        },
        orderBy: { id: "desc" },
      }),
      prisma.users.count({ where: whereClause }), // Same filter applied for accurate count
    ]);

    const usersWithStringIds = users.map((user) => ({
      ...user,
      id: user.id.toString(),
      company_id: user.company_id?.toString() || null,
    }));

    // Return object containing both data and metadata
    res.json({
      data: usersWithStringIds,
      meta: {
        totalCount,
        totalPages: Math.ceil(totalCount / parsedLimit),
        currentPage: parsedPage,
        itemsPerPage: parsedLimit,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).send({ msg: "Error fetching users", err });
  }
}

export async function getUsersCount(req, res) {
  try {
    const { roleId, companyId } = req.query;
    const currentUser = req.user;

    // Use your existing RBAC service
    const userFilter = await RBACFilterService.getUserFilter(
      currentUser,
      "getUser",
    );

    const whereClause = { ...userFilter, deleted_at: null };
    if (companyId) whereClause.company_id = BigInt(companyId);
    if (roleId) whereClause.role_id = Number(roleId);

    // Get the total count across ALL pages
    const totalCount = await prisma.users.count({ where: whereClause });

    res.json({ totalCount, success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching user count" });
  }
}

// export async function getUserById(req, res) {
//   try {
//     const { id } = req.params;
//     console.log('Getting user by ID:', id);

//     const user = await prisma.users.findUnique({
//       where: { id: BigInt(id) },
//       include: {
//         role: {
//           select: {
//             id: true,
//             name: true,
//             description: true
//           }
//         },
//         companies: {
//           select: {
//             id: true,
//             name: true,
//             description: true
//           }
//         },
//         location_assignments: {
//           where: { is_active: true },
//           include: {
//             location: {
//               select: {
//                 id: true,
//                 name: true,
//                 latitude: true,
//                 longitude: true
//               }
//             }
//           }
//         },
//         // Include other relationships if needed
//         cleaner_assignments_as_cleaner: {
//           include: {
//             locations: {
//               select: { id: true, name: true }
//             }
//           }
//         },
//         cleaner_assignments_as_supervisor: {
//           include: {
//             locations: {
//               select: { id: true, name: true }
//             }
//           }
//         }
//       }
//     });

//     console.log(user, "user")
//     if (!user) {
//       return res.status(404).json({ message: "User not found" });
//     }

//     // Convert BigInt to string and format response
//     const safeUser = {
//       ...user,
//       id: user.id.toString(),
//       company_id: user.company_id?.toString() || null,
//       location_assignments: user.location_assignments?.map(assignment => ({
//         ...assignment,
//         id: assignment.id.toString(),
//         location_id: assignment.location_id.toString(),
//         user_id: assignment.user_id.toString(),
//         location: {
//           ...assignment.location,
//           id: assignment.location.id.toString()
//         }
//       })) || [],
//       cleaner_assignments_as_cleaner: user.cleaner_assignments_as_cleaner?.map(assignment => ({
//         ...assignment,
//         id: assignment.id.toString(),
//         cleaner_user_id: assignment.cleaner_user_id.toString(),
//         location_id: assignment.location_id?.toString() || null,
//         locations: assignment.locations ? {
//           ...assignment.locations,
//           id: assignment.locations.id.toString()
//         } : null
//       })) || [],
//       cleaner_assignments_as_supervisor: user.cleaner_assignments_as_supervisor?.map(assignment => ({
//         ...assignment,
//         id: assignment.id.toString(),
//         supervisor_id: assignment.supervisor_id?.toString() || null,
//         location_id: assignment.location_id?.toString() || null,
//         locations: assignment.locations ? {
//           ...assignment.locations,
//           id: assignment.locations.id.toString()
//         } : null
//       })) || []
//     };

//     console.log('User found:', safeUser.name);
//     res.json(safeUser);
//   } catch (err) {
//     console.error('Error in getUserById:', err);
//     res.status(500).json({ message: "Error fetching user", error: err.message });
//   }
// }

export async function getUserById(req, res) {
  try {
    const { id } = req.params;
    console.log("Getting user by ID:", id);

    const user = await prisma.users.findUnique({
      where: { id: BigInt(id) },
      include: {
        role: true,
        companies: true,
        cleaner_assignments_as_cleaner: {
          where: {
            deleted_at: null,
          },
          select: {
            id: true,
            name: true,
            status: true,
            assigned_on: true,
            location_id: true,
            locations: {
              select: {
                id: true,
                name: true,
                address: true,
                city: true,
                state: true,
                latitude: true,
                longitude: true,
                pincode: true,
                type_id: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // console.log(user, "single user");
    // console.log(JSON.stringify(user, null, 2), "single strigny useer"); // Pretty printed JSON

    console.dir(user, { depth: null, colors: true });
    console.log("--- single user ---");

    // ✅ Manual conversion with proper handling
    const safeUser = {
      id: user.id.toString(),
      name: user.name,
      email: user.email,
      phone: user.phone,
      company_id: user.company_id?.toString() || null,
      age: user.age,
      birthdate: user.birthdate,
      role_id: user.role_id,
      created_at: user.created_at,
      updated_at: user.updated_at,

      // Role data
      role: user.role
        ? {
            id: user.role.id,
            name: user.role.name,
            description: user.role.description,
          }
        : null,

      // Company data
      companies: user.companies
        ? {
            id: user.companies.id.toString(), // ✅ Convert company BigInt
            name: user.companies.name,
            description: user.companies.description,
          }
        : null,

      location_assignments: user?.cleaner_assignments_as_cleaner
        ? user?.cleaner_assignments_as_cleaner.map((item) => ({
            ...item,
            id: item?.id?.toString(),
            location_id: item?.id?.toString(),
            locations: {
              ...item.locations,
              id: item?.locations?.id?.toString(),
              type_id: item?.locations?.type_id?.toString(),
            },
          }))
        : null,
    };

    // console.log('User found:', safeUser.name);
    console.log(safeUser, "safe usere");
    res.json(safeUser);
  } catch (err) {
    console.error("Error in getUserById:", err);
    res
      .status(500)
      .json({ message: "Error fetching user", error: err.message });
  }
}

// // Handles POST /api/users

export const createUser = async (req, res) => {
  try {
    const { password, location_ids = [], company_id, ...data } = req.body;

    if (!password)
      return res.status(400).json({ message: "Password is required" });

    // Check if the user being created is a superadmin
    const isCreatingSuperAdmin = parseInt(data.role_id) === 1;

    // Enforce company_id requirement if they are NOT a superadmin
    if (!company_id && !isCreatingSuperAdmin) {
      return res.status(400).json({ message: "Company ID is required" });
    }

    // Fix for Age
    if (data.age === "") {
      data.age = null;
    } else if (data.age) {
      data.age = parseInt(data.age, 10);
    }

    // 🆕 Fix for Email (Convert empty string to null to prevent P2002 duplicate errors)
    if (data.email === "") {
      data.email = null;
    }

    const currentUser = req.user;

    // Check multiple possible locations for role_id
    const currentRoleId =
      currentUser?.role_id ||
      currentUser?.role?.id ||
      currentUser?.user?.role_id;

    console.log("3. Extracted Role ID:", currentRoleId);

    const isSupervisor = parseInt(currentRoleId) === 3;

    const hashedPassword = await bcrypt.hash(password, 10);

    const serializeBigInt = (obj) => {
      return JSON.parse(
        JSON.stringify(obj, (key, value) =>
          typeof value === "bigint" ? value.toString() : value,
        ),
      );
    };

    const currentUserId = currentUser?.id || currentUser?.user?.id;

    // 🔥 WRAPPED IN TRANSACTION FOR LIMIT CHECKS 🔥
    const newUser = await prisma.$transaction(async (tx) => {
      // --- 🚨 LIMIT CHECKS FOR USERS 🚨 ---
      if (company_id && !isCreatingSuperAdmin) {
        const companyIdBigInt = BigInt(company_id);
        const roleIdInt = parseInt(data.role_id);

        // 1. Check Overall MAX_USERS Limit
        const userLimit = await tx.system_limits.findFirst({
          where: {
            limit_key: "MAX_USERS",
            company_id: companyIdBigInt,
            is_enabled: true,
          },
        });

        if (userLimit && userLimit.current_value >= userLimit.limit_value) {
          throw new Error("LIMIT_MAX_USERS");
        }

        // 2. Check Specific Role Limit (MAX_CLEANERS or MAX_SUPERVISORS)
        let roleLimitKey = null;
        if (roleIdInt === 3) roleLimitKey = "MAX_SUPERVISORS";
        if (roleIdInt === 5 || roleIdInt === 8) roleLimitKey = "MAX_CLEANERS"; // Assuming 5/8 are cleaners

        if (roleLimitKey) {
          const roleLimit = await tx.system_limits.findFirst({
            where: {
              limit_key: roleLimitKey,
              company_id: companyIdBigInt,
              is_enabled: true,
            },
          });

          if (roleLimit && roleLimit.current_value >= roleLimit.limit_value) {
            throw new Error(`LIMIT_${roleLimitKey}`);
          }

          // Increment Role Limit
          if (roleLimit) {
            await tx.system_limits.update({
              where: { id: roleLimit.id },
              data: { current_value: { increment: 1 } },
            });
          }
        }

        // Increment Overall User Limit
        if (userLimit) {
          await tx.system_limits.update({
            where: { id: userLimit.id },
            data: { current_value: { increment: 1 } },
          });
        }
      }
      // --- END LIMIT CHECKS ---

      // Create the user
      return await tx.users.create({
        data: {
          ...data,
          password: hashedPassword,
          ...(company_id && { company_id: BigInt(company_id) }),
          birthdate: data?.birthdate ? new Date(data.birthdate) : null,
          ...(isSupervisor &&
            currentUserId && { created_by: BigInt(currentUserId) }),
        },
        include: {},
      });
    });

    const safeUser = serializeBigInt({
      ...newUser,
      id: newUser.id.toString(),
      ...(newUser.company_id && { company_id: newUser.company_id.toString() }),
      ...(newUser.created_by && { created_by: newUser.created_by.toString() }),
    });

    res.status(201).json(safeUser);
  } catch (error) {
    console.error("Error in createUser:", error);

    // 🆕 Custom Limit Error Handlers
    if (error.message === "LIMIT_MAX_USERS") {
      return res.status(403).json({
        status: "error",
        message: "Maximum overall user limit reached for this company.",
      });
    }
    if (error.message.startsWith("LIMIT_MAX_")) {
      const roleName = error.message.replace("LIMIT_MAX_", "").toLowerCase();
      return res.status(403).json({
        status: "error",
        message: `Maximum limit for ${roleName} reached. Cannot add more.`,
      });
    }

    // 🆕 Catch the Prisma Unique Constraint error gracefully
    if (error.code === "P2002") {
      const target = error.meta?.target || [];
      if (target.includes("email")) {
        return res
          .status(400)
          .json({ message: "A user with this email already exists." });
      }
      if (target.includes("phone")) {
        return res
          .status(400)
          .json({ message: "A user with this phone number already exists." });
      }
      return res
        .status(400)
        .json({ message: "A record with this information already exists." });
    }

    res
      .status(500)
      .json({ message: "Error creating user", error: error.message });
  }
};

export const updateUser = async (req, res) => {
  const userId = BigInt(req.params.id);
  try {
    const { password, location_ids, ...data } = req.body;

    if (password) {
      data.password = await bcrypt.hash(password, 10);
    }
    if (data.birthdate) {
      data.birthdate = new Date(data.birthdate);
    }

    const updatedUser = await prisma.$transaction(async (tx) => {
      // ✅ Update user info
      const user = await tx.users.update({
        where: { id: userId },
        data,
      });

      // ✅ Handle location assignments if provided
      if (location_ids !== undefined) {
        // Only update if explicitly provided
        // First, deactivate all existing assignments for this user
        await tx.cleaner_assignments.updateMany({
          where: { cleaner_user_id: userId },
          data: { status: "unassigned", role_id: user?.role_id }, // Mark as unassigned instead of deleting
        });

        // Then, create/update new assignments
        if (Array.isArray(location_ids) && location_ids.length > 0) {
          for (const locId of location_ids) {
            await tx.cleaner_assignments.upsert({
              where: {
                // ✅ Use composite key from your schema
                id: BigInt(locId), // If updating existing assignment
              },
              update: {
                status: "assigned",
                updated_at: new Date(),
              },
              create: {
                cleaner_user_id: userId,
                location_id: BigInt(locId),
                company_id: BigInt(data.company_id), // ✅ Add company_id
                name: data.name, // ✅ Required field
                status: "assigned",
                assigned_on: new Date(),
              },
            });
          }
        }
      }

      return user;
    });

    // ✅ Serialize BigInt values
    const safeUser = JSON.parse(
      JSON.stringify(updatedUser, (key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    );

    res.status(200).json({
      ...safeUser,
      birthdate: safeUser?.birthdate ? new Date(safeUser.birthdate) : null,
      message: "User updated successfully",
    });
  } catch (error) {
    console.error("Error in updateUser:", error);

    if (error.code === "P2002") {
      return res.status(409).json({
        message: `User with this ${error.meta.target.join(", ")} already exists.`,
      });
    }

    if (error.code === "P2025") {
      return res.status(404).json({
        message: "User or assignment not found",
      });
    }

    res.status(500).json({
      message: "Error updating user",
      error: error.message,
    });
  }
};

// --- DELETE USER ---
// Handles DELETE /api/users/:id

export const deleteUser = async (req, res) => {
  const userId = BigInt(req.params.id);
  try {
    // 🔥 WRAPPED IN TRANSACTION TO DECREMENT LIMITS 🔥
    await prisma.$transaction(async (tx) => {
      // 1. Fetch user to know their role and company before deleting
      const userToDelete = await tx.users.findUnique({
        where: { id: userId },
        select: { company_id: true, role_id: true },
      });

      if (!userToDelete) {
        throw new Error("USER_NOT_FOUND");
      }

      // 2. Delete related assignments
      await tx.cleaner_assignments.deleteMany({
        where: { cleaner_user_id: userId },
      });

      // 3. Delete the user
      await tx.users.delete({ where: { id: userId } });

      // 4. Decrement Limits
      if (userToDelete.company_id) {
        const companyIdBigInt = userToDelete.company_id;
        const roleIdInt = parseInt(userToDelete.role_id);

        // Decrement MAX_USERS
        const userLimit = await tx.system_limits.findFirst({
          where: {
            limit_key: "MAX_USERS",
            company_id: companyIdBigInt,
            is_enabled: true,
          },
        });
        if (userLimit && userLimit.current_value > 0) {
          await tx.system_limits.update({
            where: { id: userLimit.id },
            data: { current_value: { decrement: 1 } },
          });
        }

        // Decrement Specific Role Limit
        let roleLimitKey = null;
        if (roleIdInt === 3) roleLimitKey = "MAX_SUPERVISORS";
        if (roleIdInt === 5 || roleIdInt === 8) roleLimitKey = "MAX_CLEANERS";

        if (roleLimitKey) {
          const roleLimit = await tx.system_limits.findFirst({
            where: {
              limit_key: roleLimitKey,
              company_id: companyIdBigInt,
              is_enabled: true,
            },
          });
          if (roleLimit && roleLimit.current_value > 0) {
            await tx.system_limits.update({
              where: { id: roleLimit.id },
              data: { current_value: { decrement: 1 } },
            });
          }
        }
      }
    });

    res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    if (error.message === "USER_NOT_FOUND") {
      return res.status(404).json({ message: "User not found" });
    }
    console.log("Error in deleteUser:", error);
    res
      .status(500)
      .json({ message: "Error deleting user", error: error.message });
  }
};

export const updateProfile = async (req, res) => {
  try {
    // 🔐 userId MUST come from auth middleware
    const userId = BigInt(req.user.id);

    const { name, email, phone, currentPassword, newPassword } = req.body;

    const updateData = {
      updated_at: new Date(),
    };

    if (name) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone; 

    // Handle Email Update
    if (email) {
      const existingUser = await prisma.users.findUnique({
        where: { email },
        select: { id: true }
      });

      if (existingUser && existingUser.id !== userId) {
        return res.status(400).json({
          success: false,
          message: "This email is already in use by another account.",
        });
      }
      updateData.email = email;
    }

    // Handle Password Update
    const isChangingPassword = currentPassword || newPassword;

    if (isChangingPassword) {
      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          message: "Current password and new password are required to change password.",
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: "Password must be at least 6 characters long.",
        });
      }

      const user = await prisma.users.findUnique({
        where: { id: userId },
        select: { password: true },
      });

      if (!user || !user.password) {
        return res.status(404).json({
          success: false,
          message: "User not found.",
        });
      }

      // bcryptjs compare works identically
      const isValid = await bcrypt.compare(currentPassword, user.password);
      if (!isValid) {
        return res.status(401).json({
          success: false,
          message: "Current password is incorrect.",
        });
      }

      // bcryptjs hash works identically
      updateData.password = await bcrypt.hash(newPassword, 10);
    }

    const updatedUser = await prisma.users.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role_id: true,
      },
    });

    const safeUser = {
      ...updatedUser,
      id: updatedUser.id.toString(),
    };

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: safeUser,
    });

  } catch (error) {
    console.error("updateProfile Error:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while updating the profile.",
    });
  }
};