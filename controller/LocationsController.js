import prisma from "../config/prismaClient.mjs";
import db from "../db.js";
// import RBACFilterService from "../services/rbacFilterService.js";
import RBACFilterService from "../utils/rbacFilterService.js";

// export const getAllToilets = async (req, res) => {
//   // console.log("get all toilets");
//   try {
//     // STEP 1: Get user from JWT (already set by verifyToken middleware)
//     const user = req.user;
//     if (!user) {
//       return res.status(401).json({ message: "Unauthorized" });
//     }

//     // console.log("User from JWT:", user);  // { id, role_id, company_id, email }

//     const { company_id, type_id, include_unavailable } = req.query;

//     // STEP 2: Build base where clause from query params
//     const whereClause = {};

//     // STEP 3: Get role-based filter (automatic based on user's role)
//     const roleFilter = await RBACFilterService.getLocationFilter(user);

//     // console.log(roleFilter, "filters data")
//     // STEP 4: Merge role filter into where clause
//     Object.assign(whereClause, roleFilter);

//     // STEP 5: Add company filter (only if super admin overrides, otherwise use role filter)
//     if (user.role_id === 1 && company_id) {
//       // console.log('inside user role id')
//       // Super admin can override company filter
//       whereClause.company_id = BigInt(company_id);
//     } else if (user.role_id === 2 && company_id) {
//       whereClause.company_id = BigInt(company_id);
//     }
//     // else if (!roleFilter.company_id && user.company_id) {
//     //   // If role filter doesn't set company, add user's company
//     //   whereClause.company_id = user.company_id;
//     // }
//     else {
//       whereClause.company_id = company_id;
//     }

//     // console.log(whereClause, "where clause")

//     // STEP 6: Add type filter from query
//     if (type_id) {
//       whereClause.type_id = BigInt(type_id);
//     }

//     // STEP 7: Add status filter
//     if (include_unavailable !== "true") {
//       whereClause.OR = [{ status: true }, { status: null }];
//     }

//     // console.log("Final where clause:", whereClause);

//     const today = new Date();
//     const startOfDay = new Date(
//       today.getFullYear(),
//       today.getMonth(),
//       today.getDate(),
//       0,
//       0,
//       0,
//       0,
//     );
//     const endOfDay = new Date(
//       today.getFullYear(),
//       today.getMonth(),
//       today.getDate(),
//       23,
//       59,
//       59,
//       999,
//     );

//     // STEP 8: Query database with merged filters
//     const allLocations = await prisma.locations.findMany({
//       where: Object.keys(whereClause).length ? whereClause : undefined,
//       include: {
//         hygiene_scores: {
//           where: {
//             created_at: {
//               gte: startOfDay,
//               lte: endOfDay,
//             },
//           },
//           select: {
//             score: true,
//             created_at: true,
//           },
//           orderBy: {
//             created_at: "desc",
//           },
//           take: 1, // Get only the most recent score from today
//         },
//         cleaner_reviews: {
//           select: {
//             score: true,
//           },
//         },
//         location_types: {
//           select: {
//             id: true,
//             name: true,
//           },
//         },
//         facility_companies: {
//           select: {
//             id: true,
//             name: true,
//           },
//         },

//         cleaner_assignments: {
//           where: {
//             deleted_at: null,
//             cleaner_user: {
//               role_id: 5, // Only cleaners
//             },
//           },
//           select: {
//             id: true,
//             status: true,
//             assigned_on: true,
//             cleaner_user: {
//               select: {
//                 id: true,
//                 name: true,
//                 email: true,
//                 phone: true,
//               },
//             },
//           },
//           orderBy: {
//             assigned_on: "desc",
//           },
//         },
//       },
//       orderBy: {
//         created_at: "desc",
//       },
//       // take: 4
//     });

//     // console.log("Fetched locations count:", allLocations);
//     // console.dir(allLocations[3], { depth: null });

//     // console.dir("all locations", { depth: null });
//     // STEP 9: Format response (SAME as before)

//     const result = allLocations.map((loc) => {
//       const hygieneScores = loc.cleaner_reviews.map((hs) => Number(hs.score));
//       const ratingCount = hygieneScores.length;

//       let averageRating = null;
//       if (ratingCount > 0) {
//         const sumOfScores = hygieneScores.reduce(
//           (sum, score) => sum + score,
//           0,
//         );
//         averageRating = sumOfScores / ratingCount;
//       }

//       const currentScore =
//         loc.hygiene_scores.length > 0
//           ? Number(loc.hygiene_scores[0].score)
//           : null;

//       //   const hygieneScores = loc.hygiene_scores.map(hs => Number(hs.score));
//       // const ratingCount = hygieneScores.length;

//       // let averageRating = null;
//       // if (ratingCount > 0) {
//       //   const sumOfScores = hygieneScores.reduce((sum, score) => sum + score, 0);
//       //   averageRating = sumOfScores / ratingCount;
//       // }

//       // return {
//       //   ...loc,
//       //   id: loc.id.toString(),
//       //   parent_id: loc.parent_id?.toString() || null,
//       //   company_id: loc.company_id?.toString() || null,
//       //   type_id: loc.type_id?.toString() || null,
//       //   facility_company_id: loc?.facility_company_id?.toString() || null,
//       //   images: loc.images || [],
//       //   averageRating: averageRating ? parseFloat(averageRating.toFixed(2)) : null,
//       //   ratingCount,
//       //   hygiene_scores: undefined,
//       //   location_types: {
//       //     ...loc.location_types,
//       //     id: loc?.location_types?.toString()
//       //   }
//       // };

//       return {
//         ...loc,
//         id: loc.id.toString(),
//         parent_id: loc.parent_id?.toString() || null,
//         company_id: loc.company_id?.toString() || null,
//         type_id: loc.type_id?.toString() || null,
//         facility_company_id: loc?.facility_company_id?.toString() || null,
//         images: loc.images || [],
//         averageRating: averageRating
//           ? parseFloat(averageRating.toFixed(2))
//           : null,
//         ratingCount,
//         currentScore: currentScore,
//         hygiene_scores: undefined,
//         location_types: {
//           ...loc.location_types,
//           id: loc?.location_types?.id?.toString(),
//         },
//         facility_companies: loc.facility_companies
//           ? {
//             ...loc.facility_companies,
//             id: loc.facility_companies.id.toString(),
//           }
//           : null,
//         cleaner_assignments: loc.cleaner_assignments.map((assignment) => ({
//           ...assignment,
//           id: assignment.id.toString(),
//           cleaner_user: {
//             ...assignment.cleaner_user,
//             id: assignment.cleaner_user.id.toString(),
//           },
//         })),
//       };
//     });

//     // console.log(" Get all Result count:", result.length);
//     res.json(result); // ← Response format unchanged
//   } catch (err) {
//     console.error(err);
//     res.status(500).send("Error fetching toilet locations");
//   }
// };

const validateAndFormatSchedule = (scheduleInput) => {
  if (!scheduleInput) return null;

  let schedule = scheduleInput;

  // If coming as string (multipart form-data case)
  if (typeof scheduleInput === "string") {
    try {
      schedule = JSON.parse(scheduleInput);
    } catch (err) {
      throw new Error("Invalid schedule JSON format");
    }
  }

  if (!schedule.mode) {
    throw new Error("Schedule mode is required");
  }

  // ✅ 24 HOURS
  if (schedule.mode === "TWENTY_FOUR_HOURS") {
    return {
      mode: "TWENTY_FOUR_HOURS",
    };
  }

  // ✅ FIXED HOURS
  if (schedule.mode === "FIXED_HOURS") {
    if (!schedule.opens_at || !schedule.closes_at) {
      throw new Error("opens_at and closes_at are required for FIXED_HOURS");
    }

    return {
      mode: "FIXED_HOURS",
      opens_at: schedule.opens_at,
      closes_at: schedule.closes_at,
      overnight: schedule.overnight || false,
    };
  }

  // ✅ DAY WISE
  if (schedule.mode === "DAY_WISE") {
    if (!schedule.days || typeof schedule.days !== "object") {
      throw new Error("Days object required for DAY_WISE schedule");
    }

    const validDays = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ];

    const formattedDays = {};

    for (const day of validDays) {
      const dayData = schedule.days[day];

      if (!dayData || dayData.open === false) {
        formattedDays[day] = {
          open: false,
          opens_at: "",
          closes_at: "",
          overnight: false,
        };
      } else {
        if (!dayData.opens_at || !dayData.closes_at) {
          throw new Error(`${day} must have opens_at and closes_at`);
        }

        formattedDays[day] = {
          open: true,
          opens_at: dayData.opens_at,
          closes_at: dayData.closes_at,
          overnight: dayData.overnight || false,
        };
      }
    }

    return {
      mode: "DAY_WISE",
      days: formattedDays,
    };
  }

  throw new Error("Invalid schedule mode");
};

// const validateAndFormatSchedule = (scheduleInput) => {
//   if (!scheduleInput) return null;

//   let schedule = scheduleInput;

//   // If coming as string (multipart form-data case)
//   if (typeof scheduleInput === "string") {
//     try {
//       schedule = JSON.parse(scheduleInput);
//     } catch (err) {
//       throw new Error("Invalid schedule JSON format");
//     }
//   }

//   if (!schedule.type) {
//     throw new Error("Schedule type is required");
//   }

//   // ✅ 24 HOURS
//   if (schedule.type === "24H") {
//     return { type: "24H" };
//   }

//   // ✅ FIXED HOURS
//   if (schedule.type === "FIXED") {
//     if (!schedule.openTime || !schedule.closeTime) {
//       throw new Error("openTime and closeTime are required for FIXED schedule");
//     }

//     return {
//       type: "FIXED",
//       openTime: schedule.openTime,
//       closeTime: schedule.closeTime,
//     };
//   }

//   // ✅ DAY WISE
//   if (schedule.type === "DAY_WISE") {
//     if (!schedule.days || typeof schedule.days !== "object") {
//       throw new Error("Days object required for DAY_WISE schedule");
//     }

//     const validDays = [
//       "monday",
//       "tuesday",
//       "wednesday",
//       "thursday",
//       "friday",
//       "saturday",
//       "sunday",
//     ];

//     const formattedDays = {};

//     for (const day of validDays) {
//       const dayData = schedule.days[day];

//       if (!dayData || dayData.enabled === false) {
//         formattedDays[day] = { enabled: false };
//       } else {
//         if (!dayData.openTime || !dayData.closeTime) {
//           throw new Error(`${day} must have openTime and closeTime`);
//         }

//         formattedDays[day] = {
//           enabled: true,
//           openTime: dayData.openTime,
//           closeTime: dayData.closeTime,
//         };
//       }
//     }

//     return {
//       type: "DAY_WISE",
//       days: formattedDays,
//     };
//   }

//   throw new Error("Invalid schedule type");
// };

// export const getAllToilets = async (req, res) => {
//   // console.log("get all toilets");
//   try {
//     const user = req.user;
//     if (!user) {
//       return res.status(401).json({ message: "Unauthorized" });
//     }

//     // --- NEW: EXTRACT PAGINATION PARAMS ---
//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 15;
//     const skip = (page - 1) * limit;
//     // --------------------------------------

//     const { company_id, type_id, include_unavailable } = req.query;

//     const whereClause = {};
//     const roleFilter = await RBACFilterService.getLocationFilter(user);

//     Object.assign(whereClause, roleFilter);

//     if (user.role_id === 1 && company_id) {
//       whereClause.company_id = BigInt(company_id);
//     } else if (user.role_id === 2 && company_id) {
//       whereClause.company_id = BigInt(company_id);
//     } else {
//       whereClause.company_id = company_id;
//     }

//     if (type_id) {
//       whereClause.type_id = BigInt(type_id);
//     }

//     if (include_unavailable !== "true") {
//       whereClause.OR = [{ status: true }, { status: null }];
//     }

//     // --- YOUR EXACT ORIGINAL DATE LOGIC ---
//     const today = new Date();
//     const startOfDay = new Date(
//       today.getFullYear(),
//       today.getMonth(),
//       today.getDate(),
//       0,
//       0,
//       0,
//       0,
//     );
//     const endOfDay = new Date(
//       today.getFullYear(),
//       today.getMonth(),
//       today.getDate(),
//       23,
//       59,
//       59,
//       999,
//     );
//     // --------------------------------------

//     // --- NEW: GET TOTAL COUNT BEFORE FETCHING DATA ---
//     const totalRecords = await prisma.locations.count({
//       where: Object.keys(whereClause).length ? whereClause : undefined,
//     });
//     // -------------------------------------------------

//     const allLocations = await prisma.locations.findMany({
//       where: Object.keys(whereClause).length ? whereClause : undefined,

//       // --- NEW: ADD SKIP AND TAKE TO PRISMA QUERY ---
//       skip: skip,
//       take: limit,
//       // ----------------------------------------------

//       include: {
//         hygiene_scores: {
//           where: {
//             created_at: {
//               gte: startOfDay,
//               lte: endOfDay,
//             },
//           },
//           select: {
//             score: true,
//             created_at: true,
//           },
//           orderBy: {
//             created_at: "desc",
//           },
//           take: 1,
//         },
//         cleaner_reviews: {
//           select: {
//             score: true,
//           },
//         },
//         location_types: {
//           select: {
//             id: true,
//             name: true,
//           },
//         },
//         facility_companies: {
//           select: {
//             id: true,
//             name: true,
//           },
//         },

//         cleaner_assignments: {
//           where: {
//             deleted_at: null,
//             cleaner_user: {
//               role_id: 5, // Only cleaners
//             },
//           },
//           select: {
//             id: true,
//             status: true,
//             assigned_on: true,
//             cleaner_user: {
//               select: {
//                 id: true,
//                 name: true,
//                 email: true,
//                 phone: true,
//               },
//             },
//           },
//           orderBy: {
//             assigned_on: "desc",
//           },
//         },
//       },
//       orderBy: {
//         created_at: "desc",
//       },
//     });

//     // --- YOUR EXACT ORIGINAL MAPPING LOGIC ---
//     const result = allLocations.map((loc) => {
//       const hygieneScores = loc.cleaner_reviews.map((hs) => Number(hs.score));
//       const ratingCount = hygieneScores.length;

//       let averageRating = null;
//       if (ratingCount > 0) {
//         const sumOfScores = hygieneScores.reduce(
//           (sum, score) => sum + score,
//           0,
//         );
//         averageRating = sumOfScores / ratingCount;
//       }

//       const currentScore =
//         loc.hygiene_scores.length > 0
//           ? Number(loc.hygiene_scores[0].score)
//           : null;

//       return {
//         ...loc,
//         id: loc.id.toString(),
//         parent_id: loc.parent_id?.toString() || null,
//         company_id: loc.company_id?.toString() || null,
//         type_id: loc.type_id?.toString() || null,
//         facility_company_id: loc?.facility_company_id?.toString() || null,
//         images: loc.images || [],
//         averageRating: averageRating
//           ? parseFloat(averageRating.toFixed(2))
//           : null,
//         ratingCount,
//         currentScore: currentScore,
//         hygiene_scores: undefined,
//         location_types: {
//           ...loc.location_types,
//           id: loc?.location_types?.id?.toString(),
//         },
//         facility_companies: loc.facility_companies
//           ? {
//             ...loc.facility_companies,
//             id: loc.facility_companies.id.toString(),
//           }
//           : null,
//         cleaner_assignments: loc.cleaner_assignments.map((assignment) => ({
//           ...assignment,
//           id: assignment.id.toString(),
//           cleaner_user: {
//             ...assignment.cleaner_user,
//             id: assignment.cleaner_user.id.toString(),
//           },
//         })),
//       };
//     });
//     // -----------------------------------------

//     // --- NEW: RETURN BOTH DATA AND PAGINATION METADATA ---
//     res.json({
//       data: result,
//       pagination: {
//         total: totalRecords,
//         page: page,
//         limit: limit,
//         last_page: Math.ceil(totalRecords / limit) || 1
//       }
//     });
//     // -----------------------------------------------------

//   } catch (err) {
//     console.error(err);
//     res.status(500).send("Error fetching toilet locations");
//   }
// };

export const getMapToilets = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Unauthorized" });

    const { company_id, type_id } = req.query;
    const whereClause = await RBACFilterService.getLocationFilter(user);

    // Apply filters
    if (company_id) whereClause.company_id = BigInt(company_id);
    if (type_id) whereClause.type_id = BigInt(type_id);
    whereClause.deleted_at = null;
    whereClause.OR = [{ status: true }, { status: null }];

    // Highly optimized query - ONLY selecting fields needed for the Map/Popup
    const locations = await prisma.locations.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        latitude: true,
        longitude: true,
        images: true,
        options: true, // Assuming this contains amenities like isPaid, is24Hours, etc.
        cleaner_reviews: { select: { score: true } }, // Used for average rating
        created_at: true,
      },
    });

    // Minimal transformation for speed
    const result = locations.map((loc) => {
      const scores = loc.cleaner_reviews.map((r) => Number(r.score));
      const avg =
        scores.length > 0
          ? scores.reduce((a, b) => a + b, 0) / scores.length
          : 0;

      return {
        id: loc.id.toString(),
        name: loc.name,
        latitude: loc.latitude,
        longitude: loc.longitude,
        images: loc.images || [],
        options: loc.options || {},
        averageRating: parseFloat(avg.toFixed(1)),
        ratingCount: scores.length,
        created_at: loc.created_at,
      };
    });

    res.status(200).json(result);
  } catch (err) {
    console.error("Map fetch error:", err);
    res.status(500).send("Error fetching map data");
  }
};

// export const getAllToilets = async (req, res) => {
//   try {
//     const user = req.user;
//     if (!user) {
//       return res.status(401).json({ message: "Unauthorized" });
//     }

//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 15;
//     const skip = (page - 1) * limit;

//     const { company_id, type_id, include_unavailable } = req.query;

//     const whereClause = {};
//     const roleFilter = await RBACFilterService.getLocationFilter(user);
//     Object.assign(whereClause, roleFilter);

//     if (user.role_id === 1 && company_id) {
//       whereClause.company_id = BigInt(company_id);
//     } else if (user.role_id === 2 && company_id) {
//       whereClause.company_id = BigInt(company_id);
//     } else {
//       whereClause.company_id = company_id;
//     }

//     if (type_id) {
//       whereClause.type_id = BigInt(type_id);
//     }

//     if (include_unavailable !== "true") {
//       whereClause.OR = [{ status: true }, { status: null }];
//     }

//     whereClause.deleted_at = null;

//     const today = new Date();
//     const startOfDay = new Date(
//       today.getFullYear(),
//       today.getMonth(),
//       today.getDate(),
//       0,
//       0,
//       0,
//       0,
//     );
//     const endOfDay = new Date(
//       today.getFullYear(),
//       today.getMonth(),
//       today.getDate(),
//       23,
//       59,
//       59,
//       999,
//     );

//     const totalRecords = await prisma.locations.count({
//       where: Object.keys(whereClause).length ? whereClause : undefined,
//     });

//     // --- HIGHLY OPTIMIZED PRISMA QUERY ---
//     const allLocations = await prisma.locations.findMany({
//       where: Object.keys(whereClause).length ? whereClause : undefined,
//       skip: skip,
//       take: limit,

//       // Use 'select' instead of 'include' to strip out heavy unused columns
//       select: {
//         id: true,
//         name: true,
//         created_at: true,
//         status: true,
//         latitude: true, // Needed for map button
//         longitude: true, // Needed for map button
//         type_id: true, // Needed for frontend filtering
//         facility_company_id: true, // Needed for frontend filtering

//         location_types: {
//           select: { id: true, name: true },
//         },
//         facility_companies: {
//           select: { id: true, name: true },
//         },
//         cleaner_reviews: {
//           select: { score: true },
//         },
//         hygiene_scores: {
//           where: {
//             created_at: { gte: startOfDay, lte: endOfDay },
//           },
//           select: { score: true },
//           orderBy: { created_at: "desc" },
//           take: 1,
//         },
//         cleaner_assignments: {
//           where: {
//             deleted_at: null,
//             cleaner_user: { role_id: 5 },
//           },
//           select: {
//             id: true,
//             // Only fetching the name, no need for phone/email on the list page
//             cleaner_user: {
//               select: { id: true, name: true },
//             },
//           },
//           orderBy: { assigned_on: "desc" },
//         },
//       },
//       orderBy: {
//         created_at: "desc",
//       },
//     });

//     // --- LEAN DATA MAPPING ---
//     const result = allLocations.map((loc) => {
//       // Calculate Average Rating
//       const hygieneScores = loc.cleaner_reviews.map((hs) => Number(hs.score));
//       const ratingCount = hygieneScores.length;
//       let averageRating = null;

//       if (ratingCount > 0) {
//         const sumOfScores = hygieneScores.reduce(
//           (sum, score) => sum + score,
//           0,
//         );
//         averageRating = sumOfScores / ratingCount;
//       }

//       // Get Current Score
//       const currentScore =
//         loc.hygiene_scores.length > 0
//           ? Number(loc.hygiene_scores[0].score)
//           : null;

//       // Return only what the UI needs
//       return {
//         id: loc.id.toString(),
//         name: loc.name,
//         created_at: loc.created_at,
//         status: loc.status,
//         latitude: loc.latitude,
//         longitude: loc.longitude,
//         type_id: loc.type_id?.toString() || null,
//         facility_company_id: loc.facility_company_id?.toString() || null,
//         averageRating: averageRating
//           ? parseFloat(averageRating.toFixed(2))
//           : null,
//         currentScore: currentScore,

//         location_types: loc.location_types
//           ? {
//               id: loc.location_types.id.toString(),
//               name: loc.location_types.name,
//             }
//           : null,

//         facility_companies: loc.facility_companies
//           ? {
//               id: loc.facility_companies.id.toString(),
//               name: loc.facility_companies.name,
//             }
//           : null,

//         cleaner_assignments: loc.cleaner_assignments.map((assignment) => ({
//           id: assignment.id.toString(),
//           cleaner_user: assignment.cleaner_user
//             ? {
//                 id: assignment.cleaner_user.id.toString(),
//                 name: assignment.cleaner_user.name,
//               }
//             : null,
//         })),
//       };
//     });

//     res.json({
//       data: result,
//       pagination: {
//         total: totalRecords,
//         page: page,
//         limit: limit,
//         last_page: Math.ceil(totalRecords / limit) || 1,
//       },
//     });
//   } catch (err) {
//     console.error(err);
//     res.status(500).send("Error fetching toilet locations");
//   }
// };


export const getAllToilets = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 15;
    const skip = (page - 1) * limit;

    const { company_id, type_id, include_unavailable } = req.query;

    const whereClause = {};
    
    // 1. Apply default RBAC filter
    // Note: Ensure your RBACFilterService isn't overriding this for Zonal Admins incorrectly
    const roleFilter = await RBACFilterService.getLocationFilter(user);
    if (roleFilter) {
      Object.assign(whereClause, roleFilter);
    }

    // =======================================================
    // 🔥 2. ZONAL ADMIN HIERARCHY FETCH (Based on type_id) 🔥
    // =======================================================
    if (user.role_id === 6) {
      // A. Find all zones explicitly assigned to this Zonal Admin
      const zonalAssignments = await prisma.cleaner_assignments.findMany({
        where: {
          cleaner_user_id: BigInt(user.id),
          status: 'assigned',
          type_id: { not: null }
        },
        select: { type_id: true }
      });

      const assignedZoneIds = zonalAssignments.map(a => a.type_id);

      // If they are not assigned to any zones, return an empty list immediately
      if (assignedZoneIds.length === 0) {
        return res.json({
          data: [],
          pagination: { total: 0, page, limit, last_page: 1 }
        });
      }

      // B. Find any sub-zones (Level 2) that belong to these assigned zones
      const subZones = await prisma.location_types.findMany({
        where: { parent_id: { in: assignedZoneIds } },
        select: { id: true }
      });

      // C. Combine Level 1 (Assigned) and Level 2 (Sub-zones)
      const allAllowedZoneIds = [...assignedZoneIds, ...subZones.map(z => z.id)];

      // D. Apply to whereClause
      if (type_id) {
        // If frontend requests a specific zone filter, verify they are allowed to see it
        const requestedIdBigInt = BigInt(type_id);
        const isAllowed = allAllowedZoneIds.some(id => id.toString() === requestedIdBigInt.toString());
        
        if (isAllowed) {
          whereClause.type_id = requestedIdBigInt;
        } else {
          // They requested a zone outside their jurisdiction
          return res.json({ data: [], pagination: { total: 0, page, limit, last_page: 1 } });
        }
      } else {
        // Show all washrooms matching ALL of their allowed zones
        whereClause.type_id = { in: allAllowedZoneIds };
      }
    } else {
      // For non-Zonal Admins, just apply the standard type_id filter if requested by the frontend
      if (type_id) {
        whereClause.type_id = BigInt(type_id);
      }
    }
    // =======================================================

    // 3. Apply Company Filters
    if (user.role_id === 1 && company_id) {
      whereClause.company_id = BigInt(company_id);
    } else if (user.role_id === 2 && company_id) {
      whereClause.company_id = BigInt(company_id);
    } else if (company_id) {
      whereClause.company_id = BigInt(company_id);
    }

    // 4. Apply Status Filters
    if (include_unavailable !== "true") {
      whereClause.OR = [{ status: true }, { status: null }];
    }

    whereClause.deleted_at = null;

    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

    const totalRecords = await prisma.locations.count({
      where: Object.keys(whereClause).length ? whereClause : undefined,
    });

    // --- HIGHLY OPTIMIZED PRISMA QUERY ---
    const allLocations = await prisma.locations.findMany({
      where: Object.keys(whereClause).length ? whereClause : undefined,
      skip: skip,
      take: limit,
      select: {
        id: true,
        name: true,
        created_at: true,
        status: true,
        latitude: true,
        longitude: true,
        type_id: true,
        facility_company_id: true,
        location_types: {
          select: { id: true, name: true },
        },
        facility_companies: {
          select: { id: true, name: true },
        },
        cleaner_reviews: {
          select: { score: true },
        },
        hygiene_scores: {
          where: {
            created_at: { gte: startOfDay, lte: endOfDay },
          },
          select: { score: true },
          orderBy: { created_at: "desc" },
          take: 1,
        },
        cleaner_assignments: {
          where: {
            deleted_at: null,
            cleaner_user: { role_id: 5 },
          },
          select: {
            id: true,
            cleaner_user: {
              select: { id: true, name: true },
            },
          },
          orderBy: { assigned_on: "desc" },
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    // --- LEAN DATA MAPPING ---
    const result = allLocations.map((loc) => {
      const hygieneScores = loc.cleaner_reviews.map((hs) => Number(hs.score));
      const ratingCount = hygieneScores.length;
      let averageRating = null;

      if (ratingCount > 0) {
        const sumOfScores = hygieneScores.reduce((sum, score) => sum + score, 0);
        averageRating = sumOfScores / ratingCount;
      }

      const currentScore = loc.hygiene_scores.length > 0 ? Number(loc.hygiene_scores[0].score) : null;

      return {
        id: loc.id.toString(),
        name: loc.name,
        created_at: loc.created_at,
        status: loc.status,
        latitude: loc.latitude,
        longitude: loc.longitude,
        type_id: loc.type_id?.toString() || null,
        facility_company_id: loc.facility_company_id?.toString() || null,
        averageRating: averageRating ? parseFloat(averageRating.toFixed(2)) : null,
        currentScore: currentScore,
        location_types: loc.location_types
          ? {
              id: loc.location_types.id.toString(),
              name: loc.location_types.name,
            }
          : null,
        facility_companies: loc.facility_companies
          ? {
              id: loc.facility_companies.id.toString(),
              name: loc.facility_companies.name,
            }
          : null,
        cleaner_assignments: loc.cleaner_assignments.map((assignment) => ({
          id: assignment.id.toString(),
          cleaner_user: assignment.cleaner_user
            ? {
                id: assignment.cleaner_user.id.toString(),
                name: assignment.cleaner_user.name,
              }
            : null,
        })),
      };
    });

    res.json({
      data: result,
      pagination: {
        total: totalRecords,
        page: page,
        limit: limit,
        last_page: Math.ceil(totalRecords / limit) || 1,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching toilet locations");
  }
};

export const toggleStatusToilet = async (req, res) => {
  const { id } = req.params;

  try {
    // Fetch toilet
    const toilet = await prisma.locations.findUnique({
      where: { id: BigInt(id) },
    });

    if (!toilet) {
      return res.status(404).json({
        status: "error",
        message: "Toilet not found for this id",
      });
    }

    const currentStatus = toilet.status ?? true;
    const newStatus = !currentStatus;

    const [updatedToilet] = await prisma.$transaction([
      // 1. Update toilet
      prisma.locations.update({
        where: { id: BigInt(id) },
        data: { status: newStatus },
      }),

      // 2. If disabling → make all assignments unassigned
      !newStatus
        ? prisma.cleaner_assignments.updateMany({
            where: {
              location_id: BigInt(id),
              deleted_at: null,
            },
            data: { status: "unassigned" },
          })
        : prisma.cleaner_assignments.findMany(), // dummy
    ]);

    console.log(updatedToilet, "updated toilet");
    return res.status(200).json({
      status: "success",
      message: `Status changed successfully to ${newStatus ? "active" : "disabled"}`,
      data: {
        ...updatedToilet,
        id: updatedToilet.id?.toString(),
        company_id: updatedToilet.company_id?.toString(),
        type_id: updatedToilet.type_id?.toString() ?? null,
        parent_id: updatedToilet.parent_id?.toString() ?? null,
        facility_company_id:
          updatedToilet?.facility_company_id?.toString() ?? null,
      },
    });
  } catch (err) {
    console.error("Error toggling toilet status:", err);
    res.status(500).json({
      status: "error",
      message: "Failed to toggle status",
      error:
        process.env.NODE_ENV === "development"
          ? err.message
          : "Internal server error",
    });
  }
};

export const getToiletById = async (req, res) => {
  console.log("get single toilet");
  try {
    let locId = req.params.id;
    const companyId = req.query.companyId;

    console.log(req.params, companyId, "ids");

    // ✅ CONFIGURATION FLAG - Change this to toggle rating calculation
    const INCLUDE_USER_REVIEWS_IN_RATING = false; // Set to true to include user reviews

    // Build where clause for security
    const whereClause = { id: Number(locId) };

    // Add company_id filter if provided for additional security
    if (companyId) {
      whereClause.company_id = Number(companyId);
    }

    const location = await prisma.locations.findUnique({
      where: whereClause,
      include: {
        hygiene_scores: {
          orderBy: { inspected_at: "desc" },
          select: {
            id: true,
            score: true,
            inspected_at: true,
            created_by: true,
          },
        },
        location_types: {
          select: {
            id: true,
            name: true,
          },
        },
        cleaner_assignments: {
          where: {
            status: {
              in: ["assigned", "active", "ongoing"],
            },
          },
          include: {
            cleaner_user: {
              select: {
                id: true,
                name: true,
                phone: true,
                email: true,
              },
            },
            role: true,
          },
          orderBy: { assigned_on: "desc" },
          take: 5,
        },
      },
    });

    // console.log(location, "locationd 3838");
    // console.log('single location', location)
    if (!location) {
      return res.status(404).json({ message: "Toilet not found" });
    }

    // console.log(location, 'locations 56');
    const reviews = await prisma.user_review_qr.findMany({
      where: { toilet_id: Number(locId) },
    });

    console.log(reviews, "reviews");
    const intReviews = reviews.map((item) => ({
      ...item,
      toilet_id: item.toilet_id?.toString() || null,
      id: item.id?.toString() || null,
    }));

    // console.log(intReviews, "int review")

    // ✅ UPDATED RATING CALCULATION - Same logic as getAllToilets
    const hygieneScores = location.hygiene_scores.map((hs) => Number(hs.score));
    const ratingCount = hygieneScores.length;

    let averageRating = null;

    if (INCLUDE_USER_REVIEWS_IN_RATING) {
      // 📊 OPTION 1: Include both hygiene scores + user reviews
      const userRatings = reviews.map((r) => r.rating).filter(Boolean);
      const allRatings = [...hygieneScores, ...userRatings];
      const totalCount = allRatings.length;

      if (totalCount > 0) {
        const sumOfScores = allRatings.reduce((sum, score) => sum + score, 0);
        averageRating = parseFloat((sumOfScores / totalCount).toFixed(2));
      }

      console.log(
        "Rating calculation: Including user reviews + hygiene scores",
      );
      console.log("Hygiene scores:", hygieneScores);
      console.log("User ratings:", userRatings);
      console.log("Combined average:", averageRating);
    } else {
      // 📊 OPTION 2: Hygiene scores only
      if (ratingCount > 0) {
        const sumOfScores = hygieneScores.reduce(
          (sum, score) => sum + score,
          0,
        );
        averageRating = parseFloat((sumOfScores / ratingCount).toFixed(2));
      }

      console.log("Rating calculation: Hygiene scores only");
      // console.log('Hygiene scores:', hygieneScores);
      // console.log('Average rating:', averageRating);
    }

    // ✅ Serialize all BigInt fields to strings
    // const result = {
    //   ...location,
    //   id: location.id?.toString() || null,
    //   parent_id: location.parent_id?.toString() || null,
    //   company_id: location.company_id?.toString() || null,
    //   type_id: location.type_id?.toString() || null,
    //   facility_company_id: location?.facility_company_id?.toString() || null,
    //   hygiene_scores: location.hygiene_scores.map(score => ({
    //     ...score,
    //     id: score.id?.toString() || null,
    //     created_by: score.created_by?.toString() || null,
    //   })),

    //   cleaner_assignments: location.cleaner_assignments.map(assignment => ({
    //     ...assignment,
    //     id: assignment.id?.toString() || null,
    //     cleaner_user_id: assignment.cleaner_user_id?.toString() || null,
    //     company_id: assignment.company_id?.toString() || null,
    //     type_id: assignment.type_id?.toString() || null,
    //     location_id: assignment.location_id?.toString() || null,
    //     supervisor_id: assignment.supervisor_id?.toString() || null,

    //     cleaner_user: assignment.cleaner_user ? {
    //       ...assignment.cleaner_user,
    //       id: assignment.cleaner_user.id?.toString() || null,
    //     } : null,

    //     supervisor: assignment.supervisor ? {
    //       ...assignment.supervisor,
    //       id: assignment.supervisor.id?.toString() || null,
    //     } : null,
    //   })),

    //   images: location.images || [],
    //   averageRating,
    //   ratingCount,
    //   ReviewData: intReviews,

    //   ratingSource: INCLUDE_USER_REVIEWS_IN_RATING
    //     ? 'hygiene_and_user_reviews'
    //     : 'hygiene_only',
    //   ratingScale: '1-10',

    //   assignedCleaners: location.cleaner_assignments.map(assignment => ({
    //     id: assignment.id?.toString() || null,
    //     name: assignment.name,
    //     status: assignment.status,
    //     assignedOn: assignment.assigned_on,
    //     releasedOn: assignment.released_on,
    //     createdAt: assignment.created_at,
    //     updatedAt: assignment.updated_at,
    //     cleaner: assignment.cleaner_user ? {
    //       id: assignment.cleaner_user.id?.toString() || null,
    //       name: assignment.cleaner_user.name,
    //       phone: assignment.cleaner_user.phone,
    //       email: assignment.cleaner_user.email,
    //     } : null,
    //     supervisor: assignment.supervisor ? {
    //       id: assignment.supervisor.id?.toString() || null,
    //       name: assignment.supervisor.name,
    //       phone: assignment.supervisor.phone,
    //       email: assignment.supervisor.email,
    //     } : null,
    //   }))
    // };

    const result = {
      ...location,
      hygiene_scores: location.hygiene_scores.map((score) => ({ ...score })),
      // cleaner_assignments: location.cleaner_assignments.map(assignment => ({ ...assignment })),
      images: location.images || [],
      averageRating,
      ratingCount,
      ReviewData: intReviews,
      ratingSource: INCLUDE_USER_REVIEWS_IN_RATING
        ? "hygiene_and_user_reviews"
        : "hygiene_only",
      ratingScale: "1-10",
      assignedCleaners: location.cleaner_assignments.map((assignment) => ({
        id: assignment.id,
        name: assignment.name,
        status: assignment.status,
        assignedOn: assignment.assigned_on,
        releasedOn: assignment.released_on,
        createdAt: assignment.created_at,
        updatedAt: assignment.updated_at,
        cleaner: assignment.cleaner_user
          ? { ...assignment.cleaner_user }
          : null,
        supervisor: assignment.supervisor ? { ...assignment.supervisor } : null,
      })),
    };

    // Use a custom replacer function in JSON.stringify
    const jsonString = JSON.stringify(result, (key, value) => {
      if (typeof value === "bigint") {
        return value.toString();
      }
      return value;
    });

    res.json(JSON.parse(jsonString));

    // console.log(result, 'result 34');
    // res.json(result);
  } catch (err) {
    console.error("Error in getToiletById:", err);
    res.status(500).json({
      success: false,
      error: "Error fetching toilet by ID",
      details: err.message,
    });
  }
};

export const getSearchToilet = async (req, res) => {
  try {
    const { search, company_id } = req.query;

    if (!search) {
      return res.status(400).json({
        success: false,
        message: "Search query is required",
      });
    }

    // Build where clause for security and search
    const whereClause = {
      name: {
        contains: search,
        mode: "insensitive",
      },
    };

    // Add company filter if provided
    if (company_id) {
      whereClause.company_id = Number(company_id);
    }

    const locations = await prisma.locations.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        latitude: true,
        longitude: true,
        images: true, // ✅ Include images in search results
        created_at: true,
      },
      orderBy: {
        name: "asc",
      },
      take: 20, // Limit results for performance
    });

    // Convert BigInt to string
    const result = locations.map((location) => ({
      ...location,
      id: location.id.toString(),
      images: location.images || [], // ✅ Ensure images is always array
    }));

    res.json(result);
  } catch (err) {
    console.error("Error searching locations:", err);
    res.status(500).json({
      success: false,
      error: "Error searching locations",
    });
  }
};

export const createLocation = async (req, res) => {
  console.log("in create location");

  try {
    const {
      name,
      parent_id,
      type_id,
      latitude,
      longitude,
      options,
      address,
      pincode,
      state,
      city,
      dist,
      status,
      facility_company_id,
      no_of_photos,
      usage_category,
      role_id,
      user_id,
      schedule,
      is_public,
    } = req.body;
    const { companyId } = req.query;

    const roleId = parseInt(role_id, 10) || null;

    // console.log("=== CREATE LOCATION DEBUG ===");
    // console.log("Company ID:", companyId);
    // console.log("Facility Company ID:", facility_company_id);
    // console.log("Raw body data:", req.body);
    // console.log("Usage Category:", usage_category);
    // console.log("Number of WC:", no_of_photos);

    // Get uploaded image URLs
    const imageUrls = req.uploadedFiles?.images || [];
    console.log("Uploaded images:", imageUrls);

    //     // Basic validation
    if (!name || !type_id) {
      return res.status(400).json({ error: "Name and typeId are required." });
    }

    // Handle options parsing
    let finalOptions = options ?? {};
    if (typeof options === "string") {
      if (options === "[object Object]" || options === "{}" || options === "") {
        finalOptions = {};
      } else {
        try {
          finalOptions = JSON.parse(options);
          console.log("Successfully parsed options:", finalOptions);
        } catch (e) {
          console.error("Failed to parse options:", e);
          finalOptions = {};
        }
      }
    }

    let finalUsageCategory = null;
    if (usage_category) {
      if (typeof usage_category === "string") {
        try {
          finalUsageCategory = JSON.parse(usage_category);
          console.log(
            "Successfully parsed usage_category:",
            finalUsageCategory,
          );
        } catch (e) {
          console.error("Failed to parse usage_category:", e);
          finalUsageCategory = null;
        }
      } else {
        finalUsageCategory = usage_category;
      }
    }
    // Parse coordinates
    const parsedLatitude =
      latitude && latitude !== "null" ? parseFloat(latitude) : null;
    const parsedLongitude =
      longitude && longitude !== "null" ? parseFloat(longitude) : null;

    const parsedNoOfPhotos =
      no_of_photos !== undefined && no_of_photos !== null && no_of_photos !== ""
        ? parseInt(no_of_photos, 10)
        : null;
    // Parse status
    const parsedStatus =
      status !== undefined && status !== null
        ? status === "true" || status === true
        : true;

    console.log("Parsed coordinates:", { parsedLatitude, parsedLongitude });

    // 🔥 Handle Schedule
    let finalSchedule = null;

    if (schedule !== undefined) {
      try {
        finalSchedule = validateAndFormatSchedule(schedule);
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }
    }

    // 🔥 Handle is_public
    const parsedIsPublic =
      is_public !== undefined
        ? is_public === "true" || is_public === true
        : true; // default true

    // ✅ BUILD DATA WITH RELATION SYNTAX
    const locationData = {
      name,
      latitude: parsedLatitude,
      longitude: parsedLongitude,
      metadata: {},
      options: finalOptions,
      usage_category: finalUsageCategory,
      images: imageUrls,
      address: address || null,
      pincode: pincode || null,
      state: state || null,
      city: city || null,
      dist: dist || null,
      status: parsedStatus,
      no_of_photos: parsedNoOfPhotos || null,
      schedule: finalSchedule,
      is_public: parsedIsPublic,
    };

    //  Add relations using connect syntax
    if (type_id) {
      locationData.location_types = {
        connect: { id: BigInt(type_id) },
      };
    }

    if (companyId) {
      locationData.companies = {
        connect: { id: BigInt(companyId) },
      };
    }

    if (parent_id) {
      locationData.locations = {
        connect: { id: BigInt(parent_id) },
      };
    }

    //  ADD FACILITY COMPANY RELATION
    if (facility_company_id) {
      locationData.facility_companies = {
        connect: { id: BigInt(facility_company_id) },
      };
    }

    console.log("=== FINAL DATA TO SAVE ===");
    // console.log("Created no_of_photos:", newLocation.no_of_photos); // ✅ VERIFY SAVED VALUE

    // console.log(JSON.stringify({
    //   ...locationData,
    //   location_types: locationData.location_types ? `connect to ID ${type_id}` : undefined,
    //   companies: locationData.companies ? `connect to ID ${companyId}` : undefined,
    //   locations: locationData.locations ? `connect to ID ${parent_id}` : undefined,
    //   facility_companies: locationData.facility_companies ? `connect to ID ${facility_company_id}` : undefined, // ✅ ADD THIS
    // }, null, 2));

    // ✅ Insert into DB with include to get the relations back
    const newLocation = await prisma.locations.create({
      data: locationData,
      include: {
        location_types: true,
        companies: true,
        facility_companies: true, // ✅ ADD THIS
      },
    });

    console.log("=== LOCATION CREATED ===");
    // console.log("Created location:", newLocation);

    if (roleId === 8 && roleId !== null) {
      const add_location_assignments = await prisma.cleaner_assignments.create({
        data: {
          name: newLocation.name,
          cleaner_user_id: BigInt(user_id),
          company_id: BigInt(companyId),
          type_id: BigInt(type_id),
          location_id: newLocation?.id,
          role_id: roleId,
          status: "assigned",
          assigned_on: new Date(),
        },
      });
    }

    const serializedLocation = {
      ...newLocation,
      id: newLocation.id.toString(),
      parent_id: newLocation.parent_id?.toString() || null,
      type_id: newLocation.type_id?.toString() || null,
      company_id: newLocation.company_id?.toString() || null,
      facility_company_id: newLocation.facility_company_id?.toString() || null, // ✅ ADD THIS
      images: newLocation.images || [],
      location_types: newLocation.location_types
        ? {
            ...newLocation.location_types,
            id: newLocation.location_types.id.toString(),
            parent_id: newLocation.location_types.parent_id?.toString() || null,
            company_id:
              newLocation.location_types.company_id?.toString() || null,
          }
        : null,
      companies: newLocation.companies
        ? {
            ...newLocation.companies,
            id: newLocation.companies.id.toString(),
          }
        : null,
      facility_companies: newLocation.facility_companies
        ? {
            ...newLocation.facility_companies,
            id: newLocation.facility_companies.id.toString(),
            company_id:
              newLocation.facility_companies.company_id?.toString() || null,
          }
        : null,
    };

    res.status(201).json({
      success: true,
      message: "Location added successfully.",
      data: serializedLocation,
    });
  } catch (err) {
    console.error("Error creating location:", err);
    console.error("Error stack:", err.stack);
    res.status(500).json({ error: "Failed to create location." });
  }
};

export const updateLocationById = async (req, res) => {
  console.log("in update location");
  try {
    const locationId = req.params.id;
    const companyId = req.query.companyId;
    const updateData = req.body;

    console.log("Updating location:", locationId, "for company:", companyId);
    console.log("Update data received:", updateData);

    // Build where clause for security
    const whereClause = { id: Number(locationId) };

    // Add company_id filter if provided for additional security
    if (companyId) {
      whereClause.company_id = Number(companyId);
    }

    // Check if location exists and belongs to company
    const existingLocation = await prisma.locations.findUnique({
      where: whereClause,
    });

    if (!existingLocation) {
      return res.status(404).json({
        success: false,
        message: "Location not found or access denied",
      });
    }

    //  Get uploaded image URLs from middleware
    const newImageUrls = req.uploadedFiles?.images || [];
    console.log("New images uploaded:", newImageUrls);

    //  Handle image updates
    let finalImages = existingLocation.images || [];

    if (newImageUrls.length > 0) {
      // ✅ NEW: Intercept the cover image flag from the frontend
      if (
        updateData.isNewCoverIncluded === "true" ||
        updateData.isNewCoverIncluded === true
      ) {
        // Extract the very first uploaded image (which the frontend guaranteed is the cover)
        const newCoverUrl = newImageUrls.shift();

        // Construct the array: [New Cover] -> [All Existing Images] -> [New Gallery Images]
        finalImages = [newCoverUrl, ...finalImages, ...newImageUrls];
      } else {
        // Normal behavior: Just append new gallery photos to the end
        finalImages = [...finalImages, ...newImageUrls];
      }
    }
    //  If replace_images is true, replace all images
    if (
      updateData.replace_images === "true" ||
      updateData.replace_images === true
    ) {
      finalImages = newImageUrls;
    }

    const parsedNoOfPhotos =
      updateData.no_of_photos !== undefined &&
      updateData.no_of_photos !== null &&
      updateData.no_of_photos !== ""
        ? parseInt(updateData?.no_of_photos, 10)
        : null;
    //  Handle options properly (same as create)
    let finalOptions = existingLocation.options || {};

    if (updateData.options) {
      if (typeof updateData.options === "string") {
        console.log("Options is string, attempting to parse...");

        if (updateData.options === "[object Object]") {
          console.warn(
            "Received [object Object] string, keeping existing options",
          );
          finalOptions = existingLocation.options || {};
        } else if (updateData.options === "{}" || updateData.options === "") {
          console.log("Options is empty string or {}, using empty object");
          finalOptions = {};
        } else {
          try {
            finalOptions = JSON.parse(updateData.options);
            console.log("Successfully parsed options:", finalOptions);
          } catch (e) {
            console.error(
              "Failed to parse options string:",
              updateData.options,
              e,
            );
            finalOptions = existingLocation.options || {};
          }
        }
      } else if (
        typeof updateData.options === "object" &&
        updateData.options !== null
      ) {
        console.log("Options is already an object:", updateData.options);
        finalOptions = updateData.options;
      }
    }

    // console.log("Final options for update:", finalOptions);

    // ✅ Prepare update data with proper parsing
    // const dataToUpdate = {
    //   name: updateData.name || existingLocation.name,
    //   latitude: updateData.latitude && updateData.latitude !== 'null' ? parseFloat(updateData.latitude) : existingLocation.latitude,
    //   longitude: updateData.longitude && updateData.longitude !== 'null' ? parseFloat(updateData.longitude) : existingLocation.longitude,
    //   options: finalOptions, // ✅ Use processed options
    //   metadata: updateData.metadata || existingLocation.metadata,
    //   images: finalImages, // ✅ Now properly defined
    //   facility_company_id: updateData?.facility_company_id || existingLocation?.facility_company_id,
    //   no_of_photos: parsedNoOfPhotos || existingLocation?.no_of_photos
    // };

    let finalUsageCategory = existingLocation.usage_category || null;

    if (updateData.usage_category !== undefined) {
      if (
        updateData.usage_category === null ||
        updateData.usage_category === ""
      ) {
        console.log("Usage category is null or empty, setting to null");
        finalUsageCategory = null;
      } else if (typeof updateData.usage_category === "string") {
        console.log("Usage category is string, attempting to parse...");

        if (updateData.usage_category === "[object Object]") {
          console.warn(
            "Received [object Object] string, keeping existing usage_category",
          );
          finalUsageCategory = existingLocation.usage_category || null;
        } else if (updateData.usage_category === "{}") {
          console.log("Usage category is empty {}, setting to null");
          finalUsageCategory = null;
        } else {
          try {
            finalUsageCategory = JSON.parse(updateData.usage_category);
            console.log(
              "Successfully parsed usage_category:",
              finalUsageCategory,
            );
          } catch (e) {
            console.error(
              "Failed to parse usage_category string:",
              updateData.usage_category,
              e,
            );
            finalUsageCategory = existingLocation.usage_category || null;
          }
        }
      } else if (
        typeof updateData.usage_category === "object" &&
        updateData.usage_category !== null
      ) {
        console.log(
          "Usage category is already an object:",
          updateData.usage_category,
        );
        finalUsageCategory = updateData.usage_category;
      }
    }

    console.log("Final usage_category for update:", finalUsageCategory);

    let finalSchedule = existingLocation.schedule || null;

    if (updateData.schedule !== undefined) {
      try {
        if (updateData.schedule === null || updateData.schedule === "") {
          finalSchedule = null; // allow clearing schedule
        } else {
          finalSchedule = validateAndFormatSchedule(updateData.schedule);
        }
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }
    }

    let finalIsPublic = existingLocation.is_public;

    if (updateData.is_public !== undefined) {
      finalIsPublic =
        updateData.is_public === "true" || updateData.is_public === true;
    }

    const dataToUpdate = {
      name: updateData.name || existingLocation.name,
      latitude:
        updateData.latitude && updateData.latitude !== "null"
          ? parseFloat(updateData.latitude)
          : existingLocation.latitude,
      longitude:
        updateData.longitude && updateData.longitude !== "null"
          ? parseFloat(updateData.longitude)
          : existingLocation.longitude,
      type_id:
        updateData?.type_id !== undefined
          ? updateData.type_id
          : existingLocation.type_id,
      address:
        updateData.address !== undefined
          ? updateData.address
          : existingLocation.address,
      city:
        updateData.city !== undefined ? updateData.city : existingLocation.city,
      state:
        updateData.state !== undefined
          ? updateData.state
          : existingLocation.state,
      dist:
        updateData.dist !== undefined ? updateData.dist : existingLocation.dist,
      pincode:
        updateData.pincode !== undefined
          ? updateData.pincode
          : existingLocation.pincode,
      options: finalOptions,
      usage_category: finalUsageCategory,
      metadata: updateData.metadata || existingLocation.metadata,
      images: finalImages,
      facility_company_id:
        updateData?.facility_company_id ||
        existingLocation?.facility_company_id,
      no_of_photos: parsedNoOfPhotos || existingLocation?.no_of_photos,
      schedule: finalSchedule,
      is_public: finalIsPublic,
    };

    // Update parent_id and type_id if provided
    if (updateData.parent_id) {
      dataToUpdate.parent_id = BigInt(updateData.parent_id);
    }
    if (updateData.type_id) {
      dataToUpdate.type_id = BigInt(updateData.type_id);
    }

    console.log("Final data to update:", {
      ...dataToUpdate,
      options: JSON.stringify(dataToUpdate.options),
      usage_category: JSON.stringify(dataToUpdate.usage_category),
      imagesCount: finalImages.length,
    });

    // Update the location
    const updatedLocation = await prisma.locations.update({
      where: { id: Number(locationId) },
      data: dataToUpdate,
    });

    // Convert BigInts to strings for response
    const result = {
      ...updatedLocation,
      id: updatedLocation.id.toString(),
      parent_id: updatedLocation.parent_id?.toString() || null,
      company_id: updatedLocation.company_id?.toString() || null,
      type_id: updatedLocation.type_id?.toString() || null,
      facility_company_id:
        updatedLocation?.facility_company_id?.toString() || null,
      images: updatedLocation.images || [],
      usage_category: updatedLocation.usage_category || null,
    };

    console.log(result, "result");
    res.json({
      success: true,
      message: "Location updated successfully",
      data: result,
    });
  } catch (err) {
    console.error("Error updating location:", err);
    res.status(500).json({
      success: false,
      error: "Failed to update location",
      details: err.message, // Add error details for debugging
    });
  }
};

export const deleteLocationImage = async (req, res) => {
  try {
    const locationId = req.params.id;
    const { imageUrl } = req.body;
    const companyId = req.query.companyId;

    if (!imageUrl) {
      return res.status(400).json({
        success: false,
        message: "Image URL is required",
      });
    }

    const whereClause = { id: Number(locationId) };
    if (companyId) {
      whereClause.company_id = Number(companyId);
    }

    const location = await prisma.locations.findUnique({
      where: whereClause,
    });

    if (!location) {
      return res.status(404).json({
        success: false,
        message: "Location not found or access denied",
      });
    }

    // Remove the specific image URL
    const updatedImages = (location.images || []).filter(
      (img) => img !== imageUrl,
    );

    const updatedLocation = await prisma.locations.update({
      where: { id: Number(locationId) },
      data: { images: updatedImages },
    });

    res.json({
      success: true,
      message: "Image deleted successfully",
      data: {
        id: updatedLocation.id.toString(),
        images: updatedLocation.images || [],
      },
    });
  } catch (err) {
    console.error("Error deleting location image:", err);
    res.status(500).json({
      success: false,
      error: "Failed to delete image",
    });
  }
};

export const deleteLocationById = async (req, res) => {
  console.log("in delete location");
  try {
    const locationId = req.params.id;
    const companyId = req.query.companyId;

    console.log("Deleting location:", locationId, "for company:", companyId);

    // Build where clause for security
    const whereClause = { id: BigInt(locationId) };

    console.log("Where clause before company filter:", whereClause);
    // Add company_id filter if provided for additional security
    if (companyId) {
      whereClause.company_id = BigInt(companyId);
    }

    console.log("Final where clause for deletion:", whereClause);
    // Check if location exists and belongs to company
    const existingLocation = await prisma.locations.findUnique({
      where: whereClause,
    });

    console.log("Existing location:", existingLocation);
    if (!existingLocation) {
      console.log("Location not found or access denied");
      return res.status(404).json({
        success: false,
        message: "Location not found or access denied",
      });
    }

    console.log("Proceeding to delete location and related assignments");
    // Simply call delete - middleware handles soft delete automatically
    await prisma.$transaction([
      prisma.cleaner_assignments.deleteMany({
        where: { location_id: BigInt(locationId) },
      }),
      prisma.locations.delete({
        where: whereClause,
        data: { deleted_at: new Date() },
      }),
    ]);

    console.log("delete operation completed for location id:", locationId);
    res.json({
      success: true,
      message: "Location deleted successfully",
      data: {
        id: locationId,
        deleted: true,
      },
    });
  } catch (err) {
    console.error("Error deleting location:", err);
    res.status(500).json({
      success: false,
      error: "Failed to delete location",
      details: err.message,
    });
  }
};

export const getAllToiletsForWeb = async (req, res) => {
  // console.log("get all toilets");

  try {
    const { company_id, type_id, include_unavailable } = req.query;
    // console.log("req.query ", req.query);
    // STEP 1: Build where clause only from query params
    const whereClause = {
      is_public: true,
    };

    // STEP 2: Company filter
    if (company_id) {
      whereClause.company_id = BigInt(company_id);
    }

    // STEP 3: Type filter
    if (type_id) {
      whereClause.type_id = BigInt(type_id);
    }

    // STEP 4: Status filter
    if (include_unavailable !== "true") {
      whereClause.OR = [{ status: true }, { status: null }];
    }

    // console.log("Final where clause:", whereClause);

    // STEP 5: Today's date range
    const today = new Date();
    const startOfDay = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      0,
      0,
      0,
      0,
    );
    const endOfDay = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      23,
      59,
      59,
      999,
    );

    // STEP 6: Query database
    const allLocations = await prisma.locations.findMany({
      where: Object.keys(whereClause).length ? whereClause : undefined,
      include: {
        hygiene_scores: {
          where: {
            created_at: {
              gte: startOfDay,
              lte: endOfDay,
            },
          },
          select: {
            score: true,
            created_at: true,
          },
          orderBy: {
            created_at: "desc",
          },
          take: 1,
        },
        cleaner_reviews: {
          select: {
            score: true,
          },
        },
        location_types: {
          select: {
            id: true,
            name: true,
          },
        },
        facility_companies: {
          select: {
            id: true,
            name: true,
          },
        },
        cleaner_assignments: {
          where: {
            deleted_at: null,
            cleaner_user: {
              role_id: 5,
            },
          },
          select: {
            id: true,
            status: true,
            assigned_on: true,
            cleaner_user: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
              },
            },
          },
          orderBy: {
            assigned_on: "desc",
          },
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    // STEP 7: Format response
    const result = allLocations.map((loc) => {
      const hygieneScores = loc.cleaner_reviews.map((r) => Number(r.score));
      const ratingCount = hygieneScores.length;

      let averageRating = null;
      if (ratingCount > 0) {
        const sum = hygieneScores.reduce((a, b) => a + b, 0);
        averageRating = sum / ratingCount;
      }

      const currentScore =
        loc.hygiene_scores.length > 0
          ? Number(loc.hygiene_scores[0].score)
          : null;

      return {
        ...loc,
        id: loc.id.toString(),
        parent_id: loc.parent_id?.toString() || null,
        company_id: loc.company_id?.toString() || null,
        type_id: loc.type_id?.toString() || null,
        facility_company_id: loc?.facility_company_id?.toString() || null,
        images: loc.images || [],
        averageRating: averageRating
          ? parseFloat(averageRating.toFixed(2))
          : null,
        ratingCount,
        currentScore,
        hygiene_scores: undefined,
        location_types: loc.location_types
          ? {
              ...loc.location_types,
              id: loc.location_types.id.toString(),
            }
          : null,
        facility_companies: loc.facility_companies
          ? {
              ...loc.facility_companies,
              id: loc.facility_companies.id.toString(),
            }
          : null,
        cleaner_assignments: loc.cleaner_assignments.map((a) => ({
          ...a,
          id: a.id.toString(),
          cleaner_user: {
            ...a.cleaner_user,
            id: a.cleaner_user.id.toString(),
          },
        })),
      };
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching toilet locations");
  }
};

////////////////////// new get locations with zone apis /////////////////////

export const getNearbyLocations = async (req, res) => {
  const { lat, lng, radius } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: "Missing lat or lng" });
  }

  const userLat = parseFloat(lat);
  const userLng = parseFloat(lng);
  const distance = parseFloat(radius || 1000); // default 1000 meters

  try {
    const result = await db.query(
      `
    SELECT 
      id,
      name,
      ST_AsText(geom) AS geo_location,
      ST_Distance(
        geom::geography,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
      ) AS distance
    FROM locations
    WHERE ST_DWithin(
      geom::geography,
      ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
      $3
    )
    ORDER BY distance ASC
    LIMIT 50
  `,
      [parseFloat(lng), parseFloat(lat), parseInt(radius)],
    );

    // const updatedResults = result.map((item) => ({
    //   ...item,
    //   id:item.id.toString()
    // }));
    // console.log(result , "results");
    // res.json(updatedResults);
    console.log(result, "data");
    res.json(result);
  } catch (error) {
    console.error("Error fetching nearby locations:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getZonesWithToilets = async (req, res) => {
  console.log("old zones");
  try {
    // Fetch all zones (platforms or floors)
    const ZONE_TYPE_IDS = [
      BigInt(5),
      BigInt(7),
      BigInt(2),
      BigInt(3),
      BigInt(6),
      BigInt(11),
    ]; // Platform & Floor

    const zones = await prisma.locations.findMany({
      where: {
        type_id: { in: ZONE_TYPE_IDS },
      },
      select: {
        id: true,
        name: true,
        type_id: true,
      },
    });

    console.log(zones, "zones");

    if (!zones.length) return res.json([]);

    // Get toilets whose parent is in those zones
    const zoneIds = zones.map((z) => z.id);
    console.log(zoneIds, "zones ids");

    const toilets = await prisma.locations.findMany({
      where: {
        type_id: BigInt(4), // Toilet
        parent_id: { in: zoneIds },
      },
      select: {
        id: true,
        name: true,
        parent_id: true,
        latitude: true,
        longitude: true,
        hygiene_scores: {
          orderBy: { inspected_at: "desc" },
          take: 1,
          select: { image_url: true },
        },
      },
    });

    console.log(toilets, "toilest ++ loc");
    // Group toilets by their zone (parent_id)
    const toiletsByZone = {};
    toilets.forEach((toilet) => {
      const zoneId = toilet.parent_id.toString();
      if (!toiletsByZone[zoneId]) toiletsByZone[zoneId] = [];

      // toiletsByZone[zoneId].push({
      //   id: toilet.id.toString(),
      //   name: toilet.name,
      //   image_url: toilet.hygiene_scores[0]?.image_url || null,
      // });

      toiletsByZone[zoneId].push({
        id: toilet.id.toString(),
        name: toilet.name,
        image_url: toilet.hygiene_scores[0]?.image_url || null,
        latitude: toilet.latitude,
        longitude: toilet.longitude,
      });
    });

    // Attach toilets to zones
    const result = zones.map((zone) => ({
      id: zone.id.toString(),
      name: zone.name,
      type_id: zone.type_id.toString(),
      children: toiletsByZone[zone.id.toString()] || [],
    }));

    return res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching zones and toilets" });
  }
};
