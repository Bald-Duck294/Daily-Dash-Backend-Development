// controllers/dashboardController.js
import RBACFilterService from "../utils/rbacFilterService.js";
import prisma from "../config/prismaClient.mjs";
import { getCompanySLAConfiguration } from "../services/slaConfigurationService.js";

/**
 * Helper to build SLA-aware WHERE conditions for cleaner_review queries in dashboard.
 * - If company SLA is OFF: returns standard legacy filter (no is_latest restriction).
 * - If company SLA is ON:
 *    - Washrooms with SLA ON => requires is_latest: true
 *    - Washrooms with SLA OFF => standard filter without is_latest restriction
 */
const buildSlaAwareReviewFilter = async (companyId, locations = []) => {
  if (!companyId || !locations || locations.length === 0) {
    return { isSlaActive: false, slaWhereCondition: {} };
  }

  try {
    const companySla = await getCompanySLAConfiguration(companyId);
    const isCompanySlaOn = Boolean(companySla?.enabled);

    if (!isCompanySlaOn) {
      return {
        isSlaActive: false,
        slaWhereCondition: {},
      };
    }

    const slaOnLocationIds = [];
    const slaOffLocationIds = [];

    for (const loc of locations) {
      const locSla =
        loc.sla_config && typeof loc.sla_config === "object"
          ? loc.sla_config
          : null;
      const isWashroomExplicitlyOff =
        locSla && (locSla.enabled === false || locSla.is_active === false);

      if (isWashroomExplicitlyOff) {
        slaOffLocationIds.push(loc.id);
      } else {
        slaOnLocationIds.push(loc.id);
      }
    }

    // Case 1: All locations have SLA ON
    if (slaOffLocationIds.length === 0) {
      return {
        isSlaActive: true,
        slaWhereCondition: {
          is_latest: true,
        },
      };
    }

    // Case 2: All locations have SLA OFF
    if (slaOnLocationIds.length === 0) {
      return {
        isSlaActive: false,
        slaWhereCondition: {},
      };
    }

    // Case 3: Mixed locations
    return {
      isSlaActive: true,
      slaWhereCondition: {
        OR: [
          {
            location_id: { in: slaOnLocationIds },
            is_latest: true,
          },
          {
            location_id: { in: slaOffLocationIds },
          },
        ],
      },
    };
  } catch (error) {
    console.error("Error evaluating SLA config in dashboard:", error);
    return { isSlaActive: false, slaWhereCondition: {} };
  }
};

export const getDashboardCounts = async (req, res) => {
  try {
    const { companyId, date, startDate, endDate } = req.query;
    const user = req.user;

    // Get role-based filters
    const roleFilter = await RBACFilterService.getLocationFilter(user);
    const userFilter = await RBACFilterService.getUserFilter(user);

    // Date range
    let startOfDay, endOfDay;
    if (startDate && endDate) {
      startOfDay = new Date(startDate);
      startOfDay.setHours(0, 0, 0, 0);
      endOfDay = new Date(endDate);
      endOfDay.setHours(23, 59, 59, 999);
    } else {
      startOfDay = new Date(date || new Date());
      startOfDay.setHours(0, 0, 0, 0);
      endOfDay = new Date(startOfDay);
      endOfDay.setHours(23, 59, 59, 999);
    }

    // Build where clauses with RBAC
    const locationWhere = {
      company_id: BigInt(companyId),
      status: true,
      deleted_at: null,
      ...roleFilter,
    };

    const reviewWhere = {
      company_id: BigInt(companyId),
      created_at: { gte: startOfDay, lte: endOfDay },
      ...(roleFilter.id && { location_id: roleFilter.id }),
    };

    const userWhere = {
      company_id: BigInt(companyId),
      deleted_at: null,
      ...userFilter,
    };

    // Parallel count queries
    const [
      totalLocations,
      ongoingTasks,
      completedTasks,
      totalCleaners,
      companySla,
    ] = await Promise.all([
      prisma.locations.count({ where: locationWhere }),

      prisma.cleaner_review.count({
        where: { ...reviewWhere, status: "ongoing" },
      }),

      // As confirmed: Standalone count of all physical cleaning activities performed
      prisma.cleaner_review.count({
        where: { ...reviewWhere, status: "completed" },
      }),

      prisma.users.count({
        where: {
          ...userWhere,
          role_id: 5,
        },
      }),

      getCompanySLAConfiguration(companyId),
    ]);

    const isSlaEnabled = Boolean(companySla?.enabled);

    res.json({
      success: true,
      data: {
        totalLocations,
        ongoingTasks,
        completedTasks,
        totalCleaners,
        totalRepairs: 0,
        isSlaEnabled,
        slaThreshold: companySla?.configuration?.threshold_score ?? 8.0,
        slaMaxRetries: companySla?.configuration?.max_retry_attempts ?? 2,
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

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: "companyId is required",
      });
    }

    // RBAC location filter
    const roleFilter = await RBACFilterService.getLocationFilter(
      user,
      "dashboard",
    );

    const locationWhere = {
      company_id: BigInt(companyId),
      status: true,
      deleted_at: null,
      ...roleFilter,
    };

    // Step 1: Fetch allowed locations
    const locations = await prisma.locations.findMany({
      where: locationWhere,
      select: {
        id: true,
        name: true,
        sla_config: true,
      },
    });

    if (locations.length === 0) {
      return res.json({
        success: true,
        data: [],
      });
    }

    const locationIds = locations.map((l) => l.id);

    // Step 2: Build SLA-aware review filter
    const { slaWhereCondition } = await buildSlaAwareReviewFilter(
      companyId,
      locations,
    );

    const reviewWhere = {
      company_id: BigInt(companyId),
      status: "completed",
      ...slaWhereCondition,
    };

    if (!slaWhereCondition.OR) {
      reviewWhere.location_id = { in: locationIds };
    }

    if (start_date || end_date) {
      reviewWhere.created_at = {};
      if (start_date) reviewWhere.created_at.gte = new Date(start_date);
      if (end_date) {
        const end = new Date(end_date);
        end.setHours(23, 59, 59, 999);
        reviewWhere.created_at.lte = end;
      }
    }

    // Step 3: Fetch cleaner reviews (cleaner_review as single source of truth)
    const reviews = await prisma.cleaner_review.findMany({
      where: reviewWhere,
      select: {
        location_id: true,
        score: true,
        created_at: true,
        updated_at: true,
      },
      orderBy: {
        created_at: "desc",
      },
    });

    // Step 4: Group reviews by location
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

export const getWeeklyCleanerPerformance = async (req, res) => {
  try {
    const { companyId, start_date, end_date, startDate, endDate } = req.query;
    const user = req.user;

    // RBAC filter
    const roleFilter = await RBACFilterService.getLocationFilter(
      user,
      "dashboard",
    );

    let startDateObj, endDateObj;
    const sDate = start_date || startDate;
    const eDate = end_date || endDate;

    if (sDate) {
      startDateObj = new Date(sDate);
      startDateObj.setHours(0, 0, 0, 0);

      endDateObj = new Date(eDate || new Date());
      endDateObj.setHours(0, 0, 0, 0);

      const diffTime = endDateObj - startDateObj;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays < 6) {
        endDateObj = new Date(startDateObj);
        endDateObj.setDate(startDateObj.getDate() + 6);
      }
    } else {
      endDateObj = new Date();
      endDateObj.setHours(0, 0, 0, 0);
      startDateObj = new Date();
      startDateObj.setDate(endDateObj.getDate() - 6);
      startDateObj.setHours(0, 0, 0, 0);
    }

    const days = [];
    let currentDate = new Date(startDateObj);
    while (currentDate <= endDateObj) {
      days.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    let totalTasks = 0;
    let bestDayCount = -1;
    let bestDayName = "N/A";

    const windowStart = new Date(days[0]);
    const windowEnd = new Date(days[days.length - 1]);
    windowEnd.setHours(23, 59, 59, 999);

    const totalTasksCreated = await prisma.cleaner_review.count({
      where: {
        company_id: BigInt(companyId),
        updated_at: { gte: windowStart, lte: windowEnd },
        ...(roleFilter.id && { location_id: roleFilter.id }),
      },
    });

    const performanceData = await Promise.all(
      days.map(async (day) => {
        const start = new Date(day);
        const end = new Date(day);
        end.setHours(23, 59, 59, 999);

        // Count all completed tasks for the specific day
        const count = await prisma.cleaner_review.count({
          where: {
            company_id: BigInt(companyId),
            status: "completed",
            updated_at: { gte: start, lte: end },
            ...(roleFilter.id && { location_id: roleFilter.id }),
          },
        });

        totalTasks += count;
        const dayNameShort = day.toLocaleDateString("en-US", {
          weekday: "short",
        });
        const dayNameLong = day.toLocaleDateString("en-US", {
          weekday: "long",
        });

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

    const averagePerDay = (totalTasks / days.length).toFixed(1);
    const completionRate =
      totalTasksCreated > 0
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
        completionRate,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getAllLocationsScores = async (req, res) => {
  try {
    const { companyId, date, startDate, endDate } = req.query;
    const user = req.user;

    const roleFilter = await RBACFilterService.getLocationFilter(
      user,
      "dashboard",
    );

    // Date range for today's scores
    let startOfDay, endOfDay;
    if (startDate && endDate) {
      startOfDay = new Date(startDate);
      startOfDay.setHours(0, 0, 0, 0);
      endOfDay = new Date(endDate);
      endOfDay.setHours(23, 59, 59, 999);
    } else {
      startOfDay = new Date(date || new Date());
      startOfDay.setHours(0, 0, 0, 0);
      endOfDay = new Date(startOfDay);
      endOfDay.setHours(23, 59, 59, 999);
    }

    // Step 1: Get ALL locations with sla_config
    const locationWhereClause = {
      company_id: BigInt(companyId),
      status: true,
      deleted_at: null,
      ...roleFilter,
    };

    const allLocations = await prisma.locations.findMany({
      where: locationWhereClause,
      select: {
        id: true,
        name: true,
        sla_config: true,
      },
    });

    if (allLocations.length === 0) {
      return res.json({
        success: true,
        data: [],
      });
    }

    const allLocationIds = allLocations.map((loc) => loc.id);

    // Step 2: Build SLA-aware filter for cleaner_review (single source of truth)
    const { slaWhereCondition } = await buildSlaAwareReviewFilter(
      companyId,
      allLocations,
    );

    const reviewWhere = {
      company_id: BigInt(companyId),
      status: "completed",
      created_at: { gte: startOfDay, lte: endOfDay },
      ...slaWhereCondition,
    };

    if (!slaWhereCondition.OR) {
      reviewWhere.location_id = { in: allLocationIds };
    }

    const reviews = await prisma.cleaner_review.findMany({
      where: reviewWhere,
      select: {
        location_id: true,
        score: true,
        created_at: true,
      },
      orderBy: {
        created_at: "desc",
      },
    });

    // Group reviews by location
    const reviewScoresByLoc = new Map();
    reviews.forEach((r) => {
      const locId = r.location_id.toString();
      if (!reviewScoresByLoc.has(locId)) {
        reviewScoresByLoc.set(locId, []);
      }
      reviewScoresByLoc.get(locId).push(Number(r.score || 0));
    });

    // Step 3: Calculate score for each location
    const locationsWithScores = allLocations.map((loc) => {
      const scores = reviewScoresByLoc.get(loc.id.toString()) || [];

      let currentScore = 0;
      if (scores.length > 0) {
        currentScore = scores[0]; // Most recent score for the day
      }

      return {
        id: loc.id.toString(),
        name: loc.name,
        currentScore: parseFloat(Number(currentScore).toFixed(2)),
        scoreCount: scores.length,
      };
    });

    // Step 4: Sort by score DESC
    const sortedLocations = locationsWithScores.sort((a, b) => {
      if (b.currentScore !== a.currentScore) {
        return b.currentScore - a.currentScore;
      }
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
  try {
    const { companyId, limit = 10, date, startDate, endDate } = req.query;
    const user = req.user;

    const roleFilter = await RBACFilterService.getLocationFilter(
      user,
      "cleaneractivity",
    );

    let startOfDay, endOfDay;
    if (startDate && endDate) {
      startOfDay = new Date(startDate);
      startOfDay.setHours(0, 0, 0, 0);
      endOfDay = new Date(endDate);
      endOfDay.setHours(23, 59, 59, 999);
    } else {
      startOfDay = new Date(date || new Date());
      startOfDay.setHours(0, 0, 0, 0);
      endOfDay = new Date(startOfDay);
      endOfDay.setHours(23, 59, 59, 999);
    }

    const cleanerReviewWhere = {
      company_id: BigInt(companyId),
      created_at: { gte: startOfDay, lte: endOfDay },
    };

    if (roleFilter.id) {
      cleanerReviewWhere.location_id = roleFilter.id;
    }

    const userReviewWhere = {
      created_at: { gte: startOfDay, lte: endOfDay },
    };

    if (companyId) {
      userReviewWhere.company_id = BigInt(companyId);
    }

    if (roleFilter.id) {
      userReviewWhere.toilet_id = roleFilter.id;
    }

    // Check company SLA status
    const companySla = await getCompanySLAConfiguration(companyId);
    const isCompanySlaOn = Boolean(companySla?.enabled);

    // Fetch cleaner reviews + user reviews in parallel
    const [cleanerActivities, userReviews] = await Promise.all([
      prisma.cleaner_review.findMany({
        where: cleanerReviewWhere,
        select: {
          id: true,
          status: true,
          score: true,
          attempt_no: true,
          review_type: true,
          created_at: true,
          updated_at: true,
          cleaner_user: {
            select: { id: true, name: true },
          },
          location: {
            select: { id: true, name: true, sla_config: true },
          },
          escalation: {
            select: { id: true, state: true, current_level: true },
          },
          triggered_escalations: {
            select: { id: true, state: true, current_level: true },
          },
        },
        orderBy: { created_at: "desc" },
        take: parseInt(limit) * 10,
      }),

      user.role_id <= 3
        ? prisma.user_review_qr.findMany({
            where: userReviewWhere,
            select: {
              id: true,
              name: true,
              rating: true,
              created_at: true,
              toilet_id: true,
            },
            orderBy: { created_at: "desc" },
            take: 10,
          })
        : Promise.resolve([]),
    ]);

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

    cleanerActivities.forEach((activity) => {
      const isCompleted =
        activity.status === "completed" &&
        activity.updated_at &&
        activity.updated_at > activity.created_at;

      const attemptNo = activity.attempt_no || 1;
      const isRetry = Boolean(attemptNo > 1 || activity.review_type === "corrective_retry");
      const escalation = activity.escalation || activity.triggered_escalations?.[0] || null;

      const locSla =
        activity.location?.sla_config &&
        typeof activity.location?.sla_config === "object"
          ? activity.location.sla_config
          : null;
      const isWashroomSlaOn =
        isCompanySlaOn &&
        !(locSla && (locSla.enabled === false || locSla.is_active === false));
      const threshold = Number(
        locSla?.threshold ?? companySla?.configuration?.threshold_score ?? 8.0,
      );
      const isBreached =
        isWashroomSlaOn &&
        activity.score !== null &&
        activity.score !== undefined &&
        Number(activity.score) < threshold;

      let slaTag = null;
      if (isWashroomSlaOn) {
        if (isRetry) {
          slaTag = `Retry #${attemptNo - 1}`;
        } else if (isBreached) {
          slaTag = "SLA Breached";
        } else if (activity.score !== null && Number(activity.score) >= threshold) {
          slaTag = "SLA Passed";
        }
      }

      activities.push({
        id: activity.id.toString(),
        type: "cleaner",
        reviewId: activity.id.toString(),
        cleanerName: activity.cleaner_user?.name || "Cleaner",
        locationName: activity.location?.name || "Unknown location",
        startedAt: activity.created_at,
        endedAt: isCompleted ? activity.updated_at : null,
        timestamp: isCompleted ? activity.updated_at : activity.created_at,
        status: activity.status,
        score: activity.score,
        activityType: isCompleted ? (isBreached ? "warning" : "success") : "warning",
        // SLA metadata
        is_sla_enabled: isWashroomSlaOn,
        attempt_no: attemptNo,
        is_retry: isRetry,
        review_type: activity.review_type || (isRetry ? "corrective_retry" : "original"),
        sla_state: escalation?.state || (isBreached ? "OPEN" : "NO_BREACH"),
        sla_tag: slaTag,
        is_breached: isBreached,
      });
    });

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

    const sortedActivities = activities
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, parseInt(limit))
      .map((activity) => ({
        ...activity,
        id: activity.id.toString(),
        timestamp: new Date(activity.timestamp).toISOString(),
      }));

    res.json({
      success: true,
      data: sortedActivities,
    });
  } catch (error) {
    console.error("Activities error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

export const getWashroomHygieneHeatmap = async (req, res) => {
  try {
    const { company_id, start_date, end_date, type_id } = req.query;
    const user = req.user;

    if (!user) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    const startDateTime = new Date(start_date);
    const endDateTime = new Date(end_date);
    endDateTime.setHours(23, 59, 59, 999);

    const company = await prisma.companies.findUnique({
      where: { id: BigInt(company_id) },
      select: { name: true },
    });

    const locationWhereClause = {
      company_id: BigInt(company_id),
      status: true,
      deleted_at: null,
    };

    if (type_id && type_id !== "undefined") {
      locationWhereClause.type_id = BigInt(type_id);
    }

    const SUPER_ADMIN_ROLE_ID = 1;
    if (Number(user.role_id) !== SUPER_ADMIN_ROLE_ID) {
      try {
        const roleFilter = await RBACFilterService.getLocationFilter(
          user,
          "washroom_daily_scores",
        );
        if (roleFilter) {
          Object.assign(locationWhereClause, roleFilter);
        }
      } catch (rbacError) {
        console.error("❌ RBAC Filter Service Error:", rbacError);
        return res.status(500).json({
          status: "error",
          message: "Failed to apply user permissions.",
        });
      }
    }

    const washrooms = await prisma.locations.findMany({
      where: locationWhereClause,
      include: { location_types: { select: { name: true } } },
      orderBy: { name: "asc" },
    });

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
          date_columns: [],
        },
        data: [],
        count: 0,
      });
    }

    const washroomIds = washrooms.map((w) => w.id);

    const assignments = await prisma.cleaner_assignments.findMany({
      where: {
        location_id: { in: washroomIds },
        status: "assigned",
        deleted_at: null,
        role_id: 5,
        cleaner_user: { deleted_at: null },
      },
      include: {
        cleaner_user: { select: { id: true, name: true, phone: true } },
      },
    });

    const assignmentsByLocation = new Map();
    assignments.forEach((assignment) => {
      const locId = assignment.location_id?.toString();
      if (!assignmentsByLocation.has(locId))
        assignmentsByLocation.set(locId, []);
      assignmentsByLocation.get(locId).push({
        id: assignment.cleaner_user.id.toString(),
        name: assignment.cleaner_user.name,
        phone: assignment.cleaner_user.phone,
      });
    });

    // Build SLA-aware filter for cleaner_review (single source of truth)
    const { slaWhereCondition } = await buildSlaAwareReviewFilter(
      company_id,
      washrooms,
    );

    const reviewWhere = {
      company_id: BigInt(company_id),
      status: "completed",
      created_at: { gte: startDateTime, lte: endDateTime },
      ...slaWhereCondition,
    };

    if (!slaWhereCondition.OR) {
      reviewWhere.location_id = { in: washroomIds };
    }

    const reviews = await prisma.cleaner_review.findMany({
      where: reviewWhere,
      select: { location_id: true, score: true, created_at: true },
      orderBy: { created_at: "desc" },
    });

    const scoresByLocationAndDate = new Map();
    const allScoresByLocation = new Map();

    reviews.forEach((record) => {
      if (!record.location_id || record.score == null) return;
      const locId = record.location_id.toString();
      const dateStr = new Date(record.created_at).toISOString().split("T")[0];
      const key = `${locId}_${dateStr}`;

      if (!scoresByLocationAndDate.has(key))
        scoresByLocationAndDate.set(key, []);
      scoresByLocationAndDate.get(key).push({
        score: Number(record.score),
        timestamp: record.created_at,
      });

      if (!allScoresByLocation.has(locId)) allScoresByLocation.set(locId, []);
      allScoresByLocation.get(locId).push(Number(record.score));
    });

    const latestScorePerDay = new Map();
    scoresByLocationAndDate.forEach((scores, key) => {
      const sortedScores = scores.sort(
        (a, b) => new Date(b.timestamp) - new Date(a.timestamp),
      );
      latestScorePerDay.set(key, parseFloat(sortedScores[0].score.toFixed(2)));
    });

    const dateColumns = [];
    const dateColumnsFormatted = [];
    const currentDate = new Date(startDateTime);

    while (currentDate <= endDateTime) {
      const dateStr = currentDate.toISOString().split("T")[0];
      dateColumns.push(dateStr);
      dateColumnsFormatted.push(
        currentDate.toLocaleDateString("en-GB", { day: "numeric" }),
      );
      currentDate.setDate(currentDate.getDate() + 1);
    }

    const reportData = washrooms.map((washroom, index) => {
      const washroomId = washroom.id.toString();
      const assignedCleaners = assignmentsByLocation.get(washroomId) || [];

      const dailyScores = {};
      dateColumns.forEach((dateStr) => {
        const key = `${washroomId}_${dateStr}`;
        const latestScore = latestScorePerDay.get(key);
        dailyScores[dateStr] = latestScore !== undefined ? latestScore : null;
      });

      const allScores = allScoresByLocation.get(washroomId) || [];
      const averageScore =
        allScores.length > 0
          ? parseFloat(
              (
                allScores.reduce((sum, s) => sum + s, 0) / allScores.length
              ).toFixed(2),
            )
          : null;

      return {
        sr_no: index + 1,
        washroom_id: washroomId,
        washroom_name: washroom.name,
        zone_type: washroom.location_types?.name || "N/A",
        assigned_cleaners: assignedCleaners.map((c) => c.name),
        assigned_cleaners_ids: assignedCleaners.map((c) => c.id),
        daily_scores: dailyScores,
        average_score: averageScore,
        address: washroom.address || "N/A",
        city: washroom.city || "N/A",
      };
    });

    const washroomsWithScores = reportData.filter(
      (w) => w.average_score !== null,
    );
    const overallAvgScore =
      washroomsWithScores.length > 0
        ? parseFloat(
            (
              washroomsWithScores.reduce((sum, w) => sum + w.average_score, 0) /
              washroomsWithScores.length
            ).toFixed(2),
          )
        : 0;

    res.status(200).json({
      status: "success",
      message: "Washroom Hygiene Heatmap generated successfully",
      metadata: {
        report_type: "Washroom Hygiene Heatmap",
        organization: company?.name || "Unknown",
        generated_on: new Date().toISOString(),
        total_days: dateColumns.length,
        total_washrooms: reportData.length,
        overall_avg_score: overallAvgScore,
        date_columns: dateColumnsFormatted,
      },
      data: reportData,
      count: reportData.length,
    });
  } catch (error) {
    console.error("❌ Error:", error);
    res
      .status(500)
      .json({ status: "error", message: "Failed to generate heatmap" });
  }
};
