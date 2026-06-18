import prisma from "../config/prismaClient.mjs";
import RBACFilterService from "../utils/rbacFilterService.js";
import { serializeBigInt } from "../utils/serializer.js";


// export const getAllAssignments = async (req, res) => {
//   try {

//     const user = req.user;
//     // Fetch assignments with locations
//     console.log('hitting get assignment')
//     console.log('in get all assignment');
//     const { company_id, role_id } = req.query;

//     if (!company_id) {
//       return res.status(400).json({
//         status: "error",
//         message: "company_id query parameter is required."
//       });
//     }

//     let whereClause = {};


//     if (req.user.role_id === 3) {
//       console.log("Supervisor - excluding other supervisors");
//       whereClause.role_id = {
//         not: 3  // Exclude role_id 3 (supervisors)
//       };
//     }


//     console.log(req.query, "req query");
//     // console.log(req.user, "req user");
//     if (company_id) {
//       whereClause.company_id = company_id;
//     }

//     if (role_id && role_id !== 'undefined') {
//       const requestedRoleId = parseInt(role_id);

//       // If supervisor is filtering, make sure they can't override the exclusion
//       if (req.user.role_id === 3 && requestedRoleId === 3) {
//         console.log("Supervisor cannot filter to see other supervisors");
//         // Don't apply this filter - keep the NOT filter
//       } else {
//         whereClause.role_id = requestedRoleId;
//       }
//     }

//     const filteredLocationIds = await RBACFilterService.getLocationFilter(user, "cleaner_activity")
//     console.log(filteredLocationIds, "filteredlocations ")

//     whereClause = {
//       ...whereClause,
//       ...filteredLocationIds
//     }

//     console.log("final where cause", whereClause)

//     const assignments = await prisma.cleaner_assignments.findMany({
//       where: whereClause,
//       include: {
//         locations: true,
//         role: {
//           select: {
//             id: true,
//             name: true
//           }
//         }
//       },

//       orderBy: { id: "desc" },
//     });

//     console.log(company_id, "company_id");
//     // console.log(assignments, "in ass")
//     // Collect user IDs
//     const userIds = assignments.map((a) => a.cleaner_user_id);

//     // Fetch users
//     const users = await prisma.users.findMany({
//       where: { id: { in: userIds } },
//       select: { id: true, name: true, email: true }, // pick only what you need
//     });

//     // Map userId → user object
//     const userMap = Object.fromEntries(users.map((u) => [u.id.toString(), u]));

//     // Attach user to each assignment
//     const assignmentsWithUsers = assignments.map((a) => ({
//       ...a,
//       user: userMap[a.cleaner_user_id.toString()] || null,
//     }));

//     console.log(assignmentsWithUsers.length, "assignment with user length")
//     // console.log(assignmentsWithUsers, "assigned  users ");
//     res.status(200).json({
//       status: "success",
//       message: "Assignments retrieved successfully.",
//       data: serializeBigInt(assignmentsWithUsers),
//     });
//   } catch (error) {
//     console.error("Error fetching assignments:", error);
//     res.status(500).json({ status: "error", message: "Internal Server Error" });
//   }
// };

export const getAllAssignments = async (req, res) => {
  try {
    const user = req.user;

    // --- 1. PAGINATION ---
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 15;
    const skip = (page - 1) * limit;
    const { company_id, role_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ status: "error", message: "company_id required." });
    }

    let whereClause = { deleted_at: null }; // Ensure we only get active assignments

    if (req.user.role_id === 3) {
      whereClause.role_id = { not: 3 };
    }
    if (company_id) {
      whereClause.company_id = company_id;
    }
    if (role_id && role_id !== 'undefined') {
      const requestedRoleId = parseInt(role_id);
      if (!(req.user.role_id === 3 && requestedRoleId === 3)) {
        whereClause.role_id = requestedRoleId;
      }
    }

    const filteredLocationIds = await RBACFilterService.getLocationFilter(user, "cleaner_activity");
    whereClause = { ...whereClause, ...filteredLocationIds };

    // --- 2. COUNT & FETCH ---
    const totalRecords = await prisma.cleaner_assignments.count({ where: whereClause });

    const assignments = await prisma.cleaner_assignments.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy: { id: "desc" },
      // SELECT ONLY WHAT IS NEEDED
      select: {
        id: true,
        status: true,
        assigned_on: true,
        locations: {
          select: { name: true } // Only get location name
        },
        role: {
          select: { name: true } // Only get role name
        },
        cleaner_user: {
          select: { name: true,  phone:true} // Only get user name and phone
        }
      }
    });

    // --- 3. LEAN MAP ---
    // Prisma returns the nested objects directly now, no extra mapping needed!
    const result = assignments.map(a => ({
      ...a,
      id: a.id.toString(),
      user: a.cleaner_user, // Directly map the user object from the relation
      locations: a.locations,
      role: a.role
    }));

    res.status(200).json({
      status: "success",
      data: serializeBigInt(result),
      pagination: {
        total: totalRecords,
        page,
        limit,
        last_page: Math.ceil(totalRecords / limit) || 1
      }
    });
  } catch (error) {
    console.error("Error fetching assignments:", error);
    res.status(500).json({ status: "error", message: "Internal Server Error" });
  }
};

// export const getAllAssignments = async (req, res) => {
//   try {
//     const user = req.user;

//     // --- 1. EXTRACT PAGINATION PARAMS ---
//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 15;
//     const skip = (page - 1) * limit;

//     const { company_id, role_id } = req.query;

//     if (!company_id) {
//       return res.status(400).json({
//         status: "error",
//         message: "company_id query parameter is required."
//       });
//     }

//     // ✅ ADDED: Initialize whereClause to explicitly exclude soft-deleted records
//     let whereClause = { deleted_at: null };

//     if (req.user.role_id === 3) {
//       whereClause.role_id = { not: 3 };
//     }

//     if (company_id) {
//       whereClause.company_id = company_id;
//     }

//     if (role_id && role_id !== 'undefined') {
//       const requestedRoleId = parseInt(role_id);
//       if (!(req.user.role_id === 3 && requestedRoleId === 3)) {
//         whereClause.role_id = requestedRoleId;
//       }
//     }

//     const filteredLocationIds = await RBACFilterService.getLocationFilter(user, "cleaner_activity");

//     whereClause = {
//       ...whereClause,
//       ...filteredLocationIds
//     };

//     // --- 2. GET TOTAL COUNT (Now automatically respects deleted_at: null) ---
//     const totalRecords = await prisma.cleaner_assignments.count({
//       where: whereClause,
//     });

//     // --- 3. FETCH WITH SKIP & TAKE (Now automatically respects deleted_at: null) ---
//     const assignments = await prisma.cleaner_assignments.findMany({
//       where: whereClause,
//       skip: skip,
//       take: limit,
//       include: {
//         locations: true,
//         role: {
//           select: { id: true, name: true }
//         }
//       },
//       orderBy: { id: "desc" },
//     });

//     // Collect user IDs
//     const userIds = assignments.map((a) => a.cleaner_user_id);

//     // Fetch users
//     const users = await prisma.users.findMany({
//       where: { id: { in: userIds } },
//       select: { id: true, name: true, email: true }, 
//     });

//     // Map userId → user object
//     const userMap = Object.fromEntries(users.map((u) => [u.id.toString(), u]));

//     // Attach user to each assignment
//     const assignmentsWithUsers = assignments.map((a) => ({
//       ...a,
//       user: userMap[a.cleaner_user_id.toString()] || null,
//     }));

//     // --- 4. RETURN DATA AND PAGINATION METADATA ---
//     res.status(200).json({
//       status: "success",
//       message: "Assignments retrieved successfully.",
//       data: serializeBigInt(assignmentsWithUsers),
//       pagination: {
//         total: totalRecords,
//         page: page,
//         limit: limit,
//         last_page: Math.ceil(totalRecords / limit) || 1
//       }
//     });
//   } catch (error) {
//     console.error("Error fetching assignments:", error);
//     res.status(500).json({ status: "error", message: "Internal Server Error" });
//   }
// };

export const getAssignmentByCleanerUserId = async (req, res) => {
  try {
    // const cleanerUserId = parseInt(req.params.id);
    const { cleaner_user_id } = req.params;
    const cleanerUserId = parseInt(cleaner_user_id);

    if (isNaN(cleanerUserId)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid cleaner_user_id provided.",
      });
    }

    console.log(cleanerUserId, "cleaner_user_id");

    const assignments = await prisma.cleaner_assignments.findMany({
      where: { cleaner_user_id: cleanerUserId },
      include: { locations: true },
      orderBy: { id: "asc" },
    });

    console.log(assignments.length, assignments.length === 0);
    if (assignments.length === 0) {
      return res.status(200).json({
        status: "success",
        message: "Query ran successfully but no assignments found.",
        data: [],
      });
    }

    res.status(200).json({
      status: "success",
      message: "Assignments retrieved successfully.",
      data: serializeBigInt(assignments),
    });
  } catch (error) {
    console.error("Error fetching assignments by cleaner_user_id:", error);
    res.status(500).json({ status: "error", message: "Internal Server Error" });
  }
};

// controller/assignmentController.js (or wherever your assignment controllers are)

export const getAssignmentById = async (req, res) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    // Input validation
    if (!id || isNaN(id)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid assignment ID provided"
      });
    }

    // Build where clause
    let whereClause = {
      id: BigInt(id)
    };

    // Add company filter if provided
    if (company_id) {
      whereClause.company_id = BigInt(company_id);
    }

    const assignment = await prisma.cleaner_assignments.findUnique({
      where: whereClause,
      include: {
        // Include user details
        cleaner_user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            role: {
              select: {
                name: true
              }
            }
          }
        },
        // Include location details  
        locations: {
          select: {
            id: true,
            name: true,
            latitude: true,
            longitude: true,
            location_types: {
              select: {
                name: true
              }
            }
          }
        },
        // Include supervisor details
        supervisor: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (!assignment) {
      return res.status(404).json({
        status: "error",
        message: "Assignment not found"
      });
    }

    // Serialize BigInt values
    const serializedAssignment = JSON.parse(JSON.stringify(assignment, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    ));

    res.json({
      status: "success",
      data: serializedAssignment,
      message: "Assignment retrieved successfully"
    });

  } catch (error) {
    console.error("Get assignment by ID error:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to fetch assignment",
      detail: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};


// export const createAssignment = async (req, res) => {
//   console.log("in create assignments");
//   try {
//     const { cleaner_user_id, company_id, location_ids, status, role_id } = req.body;

//     console.log(req.body, "assignment create req body")
//     console.log('after req.body ');

//     // --- Validation ---
//     if (
//       !cleaner_user_id ||
//       !company_id ||
//       !location_ids ||
//       !Array.isArray(location_ids) ||
//       location_ids.length === 0
//     ) {
//       return res.status(400).json({
//         status: "error",
//         message:
//           "Missing required fields: cleaner_user_id, company_id, and a non-empty array of location_ids.",
//       });
//     }

//     // --- Fetch the locations ---
//     const locations = await prisma.locations.findMany({
//       where: {
//         id: { in: location_ids.map((id) => BigInt(id)) },
//       },
//       select: { id: true, name: true, type_id: true },
//     });

//     if (locations.length !== location_ids.length) {
//       return res.status(404).json({
//         status: "error",
//         message: "One or more selected locations could not be found.",
//       });
//     }

//     // ✅ Check for existing assignments
//     const existingAssignments = await prisma.cleaner_assignments.findMany({
//       where: {
//         cleaner_user_id: BigInt(cleaner_user_id),
//         location_id: { in: location_ids.map((id) => BigInt(id)) },
//         company_id: BigInt(company_id),
//         status: 'assigned'
//       },
//       select: { location_id: true },
//     });

//     const existingLocationIds = existingAssignments.map((a) => a.location_id.toString());

//     // Filter out locations that already have assignments
//     const locationsToAssign = locations.filter(
//       (loc) => !existingLocationIds.includes(loc.id.toString())
//     );

//     if (locationsToAssign.length === 0) {
//       return res.status(400).json({
//         status: "error",
//         message: "This cleaner is already assigned to all selected locations.",
//         existingAssignments: existingLocationIds,
//       });
//     }

//     // Prepare data for new assignments only
//     const assignmentsToCreate = locationsToAssign.map((location) => ({
//       name: location.name,
//       cleaner_user_id: BigInt(cleaner_user_id),
//       company_id: BigInt(company_id),
//       type_id: location.type_id,
//       location_id: location.id,
//       status: status || "unassigned",
//       role_id: role_id
//     }));

//     // --- Bulk insert ---
//     const result = await prisma.cleaner_assignments.createMany({
//       data: assignmentsToCreate,
//     });

//     console.log(result, "result");

//     // Prepare response message
//     const skippedCount = locations.length - locationsToAssign.length;
//     let message = `${result.count} assignment(s) created successfully.`;

//     if (skippedCount > 0) {
//       message += ` ${skippedCount} location(s) skipped (already assigned).`;
//     }

//     res.status(201).json({
//       status: "success",
//       message: message,
//       data: {
//         created: result.count,
//         skipped: skippedCount,
//         skippedLocationIds: existingLocationIds,
//       },
//     });
//   } catch (error) {
//     console.error("Error creating assignments:", error);
//     res.status(500).json({
//       status: "error",
//       message: "Internal Server Error",
//       detail: process.env.NODE_ENV === 'development' ? error.message : undefined
//     });
//   }
// };

export const createAssignment = async (req, res) => {
  try {
    // ✅ Extract type_ids (array) instead of type_id
    const { cleaner_user_id, company_id, location_ids, type_ids, type_id, status, role_id } = req.body;
    const caller = req.user; 

    if (!cleaner_user_id || !company_id || !role_id) {
      return res.status(400).json({
        status: "error",
        message: "Missing required fields: cleaner_user_id, company_id, and role_id.",
      });
    }

    // Normalize type_ids so it always treats it as an array (even if frontend sends old 'type_id' key)
    const typesArray = type_ids || (type_id ? (Array.isArray(type_id) ? type_id : [type_id]) : []);

    const hasLocations = location_ids && Array.isArray(location_ids) && location_ids.length > 0;
    const hasTypes = typesArray && Array.isArray(typesArray) && typesArray.length > 0;

    if (!hasLocations && !hasTypes) {
      return res.status(400).json({
        status: "error",
        message: "You must provide either an array of location_ids OR type_ids.",
      });
    }

    if (hasLocations && hasTypes) {
      return res.status(400).json({
        status: "error",
        message: "You cannot provide both location_ids and type_ids. Choose one assignment method.",
      });
    }

    const parsedRoleId = parseInt(role_id);

    // --- 🚨 SECURITY AUTHORIZATION CHECK 🚨 ---
    if (caller.role_id !== 1 && caller.role_id !== 2) {
      const callerAllowedBigInts = await RBACFilterService.getAuthorizedLocationIds(caller.id, caller.company_id);
      const callerAllowedIds = callerAllowedBigInts.map(id => id.toString());

      if (hasLocations) {
        const hasUnauthorizedLocations = location_ids.some(
          (reqLocId) => !callerAllowedIds.includes(reqLocId.toString())
        );
        if (hasUnauthorizedLocations) {
          return res.status(403).json({
            status: "error",
            message: "Forbidden: You are trying to assign a user to a location you do not manage."
          });
        }
      }

      if (hasTypes) {
        return res.status(403).json({
          status: "error",
          message: "Forbidden: Only Administrators can grant broad zone/type-based access."
        });
      }
    }

    // --- SCENARIO A: TYPE-BASED ASSIGNMENT (Zonal Admins / Broad Access) ---
    if (hasTypes) {
      // 1. Find if they are already assigned to any of these zones
      const existingTypeAssignments = await prisma.cleaner_assignments.findMany({
        where: {
          cleaner_user_id: BigInt(cleaner_user_id),
          type_id: { in: typesArray.map((id) => BigInt(id)) },
          company_id: BigInt(company_id),
          status: 'assigned'
        }
      });

      const existingTypeIds = existingTypeAssignments.map((a) => a.type_id.toString());
      const typesToAssign = typesArray.filter((id) => !existingTypeIds.includes(id.toString()));

      if (typesToAssign.length === 0) {
        return res.status(400).json({ 
          status: "error", 
          message: "User is already assigned to all selected zones." 
        });
      }

      // 2. Fetch the zone names from DB so we can save "Nagpur" instead of "Broad Type Assignment"
      const zoneRecords = await prisma.location_types.findMany({
        where: { id: { in: typesToAssign.map(id => BigInt(id)) } },
        select: { id: true, name: true }
      });

      // 3. Prepare the data payload for createMany
      const assignmentsToCreate = typesToAssign.map((typeId) => {
        const matchingZone = zoneRecords.find(z => z.id.toString() === typeId.toString());
        return {
          name: matchingZone ? matchingZone.name : "Zone Assignment",
          cleaner_user_id: BigInt(cleaner_user_id),
          company_id: BigInt(company_id),
          type_id: BigInt(typeId),
          location_id: null,
          status: status || "assigned",
          role_id: parsedRoleId,
        };
      });

      // 4. Bulk insert the zones
      const result = await prisma.cleaner_assignments.createMany({ data: assignmentsToCreate });

      const skippedCount = typesArray.length - typesToAssign.length;
      let message = `${result.count} zone assignment(s) created successfully.`;
      if (skippedCount > 0) message += ` ${skippedCount} zone(s) skipped (already assigned).`;

      return res.status(201).json({
        status: "success",
        message: message,
        data: { created: result.count, skipped: skippedCount }
      });
    }

    // --- SCENARIO B: LOCATION-BASED ASSIGNMENT (Specific Nodes) ---
    const locations = await prisma.locations.findMany({
      where: { id: { in: location_ids.map((id) => BigInt(id)) } },
      select: { id: true, name: true }, 
    });

    if (locations.length !== location_ids.length) {
      return res.status(404).json({ status: "error", message: "One or more selected locations could not be found." });
    }

    const existingAssignments = await prisma.cleaner_assignments.findMany({
      where: {
        cleaner_user_id: BigInt(cleaner_user_id),
        location_id: { in: location_ids.map((id) => BigInt(id)) },
        company_id: BigInt(company_id),
        status: 'assigned'
      },
      select: { location_id: true },
    });

    const existingLocationIds = existingAssignments.map((a) => a.location_id.toString());
    const locationsToAssign = locations.filter((loc) => !existingLocationIds.includes(loc.id.toString()));

    if (locationsToAssign.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "This user is already assigned to all selected locations.",
        existingAssignments: existingLocationIds,
      });
    }

    const assignmentsToCreate = locationsToAssign.map((location) => ({
      name: location.name,
      cleaner_user_id: BigInt(cleaner_user_id),
      company_id: BigInt(company_id),
      type_id: null, 
      location_id: location.id,
      status: status || "assigned",
      role_id: parsedRoleId,
    }));

    const result = await prisma.cleaner_assignments.createMany({ data: assignmentsToCreate });

    const skippedCount = locations.length - locationsToAssign.length;
    let message = `${result.count} location assignment(s) created successfully.`;
    if (skippedCount > 0) message += ` ${skippedCount} location(s) skipped (already assigned).`;

    res.status(201).json({
      status: "success",
      message: message,
      data: { created: result.count, skipped: skippedCount, skippedLocationIds: existingLocationIds },
    });
  } catch (error) {
    console.error("Error creating assignments:", error);
    res.status(500).json({ status: "error", message: "Internal Server Error" });
  }
};


export const updateAssignment = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res
        .status(400)
        .json({ status: "error", message: "Invalid ID provided." });
    }

    const { name, cleaner_user_id, company_id, type_id, location_id, status } =
      req.body;

    const updatedAssignment = await prisma.cleaner_assignments.update({
      where: { id },
      data: {
        name,
        cleaner_user_id: cleaner_user_id
          ? parseInt(cleaner_user_id)
          : undefined,
        company_id: company_id ? parseInt(company_id) : undefined,
        type_id: type_id ? parseInt(type_id) : undefined,
        location_id: location_id ? parseInt(location_id) : undefined,
        status,
        updated_at: new Date(),
      },
    });

    res.status(200).json({
      status: "success",
      message: "Assignment updated successfully.",
      data: serializeBigInt(updatedAssignment),
    });
  } catch (error) {
    // Handle cases where the record to update doesn't exist
    if (error.code === "P2025") {
      return res
        .status(404)
        .json({ status: "error", message: "Assignment not found." });
    }
    console.error("Error updating assignment:", error);
    res.status(500).json({ status: "error", message: "Internal Server Error" });
  }
};

export const deleteAssignment = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res
        .status(400)
        .json({ status: "error", message: "Invalid ID provided." });
    }

    await prisma.cleaner_assignments.delete({
      where: { id },
    });

    res
      .status(200)
      .json({ status: "success", message: "Assignment deleted successfully." });
  } catch (error) {
    // Handle cases where the record to delete doesn't exist
    if (error.code === "P2025") {
      return res
        .status(404)
        .json({ status: "error", message: "Assignment not found." });
    }
    console.error("Error deleting assignment:", error);
    res.status(500).json({ status: "error", message: "Internal Server Error" });
  }
};

// export const createAssignmentsForLocation = async (req, res) => {
//   console.log("in create assignments for location", req.body);
//   try {
//     const { location_id, cleaner_user_ids, company_id, status, role_id } = req.body;
//     console.log(req.body, "req.body");
//     // --- Validation ---
//     if (
//       !location_id ||
//       !company_id ||
//       !cleaner_user_ids ||
//       !Array.isArray(cleaner_user_ids) ||
//       cleaner_user_ids.length === 0 ||
//       !role_id // ✅ Validate role_id
//     ) {
//       return res.status(400).json({
//         status: "error",
//         message:
//           "Missing required fields: location_id, company_id, and a non-empty array of cleaner_user_ids.",
//       });
//     }

//     // --- Fetch the location ---
//     const location = await prisma.locations.findUnique({
//       where: { id: BigInt(location_id) },
//       select: { id: true, name: true, type_id: true },
//     });

//     if (!location) {
//       return res.status(404).json({
//         status: "error",
//         message: "Location not found.",
//       });
//     }

//     // ✅ Check for existing assignments
//     const existingAssignments = await prisma.cleaner_assignments.findMany({
//       where: {
//         location_id: BigInt(location_id),
//         cleaner_user_id: { in: cleaner_user_ids.map((id) => BigInt(id)) },
//         company_id: BigInt(company_id),
//       },
//       select: { cleaner_user_id: true },
//     });

//     const existingCleanerIds = existingAssignments.map((a) => a.cleaner_user_id.toString());

//     // Filter out cleaners who are already assigned
//     const cleanersToAssign = cleaner_user_ids.filter(
//       (cleanerId) => !existingCleanerIds.includes(cleanerId.toString())
//     );

//     if (cleanersToAssign.length === 0) {
//       return res.status(400).json({
//         status: "error",
//         message: "All selected cleaners are already assigned to this location.",
//         existingAssignments: existingCleanerIds,
//       });
//     }

//     // Prepare assignments for new cleaners only
//     const assignmentsToCreate = cleanersToAssign.map((cleanerId) => ({
//       name: location.name,
//       cleaner_user_id: BigInt(cleanerId),
//       company_id: BigInt(company_id),
//       type_id: location.type_id,
//       location_id: location.id,
//       role_id: role_id, // ✅ Store role_id
//       status: status || "assigned",
//     }));

//     // --- Bulk insert ---
//     const result = await prisma.cleaner_assignments.createMany({
//       data: assignmentsToCreate,
//     });

//     // Prepare response message
//     const skippedCount = cleaner_user_ids.length - cleanersToAssign.length;
//     let message = `${result.count} cleaner(s) assigned successfully.`;

//     if (skippedCount > 0) {
//       message += ` ${skippedCount} cleaner(s) skipped (already assigned).`;
//     }

//     res.status(201).json({
//       status: "success",
//       message: message,
//       data: {
//         created: result.count,
//         skipped: skippedCount,
//         skippedCleanerIds: existingCleanerIds,
//       },
//     });
//   } catch (error) {
//     console.error("Error creating assignments for location:", error);
//     res.status(500).json({
//       status: "error",
//       message: "Internal Server Error",
//       detail: process.env.NODE_ENV === 'development' ? error.message : undefined
//     });
//   }
// };

export const createAssignmentsForLocation = async (req, res) => {
  try {
    const { location_id, cleaner_user_ids, company_id, status, role_id } = req.body;
    const caller = req.user;
    
    // --- 1. Validation ---
    if (!location_id || !company_id || !cleaner_user_ids || !Array.isArray(cleaner_user_ids) || cleaner_user_ids.length === 0 || !role_id) {
      return res.status(400).json({ status: "error", message: "Missing required fields." });
    }

    const parsedRoleId = parseInt(role_id);

    // --- 2. 🚨 SECURITY AUTHORIZATION CHECK 🚨 ---
    if (caller.role_id !== 1 && caller.role_id !== 2) {
      const callerAllowedBigInts = await RBACFilterService.getAuthorizedLocationIds(caller.id, caller.company_id);
      const callerAllowedIds = callerAllowedBigInts.map(id => id.toString());

      if (!callerAllowedIds.includes(location_id.toString())) {
        return res.status(403).json({
          status: "error",
          message: "Forbidden: You are trying to assign users to a location you do not manage."
        });
      }
    }
    // --- END SECURITY CHECK ---

    const location = await prisma.locations.findUnique({
      where: { id: BigInt(location_id) },
      select: { id: true, name: true },
    });

    if (!location) {
      return res.status(404).json({ status: "error", message: "Location not found." });
    }

    const existingAssignments = await prisma.cleaner_assignments.findMany({
      where: {
        location_id: BigInt(location_id),
        cleaner_user_id: { in: cleaner_user_ids.map((id) => BigInt(id)) },
        company_id: BigInt(company_id),
      },
      select: { cleaner_user_id: true },
    });

    const existingCleanerIds = existingAssignments.map((a) => a.cleaner_user_id.toString());
    const cleanersToAssign = cleaner_user_ids.filter((id) => !existingCleanerIds.includes(id.toString()));

    if (cleanersToAssign.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "All selected users are already assigned to this location.",
        existingAssignments: existingCleanerIds,
      });
    }

    const assignmentsToCreate = cleanersToAssign.map((cleanerId) => ({
      name: location.name,
      cleaner_user_id: BigInt(cleanerId),
      company_id: BigInt(company_id),
      type_id: null, 
      location_id: location.id,
      role_id: parsedRoleId,
      status: status || "assigned",
      // supervisor_id: BigInt(caller.id) // Optional tracking
    }));

    const result = await prisma.cleaner_assignments.createMany({ data: assignmentsToCreate });

    const skippedCount = cleaner_user_ids.length - cleanersToAssign.length;
    let message = `${result.count} user(s) assigned successfully.`;
    if (skippedCount > 0) message += ` ${skippedCount} user(s) skipped (already assigned).`;

    res.status(201).json({
      status: "success",
      message: message,
      data: { created: result.count, skipped: skippedCount, skippedCleanerIds: existingCleanerIds },
    });
  } catch (error) {
    console.error("Error creating assignments for location:", error);
    res.status(500).json({ status: "error", message: "Internal Server Error" });
  }
};

export const getAssignmentsByLocation = async (req, res) => {
  try {
    const { location_id } = req.params;
    const { company_id, role_id } = req.query;

    console.log('Fetching assignments for location:', location_id);
    console.log(req.query, "query");

    if (!location_id) {
      return res.status(400).json({
        status: "error",
        message: "Location ID is required"
      });
    }

    // Build where clause
    const whereClause = {
      location_id: BigInt(location_id)
    };



    if (company_id) {
      whereClause.company_id = BigInt(company_id);
    }

    if (role_id) {
      whereClause.role_id = parseInt(role_id)
    }

    // Fetch assignments with user details
    const assignments = await prisma.cleaner_assignments.findMany({
      where: whereClause,
      include: {
        cleaner_user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            age: true,
            created_at: true,
            role: {
              select: {
                id: true,
                name: true,
                description: true
              }
            }
          }
        },
        // supervisor: {
        //   select: {
        //     id: true,
        //     name: true,
        //     email: true,
        //     phone: true
        //   }
        // },
        locations: {
          select: {
            id: true,
            name: true,
            address: true,
            city: true,
            state: true
          }
        }
      },
      orderBy: { assigned_on: 'desc' }
    });


    // Serialize BigInt
    const serializedAssignments = assignments.map(assignment => ({
      ...assignment,
      id: assignment.id.toString(),
      cleaner_user_id: assignment.cleaner_user_id.toString(),
      company_id: assignment.company_id.toString(),
      type_id: assignment.type_id?.toString(),
      location_id: assignment.location_id?.toString(),
      supervisor_id: assignment.supervisor_id?.toString(),
      cleaner_user: assignment.cleaner_user ? {
        ...assignment.cleaner_user,
        id: assignment.cleaner_user.id.toString()
      } : null,
      // supervisor: assignment.supervisor ? {
      //   ...assignment.supervisor,
      //   id: assignment.supervisor.id.toString()
      // } : null,
      locations: assignment.locations ? {
        ...assignment.locations,
        id: assignment.locations.id.toString()
      } : null
    }));

    res.status(200).json({
      status: "success",
      message: "Assignments retrieved successfully",
      data: serializedAssignments
    });

  } catch (error) {
    console.error("Error fetching assignments by location:", error);
    res.status(500).json({
      status: "error",
      message: "Internal Server Error",
      detail: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};



// In your assignments controller
export const getAssignmentsByCleanerId = async (req, res) => {
  console.log('hit the get assignemnt by cleaner id ')
  try {
    const { cleaner_user_id } = req.params;
    const { company_id, include_all_statuses } = req.query; // Add include_all_statuses
    console.log("cleaner_user_id", cleaner_user_id);
    console.log("company_id", company_id);
    console.log("include_all_statuses", include_all_statuses);

    if (!cleaner_user_id) {
      return res.status(400).json({
        status: "error",
        message: "Cleaner user ID is required"
      });
    }

    const whereClause = {
      cleaner_user_id: BigInt(cleaner_user_id)
    };

    if (company_id) {
      whereClause.company_id = BigInt(company_id);
    }

    // By default, only show assigned locations
    // Unless explicitly requested to include all statuses
    if (include_all_statuses !== 'true') {
      whereClause.status = 'assigned';
    }

    const assignments = await prisma.cleaner_assignments.findMany({
      where: whereClause,
      include: {
        locations: {
          select: {
            id: true,
            name: true,
            address: true,
            city: true,
            state: true,
            latitude: true,
            longitude: true
          }
        },
        supervisor: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true
          }
        }
      },
      orderBy: { assigned_on: 'desc' }
    });

    const serialized = assignments.map(a => ({
      ...a,
      id: a.id.toString(),
      cleaner_user_id: a.cleaner_user_id.toString(),
      company_id: a.company_id.toString(),
      type_id: a.type_id?.toString(),
      location_id: a.location_id?.toString(),
      supervisor_id: a.supervisor_id?.toString(),
      locations: a.locations ? {
        ...a.locations,
        id: a.locations.id.toString()
      } : null,
      supervisor: a.supervisor ? {
        ...a.supervisor,
        id: a.supervisor.id.toString()
      } : null
    }));

    res.status(200).json({
      status: "success",
      data: serialized
    });

  } catch (error) {
    console.error("Error fetching assignments by cleaner:", error);
    res.status(500).json({
      status: "error",
      message: "Internal Server Error"
    });
  }
};

