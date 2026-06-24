// controllers/dashboardController.js
import RBACFilterService from "../utils/rbacFilterService.js";
import prisma from "../config/prismaClient.mjs";

export const getDashboardCounts = async (req, res) => {
  try {
    const { companyId, date } = req.query;
    const user = req.user;

    // Get role-based filters
    const roleFilter = await RBACFilterService.getLocationFilter(user);
    const userFilter = await RBACFilterService.getUserFilter(user);

    // Date range
    const startOfDay = new Date(date || new Date());
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setHours(23, 59, 59, 999);

    // Build where clauses with RBAC
    const locationWhere = {
      company_id: BigInt(companyId),
      status: true,
      deleted_at: null, // ✅ Added: Exclude soft-deleted locations
      ...roleFilter,
    };

    const reviewWhere = {
      company_id: BigInt(companyId),
      created_at: { gte: startOfDay, lte: endOfDay },
      // ✅ Fixed: Use location_id for roleFilter
      ...(roleFilter.id && { location_id: roleFilter.id }),
    };

    const userWhere = {
      company_id: BigInt(companyId),
      deleted_at: null,
      ...userFilter,
    };
    // Parallel count queries - fastest possible
    const [
      totalLocations,
      ongoingTasks,
      completedTasks,
      totalCleaners,
      // totalRepairs // Uncomment when repairs table exists
    ] = await Promise.all([
      prisma.locations.count({ where: locationWhere }),

      prisma.cleaner_review.count({
        where: { ...reviewWhere, status: "ongoing" },
      }),

      prisma.cleaner_review.count({
        where: { ...reviewWhere, status: "completed" },
      }),

      prisma.users.count({
        where: {
          ...userWhere,
          role_id: 5, // ✅ Fixed: role_id not roleid
        },
      }),

      // ✅ Add repairs when table exists
      // prisma.repairs.count({
      //     where: {
      //         company_id: BigInt(companyId),
      //         created_at: { gte: startOfDay, lte: endOfDay }
      //     }
      // })
    ]);

    res.json({
      success: true,
      data: {
        totalLocations,
        ongoingTasks,
        completedTasks,
        totalCleaners,
        totalRepairs: 0, // Set to actual count when repairs implemented
      },
    });
  } catch (error) {
    console.error("Dashboard counts error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getWashroomScoresSummary = async (req, res) => {
  try {
    const { companyId, start_date, end_date } = req.query;
    const user = req.user;

    console.log(BigInt(companyId), "companyId ");
    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: "companyId is required",
      });
    }

    // ✅ RBAC location filter
    const roleFilter = await RBACFilterService.getLocationFilter(
      user,
      "dashboard",
    );

    console.log(roleFilter, "role filter");
    const locationWhere = {
      company_id: BigInt(companyId),
      status: true,
      deleted_at: null,
      ...roleFilter,
    };

    console.log(locationWhere, "locaton where ");
    // Step 1: Fetch allowed locations
    const locations = await prisma.locations.findMany({
      where: locationWhere,
      select: {
        id: true,
        name: true,
      },
    });

    if (locations.length === 0) {
      return res.json({
        success: true,
        data: [],
      });
    }

    const locationIds = locations.map((l) => l.id);

    // Step 2: Date filtering
    let scoreDateFilter = {};

    if (start_date || end_date) {
      scoreDateFilter.inspected_at = {};

      if (start_date) scoreDateFilter.inspected_at.gte = new Date(start_date);

      if (end_date) {
        const end = new Date(end_date);
        end.setHours(23, 59, 59, 999);
        scoreDateFilter.inspected_at.lte = end;
      }
    }

    // Step 3: Fetch hygiene scores
    // Step 3: Fetch cleaner reviews instead
    const reviews = await prisma.cleaner_review.findMany({
      where: {
        company_id: BigInt(companyId),
        location_id: { in: locationIds },
        status: "completed",
      },
      select: {
        location_id: true,
        score: true,
        updated_at: true,
      },
      orderBy: {
        updated_at: "desc",
      },
    });

    // Step 4: Group reviews
    const reviewMap = new Map();

    reviews.forEach((r) => {
      const locId = r.location_id.toString();

      if (!reviewMap.has(locId)) {
        reviewMap.set(locId, []);
      }

      reviewMap.get(locId).push(Number(r.score || 0));
    });

    // Step 5: Build response
    const result = locations.map((loc) => {
      const locId = loc.id.toString();
      const list = reviewMap.get(locId) || [];

      const avg =
        list.length > 0 ? list.reduce((sum, v) => sum + v, 0) / list.length : 0;

      const latest = list.length > 0 ? list[0] : 0;

      return {
        location_id: locId,
        location_name: loc.name,
        average_score: Number(avg.toFixed(2)),
        current_score: Number(latest.toFixed(2)),
      };
    });

    // Step 6: Sort by current score
    result.sort((a, b) => b.current_score - a.current_score);

    res.json({
      success: true,
      count: result.length,
      data: result,
    });
  } catch (error) {
    console.error("Score summary error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// controllers/dashboardController.js
// export const getWeeklyCleanerPerformance = async (req, res) => {
//   try {
//     const { companyId } = req.query;
//     const user = req.user;

//     // RBAC filter
//     const roleFilter = await RBACFilterService.getLocationFilter(
//       user,
//       "dashboard",
//     );

//     // Generate last 7 days range
//     const days = [];
//     for (let i = 6; i >= 0; i--) {
//       const d = new Date();
//       d.setDate(d.getDate() - i);
//       d.setHours(0, 0, 0, 0);
//       days.push(d);
//     }

//     const performanceData = await Promise.all(
//       days.map(async (day) => {
//         const start = new Date(day);
//         const end = new Date(day);
//         end.setHours(23, 59, 59, 999);

//         const count = await prisma.cleaner_review.count({
//           where: {
//             company_id: BigInt(companyId),
//             status: "completed",
//             updated_at: { gte: start, lte: end },
//             ...(roleFilter.id && { location_id: roleFilter.id }),
//           },
//         });

//         return {
//           day: day.toLocaleDateString("en-US", { weekday: "short" }),
//           date: day.toISOString().split("T")[0],
//           count: count,
//         };
//       }),
//     );

//     res.json({ success: true, data: performanceData });
//   } catch (error) {
//     res.status(500).json({ success: false, error: error.message });
//   }
// };
export const getWeeklyCleanerPerformance = async (req, res) => {
  try {
    const { companyId } = req.query;
    const user = req.user;

    // RBAC filter
    const roleFilter = await RBACFilterService.getLocationFilter(
      user,
      "dashboard",
    );

    // Generate last 7 days range
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      days.push(d);
    }

    let totalTasks = 0;
    let bestDayCount = -1;
    let bestDayName = "N/A";

    // Query total tasks (all statuses) for the 7-day window to calculate completion rate
    const sevenDaysAgo = new Date(days[0]);
    const endOfToday = new Date(days[6]);
    endOfToday.setHours(23, 59, 59, 999);

    const totalTasksCreated = await prisma.cleaner_review.count({
      where: {
        company_id: BigInt(companyId),
        updated_at: { gte: sevenDaysAgo, lte: endOfToday },
        ...(roleFilter.id && { location_id: roleFilter.id }),
      },
    });

    const performanceData = await Promise.all(
      days.map(async (day) => {
        const start = new Date(day);
        const end = new Date(day);
        end.setHours(23, 59, 59, 999);

        // Count completed tasks for the specific day
        const count = await prisma.cleaner_review.count({
          where: {
            company_id: BigInt(companyId),
            status: "completed",
            updated_at: { gte: start, lte: end },
            ...(roleFilter.id && { location_id: roleFilter.id }),
          },
        });

        totalTasks += count;
        const dayNameShort = day.toLocaleDateString("en-US", { weekday: "short" });
        const dayNameLong = day.toLocaleDateString("en-US", { weekday: "long" });

        // Determine Best Day
        if (count > bestDayCount) {
          bestDayCount = count;
          bestDayName = dayNameLong;
        }

        return {
          day: dayNameShort,
          date: day.toISOString().split("T")[0],
          count: count,
        };
      }),
    );

    // Calculate aggregated stats
    const averagePerDay = (totalTasks / 7).toFixed(1);
    const completionRate = totalTasksCreated > 0 
      ? Math.round((totalTasks / totalTasksCreated) * 100) 
      : 0;

    res.json({ 
      success: true, 
      data: performanceData,
      stats: {
        totalTasks,
        averagePerDay: Number(averagePerDay),
        bestDay: bestDayName,
        bestDayCount,
        completionRate
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
// export const getTopRatedLocations = async (req, res) => {
//     try {
//         const { companyId, limit = 5, date } = req.query;
//         const user = req.user;

//         // RBAC filter for locations
//         const roleFilter = await RBACFilterService.getLocationFilter(user, 'dashboard');

//         // Date range for today's scores
//         const startOfDay = new Date(date || new Date());
//         startOfDay.setHours(0, 0, 0, 0);
//         const endOfDay = new Date(startOfDay);
//         endOfDay.setHours(23, 59, 59, 999);

//         const whereClause = {
//             company_id: BigInt(companyId),
//             status: true,
//             deleted_at: null, // ✅ Added: Exclude soft-deleted
//             ...roleFilter
//         };

//         // ✅ Strategy: Use current_cleaning_score from locations table (already aggregated)
//         // This is much faster than querying hygiene_scores
//         const topLocations = await prisma.locations.findMany({
//             where: {
//                 ...whereClause,
//                 current_cleaning_score: { not: null } // ✅ Only locations with scores
//             },
//             select: {
//                 id: true,
//                 name: true,
//                 current_cleaning_score: true // ✅ Use pre-calculated score
//             },
//             orderBy: {
//                 current_cleaning_score: 'desc'
//             },
//             take: parseInt(limit)
//         });

//         // Serialize BigInt
//         const locationsWithScores = topLocations.map(loc => ({
//             id: loc.id.toString(),
//             name: loc.name,
//             currentScore: loc.current_cleaning_score || 0
//         }));

//         res.json({
//             success: true,
//             data: locationsWithScores
//         });

//     } catch (error) {
//         console.error('Top locations error:', error);
//         res.status(500).json({ success: false, error: error.message });
//     }
// };

export const getAllLocationsScores = async (req, res) => {
  try {
    // Removed the 'limit' destructuring
    const { companyId, date } = req.query;
    const user = req.user;

    const roleFilter = await RBACFilterService.getLocationFilter(
      user,
      "dashboard",
    );

    // Date range for today's scores
    const startOfDay = new Date(date || new Date());
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setHours(23, 59, 59, 999);

    // ✅ Build location where clause with RBAC
    const locationWhereClause = {
      company_id: BigInt(companyId),
      status: true,
      deleted_at: null,
      ...roleFilter,
    };

    // ✅ Step 1: Get ALL locations (with RBAC filter)
    const allLocations = await prisma.locations.findMany({
      where: locationWhereClause,
      select: {
        id: true,
        name: true,
        hygiene_scores: {
          where: {
            created_at: { gte: startOfDay, lte: endOfDay },
          },
          select: {
            score: true,
          },
        },
      },
    });

    // ✅ Step 2: Calculate score for each location (0 if no scores for that day)
    const locationsWithScores = allLocations.map((loc) => {
      const scores = loc.hygiene_scores.map((hs) => Number(hs.score));

      let currentScore = 0; // Default to 0 if no activity

      if (scores.length > 0) {
        // Calculate average score for the day
        currentScore =
          scores.reduce((sum, score) => sum + score, 0) / scores.length;
      }

      return {
        id: loc.id.toString(),
        name: loc.name,
        currentScore: parseFloat(currentScore.toFixed(2)),
        scoreCount: scores.length, // How many times scored that day
      };
    });

    // ✅ Step 3: Sort by score DESC (Returns ALL washrooms, limit is removed)
    const sortedLocations = locationsWithScores.sort((a, b) => {
      // Sort by score descending
      if (b.currentScore !== a.currentScore) {
        return b.currentScore - a.currentScore;
      }
      // If same score, natural order is fine
      return 0;
    });

    res.json({
      success: true,
      data: sortedLocations,
    });
  } catch (error) {
    console.error("All locations error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getTodaysActivities = async (req, res) => {
  console.log("entered todays activities controller");
  try {
    const { companyId, limit = 10, date } = req.query;
    const user = req.user;

    // RBAC filter for cleaner activities
    const roleFilter = await RBACFilterService.getLocationFilter(
      user,
      "cleaneractivity",
    );

    console.log(roleFilter, "role filter form todays activities");
    // Date range
    const startOfDay = new Date(date || new Date());
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setHours(23, 59, 59, 999);

    const cleanerReviewWhere = {
      company_id: BigInt(companyId),
      created_at: { gte: startOfDay, lte: endOfDay },
    };

    // ✅ Apply RBAC - filter by location_id if restricted
    if (roleFilter.id) {
      cleanerReviewWhere.location_id = roleFilter.id;
    }

    // ✅ Build where clause for user reviews (separate table)
    const userReviewWhere = {
      created_at: { gte: startOfDay, lte: endOfDay },
    };

    // ✅ For user_review_qr, filter by company_id if available
    if (companyId) {
      userReviewWhere.company_id = BigInt(companyId);
    }

    // ✅ If RBAC restricts to specific location IDs
    if (roleFilter.id) {
      // user_review_qr uses toilet_id field
      userReviewWhere.toilet_id = roleFilter.id;
    }
    console.log(
      cleanerReviewWhere,
      "cleaner review where clause todays activities",
    );
    // Fetch cleaner reviews + user reviews in parallel
    const [cleanerActivities, userReviews] = await Promise.all([
      prisma.cleaner_review.findMany({
        where: cleanerReviewWhere,
        select: {
          id: true,
          status: true,
          score: true,
          created_at: true,
          updated_at: true,
          cleaner_user: {
            // ✅ Correct relation name from schema
            select: { id: true, name: true },
          },
          location: {
            // ✅ Correct relation name from schema
            select: { id: true, name: true },
          },
        },
        orderBy: { created_at: "desc" },
        take: parseInt(limit) * 10, // Get more to filter later
      }),

      // ✅ User feedback reviews - check role_id (not roleid)
      // ✅ Query user_review_qr table (no relation to locations in this table)
      user.role_id <= 3
        ? prisma.user_review_qr.findMany({
            where: userReviewWhere,
            select: {
              id: true,
              name: true,
              rating: true,
              created_at: true,
              toilet_id: true, // ✅ Get toilet_id to fetch location separately
            },
            orderBy: { created_at: "desc" },
            take: 10,
          })
        : Promise.resolve([]),
    ]);

    console.log(cleanerActivities, "cleaner activity");
    // ✅ Fetch location names for user reviews
    // Since user_review_qr doesn't have relation to locations, we need to fetch separately
    const toiletIds = userReviews
      .map((r) => r.toilet_id)
      .filter((id) => id !== null);

    const locationMap = {};
    if (toiletIds.length > 0) {
      const locations = await prisma.locations.findMany({
        where: {
          id: { in: toiletIds },
        },
        select: {
          id: true,
          name: true,
        },
      });

      locations.forEach((loc) => {
        locationMap[loc.id.toString()] = loc.name;
      });
    }

    // Format activities
    const activities = [];

    // Add cleaner activities
    cleanerActivities.forEach((activity) => {
      // Task started
      activities.push({
        id: `${activity.id}-started`,
        type: "cleaner",
        reviewId: activity.id.toString(),
        text: `${activity.cleaner_user?.name || "Cleaner"} started cleaning at ${activity.location?.name || "Unknown location"}`,
        timestamp: activity.created_at,
        status: activity.status,
        activityType: "info",
      });

      // Task completed (if updated after creation)
      if (
        activity.status === "completed" &&
        activity.updated_at &&
        activity.updated_at > activity.created_at
      ) {
        activities.push({
          id: `${activity.id}-completed`,
          type: "cleaner",
          reviewId: activity.id.toString(),
          text: `${activity.cleaner_user?.name || "Cleaner"} completed cleaning at ${activity.location?.name || "Unknown location"}`,
          timestamp: activity.updated_at,
          status: "completed",
          score: activity.score,
          activityType: "success",
        });
      }
    });

    // Add user reviews
    userReviews.forEach((review) => {
      const locationName = review.toilet_id
        ? locationMap[review.toilet_id.toString()] || "Unknown location"
        : "Unknown location";

      activities.push({
        id: `user-${review.id}`,
        type: "user",
        text: `${review.name || "User"} submitted feedback for ${locationName}`,
        timestamp: review.created_at,
        rating: review.rating,
        activityType:
          review.rating >= 7
            ? "success"
            : review.rating >= 5
              ? "warning"
              : "update",
      });
    });

    // Sort all activities by timestamp and limit
    const sortedActivities = activities
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, parseInt(limit))
      .map((activity) => ({
        ...activity,
        id: activity.id.toString(),
        timestamp: activity.timestamp.toISOString(),
      }));

    console.log(sortedActivities, "sorted activities final");
    res.json({
      success: true,
      data: sortedActivities,
    });
  } catch (error) {
    console.error("Activities error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// export const getWashroomHygieneHeatmap = async (req, res) => {
//     console.log('🔍 Generating Washroom Hygiene Heatmap');
//     try {
//         const { company_id, start_date, end_date, type_id } = req.query;
        
//         // ✅ 1. Get authenticated user
//         const user = req.user;
//         if (!user) {
//             return res.status(401).json({
//                 status: "error",
//                 message: "Unauthorized: User information is missing."
//             });
//         }

//         console.log('📥 Request Params:', { company_id, start_date, end_date, type_id, user_id: user.id, role: user.role_id });

//         // ✅ VALIDATION
//         if (!company_id) {
//             return res.status(400).json({
//                 status: "error",
//                 message: "company_id is required"
//             });
//         }

//         if (!start_date || !end_date) {
//             return res.status(400).json({
//                 status: "error",
//                 message: "start_date and end_date are required"
//             });
//         }

//         // Parse dates
//         const startDateTime = new Date(start_date);
//         const endDateTime = new Date(end_date);
//         endDateTime.setHours(23, 59, 59, 999);

//         if (startDateTime > endDateTime) {
//             return res.status(400).json({
//                 status: "error",
//                 message: "start_date must be before or equal to end_date"
//             });
//         }

//         // ✅ Fetch company details
//         const company = await prisma.companies.findUnique({
//             where: { id: BigInt(company_id) },
//             select: { name: true }
//         });

//         if (!company) {
//             return res.status(404).json({
//                 status: "error",
//                 message: "Company not found"
//             });
//         }

//         // ✅ STEP 1: Build Base Location Query
//         const locationWhereClause = {
//             company_id: BigInt(company_id),
//             status: true,
//             deleted_at: null
//         };

//         if (type_id && type_id !== 'undefined') {
//             locationWhereClause.type_id = BigInt(type_id);
//         }

//         // ✅ STEP 2: Apply RBAC (Role-Based Access Control)
//         // Assuming Role 1 = Super Admin. Adjust the ID according to your actual DB roles.
//         const SUPER_ADMIN_ROLE_ID = 1; 
        
//         if (user.role_id !== SUPER_ADMIN_ROLE_ID) {
//             // If NOT a Super Admin, restrict locations to only those assigned to this specific user.
//             // This OR array handles both direct assignments and zone-based assignments.
//             locationWhereClause.OR = [
//                 {
//                     // 1. User is directly assigned to the washroom (e.g., as a cleaner or supervisor)
//                     cleaner_assignments: {
//                         some: {
//                             cleaner_user: { id: user.id },
//                             status: 'assigned',
//                             deleted_at: null
//                         }
//                     }
//                 },
//                 {
//                     // 2. User is assigned as a Facility Admin to the washroom's specific Zone
//                     // (Adjust 'zone' and 'facility_admin_assignments' to match your exact Prisma schema relations)
//                     zone: {
//                         facility_admin_assignments: {
//                             some: {
//                                 user_id: user.id,
//                                 deleted_at: null
//                             }
//                         }
//                     }
//                 }
//             ];
//         }

//         // ✅ STEP 3: Fetch filtered washrooms
//         const washrooms = await prisma.locations.findMany({
//             where: locationWhereClause,
//             include: {
//                 location_types: {
//                     select: {
//                         name: true
//                     }
//                 }
//             },
//             orderBy: { name: 'asc' }
//         });

//         console.log(`✅ Found ${washrooms.length} accessible washrooms for user ${user.id}`);

//         if (washrooms.length === 0) {
//             return res.status(200).json({
//                 status: "success",
//                 message: "No washrooms found for your access level",
//                 metadata: {
//                     report_type: "Washroom Hygiene Heatmap",
//                     organization: company.name,
//                     generated_on: new Date().toISOString(),
//                     date_range: { start: start_date, end: end_date },
//                     total_days: 0,
//                     total_washrooms: 0,
//                     overall_avg_score: 0,
//                     date_columns: []
//                 },
//                 data: [],
//                 count: 0
//             });
//         }

//         const washroomIds = washrooms.map(w => w.id);

//         // ✅ STEP 4: Get assigned cleaners specifically for display purposes
//         const assignments = await prisma.cleaner_assignments.findMany({
//             where: {
//                 location_id: { in: washroomIds },
//                 status: 'assigned',
//                 deleted_at: null,
//                 role_id: 5, // Cleaner role
//                 cleaner_user: {
//                     deleted_at: null
//                 }
//             },
//             include: {
//                 cleaner_user: {
//                     select: {
//                         id: true,
//                         name: true,
//                         phone: true
//                     }
//                 }
//             }
//         });

//         // Group assignments by location
//         const assignmentsByLocation = new Map();
//         assignments.forEach(assignment => {
//             const locId = assignment.location_id?.toString();
//             if (!locId || !assignment.cleaner_user) return;

//             if (!assignmentsByLocation.has(locId)) {
//                 assignmentsByLocation.set(locId, []);
//             }

//             assignmentsByLocation.get(locId).push({
//                 id: assignment.cleaner_user.id.toString(),
//                 name: assignment.cleaner_user.name,
//                 phone: assignment.cleaner_user.phone
//             });
//         });

//         // ✅ STEP 5: Fetch hygiene scores for date range
//         const hygieneScores = await prisma.hygiene_scores.findMany({
//             where: {
//                 location_id: { in: washroomIds },
//                 inspected_at: {
//                     gte: startDateTime,
//                     lte: endDateTime
//                 }
//             },
//             select: {
//                 location_id: true,
//                 score: true,
//                 inspected_at: true
//             },
//             orderBy: {
//                 inspected_at: 'asc'
//             }
//         });

//         console.log(`📊 Found ${hygieneScores.length} hygiene score records`);

//         // ✅ STEP 6: Group scores by location + date
//         const scoresByLocationAndDate = new Map();
//         const allScoresByLocation = new Map();

//         hygieneScores.forEach(record => {
//             if (!record.location_id || record.score == null) return;

//             const locId = record.location_id.toString();
//             const dateStr = new Date(record.inspected_at).toISOString().split('T')[0];
//             const key = `${locId}_${dateStr}`;

//             if (!scoresByLocationAndDate.has(key)) {
//                 scoresByLocationAndDate.set(key, []);
//             }

//             scoresByLocationAndDate.get(key).push({
//                 score: Number(record.score),
//                 timestamp: record.inspected_at
//             });

//             // Track all scores for overall average computation
//             if (!allScoresByLocation.has(locId)) {
//                 allScoresByLocation.set(locId, []);
//             }
//             allScoresByLocation.get(locId).push(Number(record.score));
//         });

//         // Get LATEST score per location per day
//         const latestScorePerDay = new Map();
//         scoresByLocationAndDate.forEach((scores, key) => {
//             const sortedScores = scores.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
//             latestScorePerDay.set(key, parseFloat(sortedScores[0].score.toFixed(2)));
//         });

//         // ✅ STEP 7: Generate date columns
//         const dateColumns = [];
//         const dateColumnsFormatted = [];
//         const currentDate = new Date(startDateTime);

//         while (currentDate <= endDateTime) {
//             const dateStr = currentDate.toISOString().split('T')[0]; 
//             dateColumns.push(dateStr);

//             // Using just the day number to match the frontend UI requirement (1, 2, 3...)
//             const formatted = currentDate.toLocaleDateString('en-GB', { day: 'numeric' });
//             dateColumnsFormatted.push(formatted);

//             currentDate.setDate(currentDate.getDate() + 1);
//         }

//         const totalDays = dateColumns.length;

//         // ✅ STEP 8: Build final report data
//         const reportData = washrooms.map((washroom, index) => {
//             const washroomId = washroom.id.toString();
//             const assignedCleaners = assignmentsByLocation.get(washroomId) || [];

//             const dailyScores = {};
//             dateColumns.forEach(dateStr => {
//                 const key = `${washroomId}_${dateStr}`;
//                 const latestScore = latestScorePerDay.get(key);
//                 dailyScores[dateStr] = latestScore !== undefined ? latestScore : null;
//             });

//             // Calculate overall average
//             const allScores = allScoresByLocation.get(washroomId) || [];
//             const averageScore = allScores.length > 0
//                 ? parseFloat((allScores.reduce((sum, s) => sum + s, 0) / allScores.length).toFixed(2))
//                 : null; // Sending null instead of 0 if no inspections occurred

//             return {
//                 sr_no: index + 1,
//                 washroom_id: washroomId,
//                 washroom_name: washroom.name,
//                 zone_type: washroom.location_types?.name || "N/A",
//                 assigned_cleaners: assignedCleaners.map(c => c.name),
//                 assigned_cleaners_ids: assignedCleaners.map(c => c.id),
//                 daily_scores: dailyScores,
//                 average_score: averageScore,
//                 address: washroom.address || "N/A",
//                 city: washroom.city || "N/A"
//             };
//         });

//         // ✅ STEP 9: Calculate overall metrics
//         const totalWashrooms = reportData.length;
//         // Only average washrooms that actually have an average_score
//         const washroomsWithScores = reportData.filter(w => w.average_score !== null);
//         const overallAvgScore = washroomsWithScores.length > 0
//             ? parseFloat((washroomsWithScores.reduce((sum, w) => sum + w.average_score, 0) / washroomsWithScores.length).toFixed(2))
//             : 0;

//         // ✅ STEP 10: Return response
//         res.status(200).json({
//             status: "success",
//             message: "Washroom Hygiene Heatmap generated successfully",
//             metadata: {
//                 report_type: "Washroom Hygiene Heatmap",
//                 organization: company.name,
//                 generated_on: new Date().toISOString(),
//                 user_role_id: user.role_id,
//                 date_range: {
//                     start: start_date,
//                     end: end_date
//                 },
//                 total_days: totalDays,
//                 total_washrooms: totalWashrooms,
//                 overall_avg_score: overallAvgScore,
//                 date_columns: dateColumnsFormatted // Passes [1, 2, 3...] to match the UI columns
//             },
//             data: reportData,
//             count: totalWashrooms
//         });

//     } catch (error) {
//         console.error("❌ Error generating washroom hygiene heatmap:", error);
//         res.status(500).json({
//             status: "error",
//             message: "Failed to generate washroom hygiene heatmap",
//             error: process.env.NODE_ENV === "development" ? error.message : undefined,
//         });
//     }
// };

// controllers/reportController.js (or wherever this is located)

export const getWashroomHygieneHeatmap = async (req, res) => {
    console.log('🔍 Generating Washroom Hygiene Heatmap');
    try {
        const { company_id, start_date, end_date, type_id } = req.query;
        const user = req.user;

        if (!user) {
            return res.status(401).json({ status: "error", message: "Unauthorized" });
        }

        // Parse dates
        const startDateTime = new Date(start_date);
        const endDateTime = new Date(end_date);
        endDateTime.setHours(23, 59, 59, 999);

        // Fetch company
        const company = await prisma.companies.findUnique({
            where: { id: BigInt(company_id) },
            select: { name: true }
        });

        // ✅ STEP 1: Base Location Query
     const locationWhereClause = {
            company_id: BigInt(company_id),
            status: true,
            deleted_at: null
        };

        if (type_id && type_id !== 'undefined') {
            locationWhereClause.type_id = BigInt(type_id);
        }

        // ✅ STEP 2: Apply RBAC (Role-Based Access Control) using your existing service
        const SUPER_ADMIN_ROLE_ID = 1; // Adjust if needed

        if (Number(user.role_id) !== SUPER_ADMIN_ROLE_ID) {
            console.log(`🛡️ Applying RBAC for User ID: ${user.id}`);
            
            try {
                // Using the exact service call from your original code
                const roleFilter = await RBACFilterService.getLocationFilter(user, "washroom_daily_scores");
                
                if (roleFilter) {
                    Object.assign(locationWhereClause, roleFilter);
                    console.log("✅ RBAC Filter Applied successfully.");
                }
            } catch (rbacError) {
                console.error("❌ RBAC Filter Service Error:", rbacError);
                return res.status(500).json({ 
                    status: "error", 
                    message: "Failed to apply user permissions." 
                });
            }
        } else {
            console.log("🔓 Super Admin detected. Fetching all washrooms.");
        }

        // ✅ STEP 3: Fetch filtered washrooms
        const washrooms = await prisma.locations.findMany({
            where: locationWhereClause,
            include: { location_types: { select: { name: true } } },
            orderBy: { name: 'asc' }
        });

        // If no washrooms are assigned to this Facility Admin, return empty early
        if (washrooms.length === 0) {
            return res.status(200).json({
                status: "success",
                message: "No washrooms allocated to this user.",
                metadata: {
                    report_type: "Washroom Hygiene Heatmap",
                    organization: company?.name || "Unknown",
                    generated_on: new Date().toISOString(),
                    total_days: 0,
                    total_washrooms: 0,
                    overall_avg_score: 0,
                    date_columns: []
                },
                data: [],
                count: 0
            });
        }

        const washroomIds = washrooms.map(w => w.id);

        // ✅ STEP 4: Get assigned cleaners for UI display
        const assignments = await prisma.cleaner_assignments.findMany({
            where: {
                location_id: { in: washroomIds },
                status: 'assigned',
                deleted_at: null,
                role_id: 5,
                cleaner_user: { deleted_at: null }
            },
            include: { cleaner_user: { select: { id: true, name: true, phone: true } } }
        });

        const assignmentsByLocation = new Map();
        assignments.forEach(assignment => {
            const locId = assignment.location_id?.toString();
            if (!assignmentsByLocation.has(locId)) assignmentsByLocation.set(locId, []);
            assignmentsByLocation.get(locId).push({
                id: assignment.cleaner_user.id.toString(),
                name: assignment.cleaner_user.name,
                phone: assignment.cleaner_user.phone
            });
        });

        // ✅ STEP 5: Fetch hygiene scores
        const hygieneScores = await prisma.hygiene_scores.findMany({
            where: {
                location_id: { in: washroomIds },
                inspected_at: { gte: startDateTime, lte: endDateTime }
            },
            select: { location_id: true, score: true, inspected_at: true },
            orderBy: { inspected_at: 'asc' }
        });

        const scoresByLocationAndDate = new Map();
        const allScoresByLocation = new Map();

        hygieneScores.forEach(record => {
            if (!record.location_id || record.score == null) return;
            const locId = record.location_id.toString();
            const dateStr = new Date(record.inspected_at).toISOString().split('T')[0];
            const key = `${locId}_${dateStr}`;

            if (!scoresByLocationAndDate.has(key)) scoresByLocationAndDate.set(key, []);
            scoresByLocationAndDate.get(key).push({
                score: Number(record.score),
                timestamp: record.inspected_at
            });

            if (!allScoresByLocation.has(locId)) allScoresByLocation.set(locId, []);
            allScoresByLocation.get(locId).push(Number(record.score));
        });

        const latestScorePerDay = new Map();
        scoresByLocationAndDate.forEach((scores, key) => {
            const sortedScores = scores.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            latestScorePerDay.set(key, parseFloat(sortedScores[0].score.toFixed(2)));
        });

        // ✅ STEP 6: Generate date columns
        const dateColumns = [];
        const dateColumnsFormatted = [];
        const currentDate = new Date(startDateTime);

        while (currentDate <= endDateTime) {
            const dateStr = currentDate.toISOString().split('T')[0]; 
            dateColumns.push(dateStr);
            dateColumnsFormatted.push(currentDate.toLocaleDateString('en-GB', { day: 'numeric' }));
            currentDate.setDate(currentDate.getDate() + 1);
        }

        // ✅ STEP 7: Build final report data
        const reportData = washrooms.map((washroom, index) => {
            const washroomId = washroom.id.toString();
            const assignedCleaners = assignmentsByLocation.get(washroomId) || [];

            const dailyScores = {};
            dateColumns.forEach(dateStr => {
                const key = `${washroomId}_${dateStr}`;
                const latestScore = latestScorePerDay.get(key);
                dailyScores[dateStr] = latestScore !== undefined ? latestScore : null;
            });

            const allScores = allScoresByLocation.get(washroomId) || [];
            const averageScore = allScores.length > 0
                ? parseFloat((allScores.reduce((sum, s) => sum + s, 0) / allScores.length).toFixed(2))
                : null;

            return {
                sr_no: index + 1,
                washroom_id: washroomId,
                washroom_name: washroom.name,
                zone_type: washroom.location_types?.name || "N/A",
                assigned_cleaners: assignedCleaners.map(c => c.name),
                assigned_cleaners_ids: assignedCleaners.map(c => c.id),
                daily_scores: dailyScores,
                average_score: averageScore,
                address: washroom.address || "N/A",
                city: washroom.city || "N/A"
            };
        });

        const washroomsWithScores = reportData.filter(w => w.average_score !== null);
        const overallAvgScore = washroomsWithScores.length > 0
            ? parseFloat((washroomsWithScores.reduce((sum, w) => sum + w.average_score, 0) / washroomsWithScores.length).toFixed(2))
            : 0;

        // ✅ STEP 8: Return response
        res.status(200).json({
            status: "success",
            message: "Washroom Hygiene Heatmap generated successfully",
            metadata: {
                report_type: "Washroom Hygiene Heatmap",
                organization: company.name,
                generated_on: new Date().toISOString(),
                total_days: dateColumns.length,
                total_washrooms: reportData.length,
                overall_avg_score: overallAvgScore,
                date_columns: dateColumnsFormatted
            },
            data: reportData,
            count: reportData.length
        });

    } catch (error) {
        console.error("❌ Error:", error);
        res.status(500).json({ status: "error", message: "Failed to generate heatmap" });
    }
};