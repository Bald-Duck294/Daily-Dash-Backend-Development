// import prisma from "../config/database.js";
import prisma from "../config/prismaClient.mjs";
import RBACFilterService from "../utils/rbacFilterService.js";

import { serializeBigInt } from "../utils/serializer.js";
export const getZoneWiseReport = async (req, res) => {
  try {
    const { company_id, type_id, start_date, end_date, fields, review_filter } =
      req.query;

    const user = req.user; // ✅ From verifyToken middleware

    console.log("Report params:", {
      company_id,
      type_id,
      start_date,
      end_date,
      review_filter,
      user_role_id: user?.role_id,
    });

    if (!company_id) {
      return res.status(400).json({
        status: "error",
        message: "company_id is required",
      });
    }

    // ✅ BUILD LOCATION WHERE CLAUSE WITH RBAC FILTER
    // This handles both admin (all locations) and supervisor (assigned locations only)
    const locationWhereClause = {
      company_id: BigInt(company_id),
    };

    // ✅ Apply RBAC location filter (same as cleaner_review)
    // For Supervisor (role_id=3): filters to only their assigned locations
    // For Admin/Super-Admin: no filter (all locations)
    const roleFilter = await RBACFilterService.getLocationFilter(
      user,
      "location_report",
    );
    Object.assign(locationWhereClause, roleFilter);

    if (type_id) {
      locationWhereClause.type_id = BigInt(type_id);
    }

    const requestedFields = fields ? fields.split(",") : [];

    // Fetch locations with RBAC filtering
    const locations = await prisma.locations.findMany({
      where: locationWhereClause,
      include: {
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
            phone: true,
            email: true,
          },
        },
      },
      orderBy: {
        name: "asc",
      },
    });

    console.log(
      `Found ${locations.length} locations for company ${company_id} (with RBAC filter for role ${user?.role_id})`,
    );

    // Build where clause for cleaner reviews
    // ❌ NO supervisor_id filter needed - location filtering already restricts this
    const reviewWhereClause = {
      company_id: BigInt(company_id),
      status: "completed",
    };

    // Filter by date range
    if (start_date || end_date) {
      reviewWhereClause.created_at = {};
      if (start_date) {
        reviewWhereClause.created_at.gte = new Date(start_date);
      }
      if (end_date) {
        const endDateTime = new Date(end_date);
        endDateTime.setHours(23, 59, 59, 999);
        reviewWhereClause.created_at.lte = endDateTime;
      }
    }

    // Get location IDs from RBAC-filtered locations
    const locationIds = locations.map((loc) => loc.id);

    // ✅ Fetch reviews for RBAC-filtered locations only
    // If supervisor: only gets reviews for their assigned cleaners' locations
    // If admin: gets all reviews
    const cleanerReviews = await prisma.cleaner_review.findMany({
      where: {
        ...reviewWhereClause,
        location_id: {
          in: locationIds, // ✅ This restricts by RBAC-filtered locations
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
        company: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    console.log(
      `Found ${cleanerReviews.length} cleaner reviews from RBAC-filtered locations`,
    );

    // Fetch hygiene scores for these locations
    const hygieneScoresWhereClause = {
      location_id: {
        in: locationIds, // ✅ Also filtered by RBAC
      },
    };

    if (start_date || end_date) {
      hygieneScoresWhereClause.inspected_at = {};
      if (start_date) {
        hygieneScoresWhereClause.inspected_at.gte = new Date(start_date);
      }
      if (end_date) {
        const endDateTime = new Date(end_date);
        endDateTime.setHours(23, 59, 59, 999);
        hygieneScoresWhereClause.inspected_at.lte = endDateTime;
      }
    }

    const hygieneScoresData = await prisma.hygiene_scores.findMany({
      where: hygieneScoresWhereClause,
      select: {
        location_id: true,
        score: true,
        inspected_at: true,
      },
      orderBy: {
        inspected_at: "desc",
      },
    });

    console.log(`Found ${hygieneScoresData.length} hygiene scores`);

    // Group data by location
    const reviewsByLocation = {};
    const hygieneScoresByLocation = {};

    // Group cleaner reviews
    for (const review of cleanerReviews) {
      const locationId = review.location_id?.toString();
      if (!locationId) continue;

      if (!reviewsByLocation[locationId]) {
        reviewsByLocation[locationId] = [];
      }
      reviewsByLocation[locationId].push(review);
    }

    // Group hygiene scores
    for (const hygieneScore of hygieneScoresData) {
      const locationId = hygieneScore.location_id?.toString();
      if (!locationId) continue;

      if (!hygieneScoresByLocation[locationId]) {
        hygieneScoresByLocation[locationId] = [];
      }
      hygieneScoresByLocation[locationId].push(
        parseFloat(hygieneScore.score || 0),
      );
    }

    // Build report data for ALL RBAC-filtered locations
    const reportData = [];

    for (const location of locations) {
      const locationId = location.id.toString();
      const reviews = reviewsByLocation[locationId] || [];
      const hygieneScores = hygieneScoresByLocation[locationId] || [];

      // Apply review filter logic
      const hasReviews = reviews.length > 0;

      if (review_filter === "with_reviews" && !hasReviews) {
        continue;
      }

      if (review_filter === "without_reviews" && hasReviews) {
        continue;
      }

      // Get latest review (if exists)
      const latestReview = reviews[0];

      // Calculate average rating from hygiene scores
      const avgRating =
        hygieneScores.length > 0
          ? hygieneScores.reduce((sum, score) => sum + score, 0) /
            hygieneScores.length
          : 0;

      // Current score from latest cleaner review
      const currentScore = latestReview?.score || 0;

      // Get unique cleaners
      const uniqueCleaners = new Set(
        reviews.map((r) => r.cleaner_user_id?.toString()).filter(Boolean),
      );
      console.log(uniqueCleaners, "unique cleaners");
      const reportItem = {
        // Location details
        location_id: locationId,
        location_name: location.name || "Unknown",
        address: location.address || "N/A",
        city: location.city || "N/A",
        state: location.state || "N/A",
        district: location.dist || "N/A",
        zone: location.location_types?.name || "N/A",
        latitude: location.latitude || null,
        longitude: location.longitude || null,

        // Cleaner details (from latest review if exists)
        cleaner_id: latestReview?.cleaner_user_id?.toString() || null,
        cleaner_name: latestReview?.cleaner_user?.name || "Not Assigned",
        cleaner_phone: latestReview?.cleaner_user?.phone || "N/A",

        // Scores
        current_score: parseFloat(currentScore.toFixed(2)),
        average_rating: parseFloat(avgRating.toFixed(2)),
        hygiene_score_count: hygieneScores.length,

        // Review details
        review_status: latestReview?.status || "No Reviews",
        last_review_date: latestReview?.created_at || null,
        total_reviews: reviews.length,
        unique_cleaners: uniqueCleaners.size,
        has_reviews: hasReviews,

        // Company details
        company_name:
          latestReview?.company?.name || location.companies?.name || "N/A",
        facility_company: location.facility_companies?.name || "Not Assigned",
        facility_company_id:
          location.facility_companies?.id?.toString() || null,
        facility_company_phone: location.facility_companies?.phone || null,
        facility_company_email: location.facility_companies?.email || null,

        // Optional fields
        ...(requestedFields.includes("pincode") && {
          pincode: location.pincode || "N/A",
        }),
        ...(requestedFields.includes("tasks") && {
          tasks: latestReview?.tasks || [],
        }),
        ...(requestedFields.includes("comments") && {
          initial_comment: latestReview?.initial_comment || "",
          final_comment: latestReview?.final_comment || "",
        }),
        ...(requestedFields.includes("photos") && {
          before_photos: latestReview?.before_photo || [],
          after_photos: latestReview?.after_photo || [],
        }),
      };

      reportData.push(reportItem);
    }

    // Sort by current score (descending)
    reportData.sort((a, b) => b.current_score - a.current_score);

    // Get company name
    const companyName = await prisma.companies.findUnique({
      where: { id: BigInt(company_id) },
      select: { name: true },
    });

    // ✅ Add user role info to metadata
    const reportMetadata = {
      organization: companyName?.name || "N/A",
      zone: type_id
        ? locations[0]?.location_types?.name || "Selected Zone"
        : "All Zones",
      date_range: {
        start: start_date || "Beginning",
        end: end_date || "Now",
      },
      report_type: "Zone-wise Cleaner Activity Report",
      generated_on: new Date().toISOString(),

      // ✅ Add RBAC info
      user_role_id: user?.role_id,
      user_role_name: user?.role?.name || "Unknown",
      generated_by_user_id: user?.id,

      // Filter information
      review_filter: review_filter || "all",
      filter_description:
        review_filter === "with_reviews"
          ? "Showing only locations with reviews"
          : review_filter === "without_reviews"
            ? "Showing only locations without reviews"
            : "Showing all locations",

      // Statistics
      total_locations: reportData.length,
      total_reviews: reportData.reduce(
        (sum, item) => sum + item.total_reviews,
        0,
      ),
      locations_with_reviews: reportData.filter((item) => item.has_reviews)
        .length,
      locations_without_reviews: reportData.filter((item) => !item.has_reviews)
        .length,

      // Averages
      average_score_overall:
        reportData.length > 0
          ? parseFloat(
              (
                reportData.reduce((sum, item) => sum + item.current_score, 0) /
                reportData.length
              ).toFixed(2),
            )
          : 0,
      average_rating_overall:
        reportData.length > 0
          ? parseFloat(
              (
                reportData.reduce((sum, item) => sum + item.average_rating, 0) /
                reportData.length
              ).toFixed(2),
            )
          : 0,
    };

    res.status(200).json({
      status: "success",
      message: "Report generated successfully",
      metadata: reportMetadata,
      data: reportData,
      count: reportData.length,
    });
  } catch (error) {
    console.error("Error generating zone-wise report:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to generate report",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

const convertBigIntToString = (obj) => {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === "bigint") {
    return obj.toString();
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => convertBigIntToString(item));
  }

  if (typeof obj === "object") {
    const converted = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        converted[key] = convertBigIntToString(obj[key]);
      }
    }
    return converted;
  }

  return obj;
};

export const getDailyCleaningReport = async (req, res) => {
  console.log("🔍 Generating Daily Cleaning Report");
  try {
    const {
      company_id,
      start_date,
      end_date,
      location_id,
      cleaner_id,
      status_filter,
      type_id,
    } = req.query;
    const user = req.user; // ✅ From verifyToken middleware

    console.log("📥 Request Params:", {
      company_id,
      location_id,
      cleaner_id,
      type_id,
      user_role_id: user?.role_id,
    });

    if (!company_id) {
      return res
        .status(400)
        .json({ status: "error", message: "company_id is required" });
    }

    // Fetch company details
    const company = await prisma.companies.findUnique({
      where: { id: BigInt(company_id) },
      select: { name: true },
    });

    if (!company) {
      return res.status(404).json({
        status: "error",
        message: "Company not found",
      });
    }

    // ✅ STEP 1: Get RBAC-filtered locations for this user
    const locationWhereClause = {
      company_id: BigInt(company_id),
      status: true,
      deleted_at: null,
    };

    const roleFilter = await RBACFilterService.getLocationFilter(
      user,
      "daily_cleaning_report",
    );
    Object.assign(locationWhereClause, roleFilter);

    // If specific location_id is provided, add it to filter
    if (location_id && location_id !== "undefined") {
      locationWhereClause.id = BigInt(location_id);
    }

    // ✅ Add type_id filter if provided
    if (type_id && type_id !== "undefined") {
      locationWhereClause.type_id = BigInt(type_id);
    }

    const allowedLocations = await prisma.locations.findMany({
      where: locationWhereClause,
      select: { id: true },
    });

    const allowedLocationIds = allowedLocations.map((loc) => loc.id);

    console.log(`✅ User has access to ${allowedLocationIds.length} locations`);

    if (allowedLocationIds.length === 0) {
      return res.status(200).json({
        status: "success",
        message: "No locations accessible to your role",
        data: [],
        count: 0,
        metadata: {
          report_type: "Daily Cleaning Report",
          generated_on: new Date().toISOString(),
          organization: company.name,
          user_role_id: user?.role_id,
          date_range: {
            start: start_date || "Beginning",
            end: end_date || "Now",
          },
          total_tasks: 0,
          completed_tasks: 0,
          ongoing_tasks: 0,
        },
      });
    }

    // ✅ STEP 2: Build WHERE clause for cleaner_review with RBAC location filter
    const whereClause = {
      company_id: BigInt(company_id),
      location_id: { in: allowedLocationIds }, // ✅ Only RBAC-filtered locations
    };

    if (cleaner_id) whereClause.cleaner_user_id = BigInt(cleaner_id);
    if (status_filter && status_filter !== "all")
      whereClause.status = status_filter;

    // Date range filtering
    if (start_date || end_date) {
      whereClause.created_at = {};
      if (start_date && end_date) {
        let startDateTime = new Date(start_date);
        let endDateTime = new Date(end_date);
        if (startDateTime > endDateTime) {
          [startDateTime, endDateTime] = [endDateTime, startDateTime];
        }
        endDateTime.setHours(23, 59, 59, 999);
        whereClause.created_at.gte = startDateTime;
        whereClause.created_at.lte = endDateTime;
      } else if (start_date) {
        whereClause.created_at.gte = new Date(start_date);
      } else if (end_date) {
        const endDateTime = new Date(end_date);
        endDateTime.setHours(23, 59, 59, 999);
        whereClause.created_at.lte = endDateTime;
      }
    }

    // Fetch all matching cleaner review tasks
    const tasks = await prisma.cleaner_review.findMany({
      where: whereClause,
      include: {
        cleaner_user: { select: { name: true, phone: true } },
        location: {
          select: {
            name: true,
            location_types: { select: { name: true } },
          },
        },
      },
      orderBy: { created_at: "desc" },
    });

    console.log(`✅ Fetched ${tasks.length} tasks for RBAC-filtered locations`);

    if (tasks.length === 0) {
      return res.status(200).json({
        status: "success",
        message: "No cleanings found",
        data: [],
        count: 0,
        metadata: {
          report_type: "Daily Cleaning Report",
          generated_on: new Date().toISOString(),
          organization: company.name,
          user_role_id: user?.role_id,
          date_range: {
            start: start_date || "Beginning",
            end: end_date || "Now",
          },
          total_tasks: 0,
          completed_tasks: 0,
          ongoing_tasks: 0,
        },
      });
    }

    // ✅ Get all unique location IDs from the tasks (already RBAC-filtered)
    const locationIds = [
      ...new Set(tasks.map((task) => task.location_id).filter(Boolean)),
    ];

    // ✅ Calculate average rating per location from cleaner_review scores
    const reviewsByLocation = new Map();

    tasks.forEach((task) => {
      const locId = task.location_id?.toString();
      if (!locId || !task.score) return;

      if (!reviewsByLocation.has(locId)) {
        reviewsByLocation.set(locId, []);
      }
      reviewsByLocation.get(locId).push(Number(task.score));
    });

    // ✅ Calculate average score per location from cleaner reviews
    const averageScoresMap = new Map();
    reviewsByLocation.forEach((scores, locId) => {
      const avgScore =
        scores.reduce((sum, score) => sum + score, 0) / scores.length;
      averageScoresMap.set(locId, avgScore);
    });

    console.log(
      "📈 Average Scores by Location:",
      Object.fromEntries(averageScoresMap),
    );

    // ✅ Transform the data with average ratings per washroom
    const reportData = tasks.map((task) => {
      const startTime = new Date(task.created_at);
      const endTime =
        task.status === "completed" ? new Date(task.updated_at) : null;
      const now = new Date();

      const durationMinutes = endTime
        ? Math.round((endTime - startTime) / 60000)
        : Math.round((now - startTime) / 60000);

      const aiScore = task.score || 0;

      // ✅ Get the average rating for this location from cleaner reviews
      const avgLocationRating =
        averageScoresMap.get(task.location_id?.toString()) || 0;

      return {
        task_id: task.id.toString(),
        cleaner_name: task.cleaner_user?.name || "Unknown",
        cleaner_phone: task.cleaner_user?.phone || "N/A",
        washroom_name: task.location?.name || "Unknown",
        washroom_full_name: `${task.location?.name || "Unknown"}${task.location?.location_types?.name ? ` (${task.location.location_types.name})` : ""}`,
        task_start_time: task.created_at,
        task_end_time: endTime,
        duration_minutes: durationMinutes,
        before_photo: task.before_photo || [],
        after_photo: task.after_photo || [],

        // ✅ AI score for this specific task
        ai_score: parseFloat(aiScore.toFixed(2)),

        // ✅ Average rating for this washroom (from all reviews)
        washroom_avg_rating: parseFloat(avgLocationRating.toFixed(2)),

        status: task.status,
      };
    });

    const { length: total_tasks } = reportData;
    const completed_tasks = reportData.filter(
      (t) => t.status === "completed",
    ).length;
    const ongoing_tasks = total_tasks - completed_tasks;

    // ✅ Calculate overall average AI score
    const overall_avg_ai_score =
      total_tasks > 0
        ? (
            reportData.reduce((sum, t) => sum + t.ai_score, 0) / total_tasks
          ).toFixed(2)
        : 0;

    const reportMetadata = {
      report_type: "Daily Cleaning Report",
      generated_on: new Date().toISOString(),
      organization: company.name,
      user_role_id: user?.role_id,
      date_range: { start: start_date || "Beginning", end: end_date || "Now" },
      total_tasks,
      completed_tasks,
      ongoing_tasks,
      overall_avg_ai_score: parseFloat(overall_avg_ai_score),
      total_locations: locationIds.length,
    };

    console.log("✅ Daily Cleaning Report generated:", reportMetadata);

    res.status(200).json({
      status: "success",
      message: "Daily Cleaning report generated successfully",
      metadata: reportMetadata,
      data: reportData,
      count: total_tasks,
    });
  } catch (error) {
    console.error("❌ Error generating daily cleaning report:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to generate daily cleaning report",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const getWashroomReport = async (req, res) => {
  console.log("🔍 Generating Washroom Report (Single or All)");
  try {
    let {
      company_id,
      start_date,
      end_date,
      location_id,
      cleaner_id,
      status_filter,
      type_id,
    } = req.query;

    const user = req.user; // ✅ From verifyToken middleware

    console.log("📥 Request Params:", {
      company_id,
      start_date,
      end_date,
      location_id,
      user_role_id: user?.role_id,
    });

    // Validation
    if (!company_id) {
      return res.status(400).json({
        status: "error",
        message: "company_id is required",
      });
    }

    // Fetch company details
    const company = await prisma.companies.findUnique({
      where: { id: BigInt(company_id) },
      select: { name: true },
    });

    if (!company) {
      return res.status(404).json({
        status: "error",
        message: "Company not found",
      });
    }

    // ✅ STEP 1: Get RBAC-filtered locations for this user
    const locationWhereClause = {
      company_id: BigInt(company_id),
      status: true,
      deleted_at: null,
    };

    const roleFilter = await RBACFilterService.getLocationFilter(
      user,
      "washroom_report",
    );
    Object.assign(locationWhereClause, roleFilter);

    // If specific location_id is provided, add it to filter
    if (location_id && location_id !== "undefined") {
      locationWhereClause.id = BigInt(location_id);
    }

    // Add type_id filter if provided
    if (type_id && type_id !== "undefined") {
      locationWhereClause.type_id = BigInt(type_id);
    }

    const allowedLocations = await prisma.locations.findMany({
      where: locationWhereClause,
      select: { id: true },
    });

    const allowedLocationIds = allowedLocations.map((loc) => loc.id);

    console.log(`✅ User has access to ${allowedLocationIds.length} locations`);

    if (allowedLocationIds.length === 0) {
      return res.status(200).json({
        status: "success",
        message: "No locations accessible to your role",
        data: [],
        count: 0,
        metadata: {
          report_type: location_id
            ? "Single Washroom Report"
            : "All Washrooms Report",
          organization: company.name,
          generated_on: new Date().toISOString(),
          user_role_id: user?.role_id,
        },
      });
    }

    // Determine report type
    const isSingleWashroom = !!location_id;
    const reportType = isSingleWashroom
      ? "Single Washroom Report"
      : "All Washrooms Report";

    console.log(`📊 Report Type: ${reportType}`);

    // ✅ STEP 2: Build WHERE clause for cleaner_review (with RBAC location filter)
    const whereClause = {
      company_id: BigInt(company_id),
      location_id: { in: allowedLocationIds }, // ✅ Only RBAC-filtered locations
      ...(cleaner_id && { cleaner_user_id: BigInt(cleaner_id) }),
      ...(status_filter &&
        status_filter !== "all" && { status: status_filter }),
    };

    // Date range filtering with proper validation
    if (start_date || end_date) {
      whereClause.created_at = {};

      if (start_date && end_date) {
        let startDateTime = new Date(start_date);
        let endDateTime = new Date(end_date);

        // Auto-swap if dates are reversed
        if (startDateTime > endDateTime) {
          console.warn("⚠️ Dates reversed, swapping...");
          [startDateTime, endDateTime] = [endDateTime, startDateTime];
        }

        endDateTime.setHours(23, 59, 59, 999);

        whereClause.created_at.gte = startDateTime;
        whereClause.created_at.lte = endDateTime;

        console.log("📅 Adjusted Date Range:", {
          from: startDateTime.toISOString(),
          to: endDateTime.toISOString(),
        });
      } else if (start_date) {
        whereClause.created_at.gte = new Date(start_date);
      } else if (end_date) {
        const endDateTime = new Date(end_date);
        endDateTime.setHours(23, 59, 59, 999);
        whereClause.created_at.lte = endDateTime;
      }
    }

    console.log(
      "🔎 Final Where Clause:",
      JSON.stringify(
        whereClause,
        (key, value) => (typeof value === "bigint" ? value.toString() : value),
        2,
      ),
    );

    // Fetch all cleaning tasks (already filtered by RBAC locations)
    const tasks = await prisma.cleaner_review.findMany({
      where: whereClause,
      include: {
        cleaner_user: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        location: {
          select: {
            id: true,
            name: true,
            address: true,
            city: true,
            state: true,
            pincode: true,
            location_types: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { created_at: "desc" },
    });

    console.log(
      `✅ Fetched ${tasks.length} cleaning tasks for RBAC-filtered locations`,
    );

    // Debug if no tasks found
    if (tasks.length === 0) {
      const totalCompanyTasks = await prisma.cleaner_review.count({
        where: {
          company_id: BigInt(company_id),
          location_id: { in: allowedLocationIds },
        },
      });
      console.log(
        `ℹ️ Total tasks in accessible locations: ${totalCompanyTasks}`,
      );
    }

    // Handle empty results
    if (tasks.length === 0) {
      return res.status(200).json({
        status: "success",
        message: "No tasks found",
        data: [],
        count: 0,
        metadata: {
          report_type: reportType,
          dynamic_report_name: reportType.replace(/\s+/g, "_"),
          is_single_washroom: isSingleWashroom,
          generated_on: new Date().toISOString(),
          organization: company.name,
          user_role_id: user?.role_id,
          date_range: {
            start: start_date || "Beginning",
            end: end_date || "Now",
          },
          ...(isSingleWashroom
            ? {
                washroom_name: null,
                washroom_address: null,
                washroom_type: null,
                total_cleanings: 0,
                completed: 0,
                ongoing: 0,
                avg_rating: 0,
                avg_images_uploaded: 0,
                avg_cleaning_duration: 0,
                score_trend_last_7_days: [],
              }
            : {
                total_washrooms: 0,
                avg_rating: 0,
                completed: 0,
                ongoing: 0,
                avg_cleaning_duration: 0,
              }),
        },
      });
    }

    // ✅ Get unique location IDs (already RBAC-filtered)
    const locationIds = [
      ...new Set(tasks.map((task) => task.location_id).filter(Boolean)),
    ];

    // ✅ Fetch hygiene scores for RBAC-filtered locations
    const hygieneScoresRaw = await prisma.hygiene_scores.findMany({
      where: {
        location_id: { in: locationIds },
        ...(start_date || end_date
          ? {
              created_at: whereClause.created_at,
            }
          : {}),
      },
      select: {
        location_id: true,
        score: true,
        created_at: true,
      },
    });

    console.log(
      `📊 Found ${hygieneScoresRaw.length} hygiene scores for ${locationIds.length} locations`,
    );

    // ✅ Group hygiene scores by location and calculate averages
    const hygieneScoresByLocation = new Map();
    hygieneScoresRaw.forEach((record) => {
      const locId = record.location_id?.toString();
      if (!locId || !record.score) return;

      if (!hygieneScoresByLocation.has(locId)) {
        hygieneScoresByLocation.set(locId, []);
      }
      hygieneScoresByLocation.get(locId).push(Number(record.score));
    });

    // ✅ Calculate average hygiene score per location
    const averageScoresMap = new Map();
    hygieneScoresByLocation.forEach((scores, locId) => {
      const avgScore =
        scores.reduce((sum, score) => sum + score, 0) / scores.length;
      averageScoresMap.set(locId, avgScore);
    });

    console.log("📈 Average Scores Map:", Object.fromEntries(averageScoresMap));

    // ============================================
    // ✅ SINGLE WASHROOM REPORT
    // ============================================
    if (isSingleWashroom) {
      const washroomInfo = tasks[0]?.location;

      // Generate dynamic report name
      const washroomName = washroomInfo?.name || "Unknown_Washroom";
      const isSingleDate = start_date === end_date;
      const dynamicReportName = isSingleDate
        ? `${washroomName.replace(/\s+/g, "_")}_Daily_Report`
        : `${washroomName.replace(/\s+/g, "_")}_Report`;

      // Transform cleaning records
      const cleanings = tasks.map((task) => {
        const startTime = new Date(task.created_at);
        const endTime =
          task.status === "completed" ? new Date(task.updated_at) : null;
        const now = new Date();

        const durationMinutes = endTime
          ? Math.round((endTime - startTime) / 60000)
          : Math.round((now - startTime) / 60000);

        const aiScore = task.score || 0;
        const finalRating =
          averageScoresMap.get(task.location_id?.toString()) || 0;

        return {
          id: task.id.toString(),
          cleaner_name: task.cleaner_user?.name || "Unknown",
          cleaner_phone: task.cleaner_user?.phone || "N/A",
          start_time: task.created_at,
          end_time: endTime,
          status: task.status,
          rating: parseFloat(aiScore.toFixed(2)),
          before_image_count: task.before_photo?.length || 0,
          after_image_count: task.after_photo?.length || 0,
          before_images: task.before_photo || [],
          after_images: task.after_photo || [],
          duration_minutes: durationMinutes,
          final_rating: parseFloat(finalRating.toFixed(2)),
        };
      });

      // Calculate performance metrics
      const completed = cleanings.filter(
        (c) => c.status === "completed",
      ).length;
      const ongoing = cleanings.length - completed;
      const completedCleanings = cleanings.filter(
        (c) => c.status === "completed",
      );

      // ✅ Use hygiene_scores average
      const locId = location_id.toString();
      const avgRating = averageScoresMap.get(locId) || 0;

      console.log(
        `✅ Single Washroom Avg Rating: ${avgRating.toFixed(2)} (from hygiene_scores)`,
      );

      const avgImagesUploaded =
        completedCleanings.length > 0
          ? completedCleanings.reduce(
              (sum, c) => sum + c.before_image_count + c.after_image_count,
              0,
            ) / completedCleanings.length
          : 0;

      const avgCleaningDuration =
        completedCleanings.length > 0
          ? Math.round(
              completedCleanings.reduce(
                (sum, c) => sum + c.duration_minutes,
                0,
              ) / completedCleanings.length,
            )
          : 0;

      // Calculate 7-day score trend
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const scoreTrendData = await prisma.hygiene_scores.findMany({
        where: {
          location_id: BigInt(location_id),
          created_at: { gte: sevenDaysAgo },
        },
        select: {
          created_at: true,
          score: true,
        },
        orderBy: { created_at: "asc" },
      });

      // Group by date
      const trendMap = new Map();
      scoreTrendData.forEach((item) => {
        if (!item.score) return;
        const dateStr = new Date(item.created_at).toISOString().split("T")[0];
        if (!trendMap.has(dateStr)) {
          trendMap.set(dateStr, []);
        }
        trendMap.get(dateStr).push(Number(item.score));
      });

      const scoreTrendLast7Days = Array.from(trendMap.entries()).map(
        ([date, scores]) => ({
          date,
          score: parseFloat(
            (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1),
          ),
        }),
      );

      // Single Washroom Response
      return res.status(200).json({
        status: "success",
        message: "Single Washroom report generated successfully",
        metadata: {
          report_type: "Single Washroom Report",
          dynamic_report_name: dynamicReportName,
          is_single_washroom: true,
          generated_on: new Date().toISOString(),
          organization: company.name,
          user_role_id: user?.role_id,
          date_range: {
            start: start_date || "Beginning",
            end: end_date || "Now",
          },
          // Washroom info
          washroom_id: washroomInfo?.id.toString(),
          washroom_name: washroomInfo?.name || "Unknown",
          washroom_address: washroomInfo?.address || "N/A",
          washroom_type: washroomInfo?.location_types?.name || "N/A",
          washroom_city: washroomInfo?.city || "N/A",
          washroom_state: washroomInfo?.state || "N/A",
          // Performance metrics
          total_cleanings: cleanings.length,
          completed,
          ongoing,
          avg_rating: parseFloat(avgRating.toFixed(2)),
          avg_images_uploaded: parseFloat(avgImagesUploaded.toFixed(2)),
          avg_cleaning_duration: avgCleaningDuration,
          score_trend_last_7_days: scoreTrendLast7Days,
        },
        data: cleanings,
        count: cleanings.length,
      });
    }

    // ============================================
    // ✅ ALL WASHROOMS REPORT
    // ============================================
    else {
      // Group tasks by washroom
      const washroomMap = new Map();

      tasks.forEach((task) => {
        const locId = task.location_id?.toString();
        if (!locId) return;

        if (!washroomMap.has(locId)) {
          washroomMap.set(locId, {
            location: task.location,
            cleanings: [],
          });
        }
        washroomMap.get(locId).cleanings.push(task);
      });

      // Transform to washroom summary array
      const washrooms = Array.from(washroomMap.entries()).map(
        ([locId, data]) => {
          const { location, cleanings } = data;

          // Get latest cleaning
          const latestCleaning = cleanings[0];
          // const completedCleanings = cleanings.filter(c => c.status === 'completed');
          const completedCleanings = latestCleaning;

          // console.log(completedCleanings, "completd cleanings")
          // ✅ Use hygiene_scores average
          const avgRating = averageScoresMap.get(locId) || 0;

          const totalImages = cleanings.reduce(
            (sum, c) =>
              sum +
              (c.before_photo?.length || 0) +
              (c.after_photo?.length || 0),
            0,
          );

          const avgDuration =
            completedCleanings.length > 0
              ? Math.round(
                  completedCleanings.reduce((sum, c) => {
                    const start = new Date(c.created_at);
                    const end = new Date(c.updated_at);
                    return sum + Math.round((end - start) / 60000);
                  }, 0) / completedCleanings.length,
                )
              : 0;

          return {
            id: locId,
            name: location?.name || "Unknown",
            address: location?.address || "N/A",
            city: location?.city || "N/A",
            state: location?.state || "N/A",
            type: location?.location_types?.name || "N/A",
            cleaner_name: latestCleaning?.cleaner_user?.name || "N/A",
            start_time: latestCleaning?.created_at,
            end_time:
              latestCleaning?.status === "completed"
                ? latestCleaning?.updated_at
                : null,
            status: latestCleaning?.status || "pending",
            avg_rating: parseFloat(avgRating.toFixed(2)),
            final_rating: parseFloat(avgRating.toFixed(2)),
            image_count: totalImages,
            last_cleaned_on: latestCleaning?.created_at,
            total_cleanings: cleanings.length,
            completed_cleanings: completedCleanings.length,
            avg_duration: avgDuration,
          };
        },
      );

      // Calculate overall metrics
      const totalCompleted = tasks.filter(
        (t) => t.status === "completed",
      ).length;
      const totalOngoing = tasks.length - totalCompleted;

      // ✅ Average of location averages
      const overallAvgRating =
        washrooms.length > 0
          ? washrooms.reduce((sum, w) => sum + w.avg_rating, 0) /
            washrooms.length
          : 0;

      const overallAvgDuration =
        washrooms.length > 0
          ? Math.round(
              washrooms.reduce((sum, w) => sum + w.avg_duration, 0) /
                washrooms.length,
            )
          : 0;

      console.log(
        `📊 All Washrooms: ${washrooms.length} found, Avg Rating: ${overallAvgRating.toFixed(2)}`,
      );

      // All Washrooms Response
      return res.status(200).json({
        status: "success",
        message: "All Washrooms report generated successfully",
        metadata: {
          report_type: "All Washrooms Report",
          dynamic_report_name: "All_Washrooms_Report",
          is_single_washroom: false,
          generated_on: new Date().toISOString(),
          organization: company.name,
          user_role_id: user?.role_id,
          date_range: {
            start: start_date || "Beginning",
            end: end_date || "Now",
          },
          // Overall metrics
          total_washrooms: washrooms.length,
          avg_rating: parseFloat(overallAvgRating.toFixed(2)),
          completed: totalCompleted,
          ongoing: totalOngoing,
          avg_cleaning_duration: overallAvgDuration,
          total_cleanings: tasks.length,
        },
        data: washrooms,
        count: washrooms.length,
      });
    }
  } catch (error) {
    console.error("❌ Error generating washroom report:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to generate washroom report",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const getCleanerReport = async (req, res) => {
  console.log("🔍 Generating Cleaner Report (Single or All)");
  try {
    let { company_id, start_date, end_date, cleaner_id, status_filter } =
      req.query;

    const user = req.user; // ✅ From verifyToken middleware

    console.log("Cleaner Report params:", {
      company_id,
      cleaner_id,
      start_date,
      end_date,
      user_role_id: user?.role_id,
    });

    // Validation
    if (!company_id) {
      return res.status(400).json({
        status: "error",
        message: "company_id is required",
      });
    }

    // Fetch company details
    const company = await prisma.companies.findUnique({
      where: { id: BigInt(company_id) },
      select: { name: true },
    });

    if (!company) {
      return res.status(404).json({
        status: "error",
        message: "Company not found",
      });
    }

    // ✅ STEP 1: Get RBAC-filtered locations for this user
    const locationWhereClause = {
      company_id: BigInt(company_id),
      status: true,
      deleted_at: null,
    };

    const roleFilter = await RBACFilterService.getLocationFilter(
      user,
      "cleaner_report",
    );
    Object.assign(locationWhereClause, roleFilter);

    const allowedLocations = await prisma.locations.findMany({
      where: locationWhereClause,
      select: { id: true },
    });

    const allowedLocationIds = allowedLocations.map((loc) => loc.id);

    console.log(`✅ User has access to ${allowedLocationIds.length} locations`);

    if (allowedLocationIds.length === 0) {
      return res.status(200).json({
        status: "success",
        message: "No locations assigned to your role",
        data: [],
        metadata: {
          report_type: isSingleCleaner
            ? "Single Cleaner Report"
            : "All Cleaners Report",
          organization: company.name,
          generated_on: new Date().toISOString(),
        },
      });
    }

    // ✅ STEP 2: Build WHERE clause for cleaner_review (with RBAC location filter)
    const whereClause = {
      company_id: BigInt(company_id),
      location_id: { in: allowedLocationIds }, // ✅ Only RBAC-filtered locations
      ...(cleaner_id && { cleaner_user_id: BigInt(cleaner_id) }),
      ...(status_filter &&
        status_filter !== "all" && { status: status_filter }),
    };

    // Date range filtering
    if (start_date || end_date) {
      whereClause.created_at = {};
      if (start_date && end_date) {
        let startDateTime = new Date(start_date);
        let endDateTime = new Date(end_date);
        if (startDateTime > endDateTime) {
          [startDateTime, endDateTime] = [endDateTime, startDateTime];
        }
        endDateTime.setHours(23, 59, 59, 999);
        whereClause.created_at.gte = startDateTime;
        whereClause.created_at.lte = endDateTime;
      } else if (start_date) {
        whereClause.created_at.gte = new Date(start_date);
      } else if (end_date) {
        const endDateTime = new Date(end_date);
        endDateTime.setHours(23, 59, 59, 999);
        whereClause.created_at.lte = endDateTime;
      }
    }

    const isSingleCleaner = !!cleaner_id;
    const reportType = isSingleCleaner
      ? "Single Cleaner Report"
      : "All Cleaners Report";

    // Fetch cleaning tasks (already filtered by RBAC locations)
    const tasks = await prisma.cleaner_review.findMany({
      where: whereClause,
      include: {
        cleaner_user: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        location: {
          select: {
            id: true,
            name: true,
            address: true,
            city: true,
            state: true,
            location_types: { select: { name: true } },
          },
        },
      },
      orderBy: { created_at: "desc" },
    });

    console.log(`✅ Found ${tasks.length} tasks for RBAC-filtered locations`);

    // ✅ STEP 3: Get unique cleaner user IDs from filtered tasks
    const assignedUserIds = [
      ...new Set(tasks.map((task) => task?.cleaner_user?.id).filter(Boolean)),
    ];

    // ✅ STEP 4: Get assigned washrooms (only common locations between supervisor and cleaner)
    const getUserLocAssignments = async (userIds) => {
      if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
        return new Map();
      }

      try {
        const assignments = await prisma.cleaner_assignments.findMany({
          where: {
            cleaner_user_id: { in: userIds },
            location_id: { in: allowedLocationIds }, // ✅ Only show common locations
            status: "assigned",
            deleted_at: null,
            locations: {
              status: true,
              deleted_at: null,
            },
          },
          select: {
            id: true,
            cleaner_user_id: true,
            location_id: true,
            locations: {
              select: {
                id: true,
                name: true,
                address: true,
              },
            },
          },
        });

        console.log(
          `✅ Found ${assignments.length} assignments (common locations only)`,
        );

        const assignmentMap = new Map();
        assignments.forEach((assignment) => {
          const userId = assignment.cleaner_user_id?.toString();
          if (!assignmentMap.has(userId)) {
            assignmentMap.set(userId, []);
          }
          if (assignment.locations) {
            assignmentMap.get(userId).push({
              id: assignment.locations.id.toString(),
              name: assignment.locations.name,
              address: assignment.locations.address || "N/A",
            });
          }
        });

        return assignmentMap;
      } catch (err) {
        console.error("❌ Error fetching assignments:", err);
        return new Map();
      }
    };

    const assignmentsMap = await getUserLocAssignments(assignedUserIds);

    console.log(
      `📍 Found assignments for ${assignmentsMap.size} cleaners (in common locations)`,
    );

    // Handle empty
    if (tasks.length === 0) {
      return res.status(200).json({
        status: "success",
        message: "No cleaner records found",
        data: [],
        metadata: {
          report_type: reportType,
          dynamic_report_name: reportType.replace(/\s+/g, "_"),
          is_single_cleaner: isSingleCleaner,
          generated_on: new Date().toISOString(),
          organization: company.name,
          user_role_id: user?.role_id,
          date_range: {
            start: start_date || "Beginning",
            end: end_date || "Now",
          },
        },
      });
    }

    // ============== SINGLE CLEANER REPORT ==============
    if (isSingleCleaner) {
      const cleanerInfo = tasks[0]?.cleaner_user;
      const cleanerUserId = cleanerInfo?.id?.toString();

      // ✅ Get assigned washrooms (only common locations)
      const assignedWashrooms = assignmentsMap.get(cleanerUserId) || [];

      // Cleaning records
      const records = tasks.map((task) => {
        const startTime = new Date(task.created_at);
        const endTime =
          task.status === "completed" ? new Date(task.updated_at) : null;
        const now = new Date();
        const durationMinutes = endTime
          ? Math.round((endTime - startTime) / 60000)
          : Math.round((now - startTime) / 60000);

        const timeDisplay = endTime
          ? `${startTime.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })} - ${endTime.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}`
          : `${startTime.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })} - In Progress`;

        // ✅ Status logic: completed, ongoing (<24h), incomplete (>=24h)
        let status;
        if (task.status === "completed") {
          status = "Completed";
        } else {
          status = durationMinutes >= 1440 ? "Incomplete" : "Ongoing";
        }

        return {
          id: task.id.toString(),
          washroom_name: task.location?.name || "N/A",
          zone_type: task.location?.location_types?.name || "N/A",
          date: startTime.toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          }),
          time: timeDisplay,
          duration: durationMinutes,
          status: status,
          rating: task.score ? parseFloat(task.score.toFixed(1)) : "N/A",
        };
      });

      // Metrics
      // Metrics
      const completed = records.filter((r) => r.status === "Completed").length;
      const ongoing = records.filter((r) => r.status === "Ongoing").length;
      const incomplete = records.filter(
        (r) => r.status === "Incomplete",
      ).length;
      const completedRecords = records.filter((r) => r.status === "Completed");

      // ✅ ANOMALY FILTER: Only count tasks that took less than 24 hours (1440 mins) to prevent skewed averages
      const validDurationRecords = completedRecords.filter(
        (r) => r.duration < 1440,
      );

      const avgAiScore =
        completedRecords.length > 0
          ? (
              completedRecords.reduce(
                (sum, r) => sum + (typeof r.rating === "number" ? r.rating : 0),
                0,
              ) / completedRecords.length
            ).toFixed(2)
          : "N/A";

      // ✅ Calculate average duration using ONLY the filtered valid records
      const avgDuration =
        validDurationRecords.length > 0
          ? Math.round(
              validDurationRecords.reduce(
                (sum, r) => sum + (r.duration || 0),
                0,
              ) / validDurationRecords.length,
            )
          : 0;

      // Top washrooms and improvement areas
      const washroomStats = {};
      // ✅ Use validDurationRecords here so washroom averages aren't skewed either
      validDurationRecords.forEach((rec) => {
        if (!washroomStats[rec.washroom_name]) {
          washroomStats[rec.washroom_name] = { scores: [], durations: [] };
        }
        if (typeof rec.rating === "number")
          washroomStats[rec.washroom_name].scores.push(rec.rating);
        if (rec.duration)
          washroomStats[rec.washroom_name].durations.push(rec.duration);
      });
      const washroomList = Object.entries(washroomStats)
        .map(([name, s]) => ({
          name,
          avg_score: s.scores.length
            ? (s.scores.reduce((a, b) => a + b, 0) / s.scores.length).toFixed(2)
            : "N/A",
          avg_duration: s.durations.length
            ? Math.round(
                s.durations.reduce((a, b) => a + b, 0) / s.durations.length,
              )
            : 0,
        }))
        .sort((a, b) => parseFloat(b.avg_score) - parseFloat(a.avg_score));

      // ✅ Improvement areas: only ratings below 7.5
      const improvementAreas = washroomList
        .filter((w) => w.avg_score !== "N/A" && parseFloat(w.avg_score) < 7.5)
        .sort((a, b) => parseFloat(a.avg_score) - parseFloat(b.avg_score))
        .slice(0, 3);

      return res.status(200).json({
        status: "success",
        message: "Single Cleaner report generated successfully",
        metadata: {
          is_single_cleaner: true,
          cleaner_name: cleanerInfo?.name || "Unknown",
          cleaner_phone: cleanerInfo?.phone || "N/A",
          assigned_washrooms: assignedWashrooms, // ✅ Only common locations
          total_assigned_washrooms: assignedWashrooms.length,
          report_type: "Single Cleaner Report",
          dynamic_report_name: `Cleaner_${cleanerInfo?.name || "Unknown"}_Report`,
          organization: company.name,
          generated_on: new Date().toISOString(),
          user_role_id: user?.role_id,
          date_range: {
            start: start_date || "Beginning",
            end: end_date || "Now",
          },
          total_cleanings: records.length,
          completed,
          ongoing,
          incomplete,
          avg_ai_score: avgAiScore,
          avg_duration: avgDuration,
          top_washrooms: washroomList.slice(0, 3),
          improvement_areas: improvementAreas,
        },
        data: records,
        count: records.length,
      });
    }

    // ============== ALL CLEANERS REPORT ==============
    const cleanerMap = new Map();
    tasks.forEach((task) => {
      const cleanerId = (task.cleaner_user?.id || "unknown").toString();
      if (!cleanerMap.has(cleanerId)) {
        cleanerMap.set(cleanerId, {
          cleaner_name: task.cleaner_user?.name || "Unknown",
          cleaner_phone: task.cleaner_user?.phone || "N/A",
          records: [],
        });
      }
      cleanerMap.get(cleanerId).records.push(task);
    });

    // ✅ Build leaderboard with correct ongoing/incomplete logic
    const cleaners = Array.from(cleanerMap.entries()).map(([id, c]) => {
      const now = new Date();

      let completed = 0;
      let ongoing = 0;
      let incomplete = 0;

      c.records.forEach((r) => {
        if (r.status === "completed") {
          completed++;
        } else {
          const start = new Date(r.created_at);
          const durationMinutes = Math.round((now - start) / 60000);

          if (durationMinutes >= 1440) {
            // >= 24 hours
            incomplete++;
          } else {
            // < 24 hours
            ongoing++;
          }
        }
      });

      const completedRecords = c.records.filter(
        (r) => r.status === "completed",
      );

      const avgAiScore =
        completedRecords.length > 0
          ? (
              completedRecords.reduce(
                (sum, r) => sum + (typeof r.score === "number" ? r.score : 0),
                0,
              ) / completedRecords.length
            ).toFixed(2)
          : "N/A";

      // ✅ ANOMALY FILTER: Calculate valid durations only
      let totalValidDuration = 0;
      let validDurationCount = 0;

      completedRecords.forEach((r) => {
        const start = new Date(r.created_at);
        const end = new Date(r.updated_at);
        const durationMins = Math.round((end - start) / 60000);

        // Only include in average if the completed task took less than 24 hours (1440 mins)
        if (durationMins < 1440) {
          totalValidDuration += durationMins;
          validDurationCount++;
        }
      });

      const avgDuration =
        validDurationCount > 0
          ? Math.round(totalValidDuration / validDurationCount)
          : 0;
      // ✅ Get assigned washrooms (only common locations)
      const assignedWashrooms = assignmentsMap.get(id) || [];

      return {
        id,
        cleaner_name: c.cleaner_name,
        cleaner_phone: c.cleaner_phone,
        assigned_washrooms: assignedWashrooms, // ✅ Only common locations
        total_assigned_washrooms: assignedWashrooms.length,
        total_cleanings: c.records.length,
        completed,
        ongoing,
        incomplete,
        avg_ai_score: avgAiScore,
        avg_duration: avgDuration,
        last_activity: c.records.length > 0 ? c.records[0].created_at : null,
      };
    });

    // Leaderboards
    const topAvgScore = [...cleaners]
      .filter((c) => c.avg_ai_score !== "N/A")
      .sort((a, b) => parseFloat(b.avg_ai_score) - parseFloat(a.avg_ai_score))
      .slice(0, 5);

    const topCompleted = [...cleaners]
      .sort((a, b) => b.completed - a.completed)
      .slice(0, 5);

    const topConsistent = [...cleaners]
      .filter((c) => c.completed > 0 && c.avg_ai_score !== "N/A")
      .sort((a, b) => b.completed - a.completed)
      .slice(0, 5);

    return res.status(200).json({
      status: "success",
      message: "All Cleaners report generated successfully",
      metadata: {
        is_single_cleaner: false,
        report_type: "All Cleaners Report",
        dynamic_report_name: "All_Cleaners_Report",
        organization: company.name,
        generated_on: new Date().toISOString(),
        user_role_id: user?.role_id,
        date_range: {
          start: start_date || "Beginning",
          end: end_date || "Now",
        },
        total_cleaners: cleaners.length,
        total_cleanings_completed: cleaners.reduce(
          (sum, c) => sum + c.completed,
          0,
        ),
        top_avg_score: topAvgScore,
        top_completed: topCompleted,
        top_consistent: topConsistent,
      },
      data: cleaners,
      count: cleaners.length,
    });
  } catch (error) {
    console.error("❌ Error generating cleaner report:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to generate cleaner report",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const getDetailedCleaningReport = async (req, res) => {
  console.log("🔍 Generating Detailed Cleaning Report");
  try {
    const {
      company_id,
      start_date,
      end_date,
      detailed_report_date,
      location_id,
      cleaner_id,
      status_filter,
      type_id,
    } = req.query;
    const user = req.user; // ✅ From verifyToken middleware

    console.log("📥 Request Params:", {
      company_id,
      location_id,
      cleaner_id,
      user_role_id: user?.role_id,
    });

    if (!company_id) {
      return res
        .status(400)
        .json({ status: "error", message: "company_id is required" });
    }

    // ✅ Fetch company details
    const company = await prisma.companies.findUnique({
      where: { id: BigInt(company_id) },
      select: { name: true },
    });

    if (!company) {
      return res.status(404).json({
        status: "error",
        message: "Company not found",
      });
    }

    // ✅ STEP 1: Get RBAC-filtered locations for this user
    const locationWhereClause = {
      company_id: BigInt(company_id),
      status: true,
      deleted_at: null,
    };

    const roleFilter = await RBACFilterService.getLocationFilter(
      user,
      "detailed_cleaning_report",
    );
    Object.assign(locationWhereClause, roleFilter);

    // If specific location_id is provided, add it to filter
    if (location_id && location_id !== "undefined") {
      locationWhereClause.id = BigInt(location_id);
    }

    // Add type_id filter if provided
    if (type_id && type_id !== "undefined") {
      locationWhereClause.type_id = BigInt(type_id);
    }

    const allowedLocations = await prisma.locations.findMany({
      where: locationWhereClause,
      select: { id: true },
    });

    const allowedLocationIds = allowedLocations.map((loc) => loc.id);

    console.log(`✅ User has access to ${allowedLocationIds.length} locations`);

    if (allowedLocationIds.length === 0) {
      return res.status(200).json({
        status: "success",
        message: "No locations accessible to your role",
        data: [],
        count: 0,
        metadata: {
          report_type: "Detailed Cleaning Report",
          report_name: "Detailed_Cleaning_Report",
          generated_on: new Date().toISOString(),
          organization: company.name,
          user_role_id: user?.role_id,
          date_range: {
            start: start_date || "Beginning",
            end: end_date || "Now",
          },
          total_tasks: 0,
          completed_tasks: 0,
          ongoing_tasks: 0,
          compliance_rate: 0,
          compliant_tasks: 0,
          average_duration_minutes: 0,
          image_capture_rate: 0,
          tasks_with_images: 0,
        },
      });
    }

    // ✅ STEP 2: Build WHERE clause with RBAC location filter
    const whereClause = {
      company_id: BigInt(company_id),
      location_id: { in: allowedLocationIds }, // ✅ Only RBAC-filtered locations
    };

    if (cleaner_id) whereClause.cleaner_user_id = BigInt(cleaner_id);
    if (status_filter && status_filter !== "all")
      whereClause.status = status_filter;

    // ✅ Date range filtering
    if (start_date || end_date || detailed_report_date) {
      whereClause.created_at = {};
      if (detailed_report_date) {
        whereClause.created_at.gte = new Date(detailed_report_date);
        const endDateTime = new Date(detailed_report_date);
        endDateTime.setHours(23, 59, 59, 999);
        whereClause.created_at.lte = endDateTime;
      }
      // if (start_date) whereClause.created_at.gte = new Date(start_date);
      // if (end_date) {
      //     const endDateTime = new Date(end_date);
      //     endDateTime.setHours(23, 59, 59, 999);
      //     whereClause.created_at.lte = endDateTime;
      // }
    }

    console.log("whereClause", whereClause);

    // ✅ Fetch tasks with zone/hierarchy info (already RBAC-filtered)
    const tasks = await prisma.cleaner_review.findMany({
      where: whereClause,
      include: {
        cleaner_user: {
          select: { name: true, phone: true },
        },
        location: {
          select: {
            name: true,
            address: true,
            location_types: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { created_at: "desc" },
    });

    console.log(`✅ Fetched ${tasks.length} tasks for RBAC-filtered locations`);

    // ✅ Handle empty results
    if (tasks.length === 0) {
      return res.status(200).json({
        status: "success",
        message: "No tasks found",
        data: [],
        count: 0,
        metadata: {
          report_type: "Detailed Cleaning Report",
          report_name: "Detailed_Cleaning_Report",
          generated_on: new Date().toISOString(),
          organization: company.name,
          user_role_id: user?.role_id,
          date_range: {
            start: start_date || "Beginning",
            end: end_date || "Now",
          },
          total_tasks: 0,
          completed_tasks: 0,
          ongoing_tasks: 0,
          compliance_rate: 0,
          compliant_tasks: 0,
          average_duration_minutes: 0,
          image_capture_rate: 0,
          tasks_with_images: 0,
        },
      });
    }

    // ✅ Get unique location IDs (already RBAC-filtered)
    const locationIds = [
      ...new Set(tasks.map((task) => task.location_id).filter(Boolean)),
    ];

    // ✅ Fetch hygiene scores (for final_rating) for RBAC-filtered locations
    const hygieneScores = await prisma.hygiene_scores.groupBy({
      by: ["location_id"],
      where: { location_id: { in: locationIds } },
      _avg: { score: true },
    });

    console.log(
      `📊 Found hygiene scores for ${hygieneScores.length} locations`,
    );

    // ✅ Create score lookup map
    const averageScoresMap = new Map();
    hygieneScores.forEach((group) => {
      if (group.location_id) {
        const avgScore = group._avg.score ? Number(group._avg.score) : 0;
        averageScoresMap.set(group.location_id.toString(), avgScore);
      }
    });

    // Fetch zone/type info for filtering
    const zoneInfo = type_id
      ? await prisma.location_types.findUnique({
          where: { id: BigInt(type_id) },
          select: { name: true },
        })
      : null;

    // Transform data with smart time logic
    const reportData = tasks.map((task) => {
      const startTime = new Date(task.created_at);
      const endTime =
        task.status === "completed" ? new Date(task.updated_at) : null;
      const now = new Date();

      // Calculate duration
      const durationMinutes = endTime
        ? Math.round((endTime - startTime) / 60000)
        : Math.round((now - startTime) / 60000);

      // Calculate task age in days
      const taskAgeDays = (now - startTime) / (1000 * 60 * 60 * 24);

      // Smart time status
      let timeStatus = "";
      let isOverdue = false;

      if (task.status === "completed") {
        const sameDay = startTime.toDateString() === endTime.toDateString();
        timeStatus = sameDay ? "completed_same_day" : "completed_different_day";
      } else {
        if (taskAgeDays > 2) {
          timeStatus = "incomplete_overdue";
          isOverdue = true;
        } else {
          timeStatus =
            startTime.toDateString() === now.toDateString()
              ? "ongoing_same_day"
              : "ongoing_different_day";
        }
      }

      const aiScore = task.score || 0;
      const finalRating =
        averageScoresMap.get(task.location_id?.toString()) || 0;

      return {
        task_id: task.id.toString(),
        cleaner_name: task.cleaner_user?.name || "Unknown",
        cleaner_phone: task.cleaner_user?.phone || "N/A",

        // ✅ Zone/Hierarchy info
        zone_name: task.location?.location_types?.name || "N/A",
        zone_id: task.location?.location_types?.id?.toString() || null,
        washroom_name: task.location?.name || "Unknown",
        washroom_address: task.location?.address || "N/A",
        washroom_full_name: `${task.location?.name || "Unknown"}${task.location?.location_types?.name ? ` (${task.location.location_types.name})` : ""}`,

        // ✅ Time info
        task_start_time: task.created_at,
        task_end_time: endTime,
        duration_minutes: durationMinutes,
        task_age_days: Math.floor(taskAgeDays),
        time_status: timeStatus,
        is_overdue: isOverdue,

        // ✅ Images
        before_photo: task.before_photo || [],
        after_photo: task.after_photo || [],
        has_images:
          task.before_photo?.length > 0 || task.after_photo?.length > 0,

        // ✅ Scores (0-10 scale)
        ai_score: parseFloat(aiScore.toFixed(2)),
        final_rating: parseFloat(finalRating.toFixed(2)),
        is_compliant: aiScore >= 7,

        status: task.status,
      };
    });

    // ✅ Calculate metadata metrics
    const total_tasks = reportData.length;
    const completed_tasks = reportData.filter(
      (t) => t.status === "completed",
    ).length;
    const ongoing_tasks = total_tasks - completed_tasks;
    const compliant_tasks = reportData.filter((t) => t.is_compliant).length;
    const compliance_rate =
      total_tasks > 0 ? ((compliant_tasks / total_tasks) * 100).toFixed(1) : 0;

    const tasks_with_images = reportData.filter((t) => t.has_images).length;
    const image_capture_rate =
      total_tasks > 0
        ? ((tasks_with_images / total_tasks) * 100).toFixed(1)
        : 0;

    const average_duration_minutes =
      completed_tasks > 0
        ? Math.round(
            reportData
              .filter((t) => t.status === "completed")
              .reduce((sum, t) => sum + t.duration_minutes, 0) /
              completed_tasks,
          )
        : 0;

    const average_ai_score =
      total_tasks > 0
        ? (
            reportData.reduce((sum, t) => sum + t.ai_score, 0) / total_tasks
          ).toFixed(2)
        : 0;

    const average_final_rating =
      total_tasks > 0
        ? (
            reportData.reduce((sum, t) => sum + t.final_rating, 0) / total_tasks
          ).toFixed(2)
        : 0;

    // ✅ Generate dynamic report name
    let reportName = "Detailed_Cleaning_Report";
    if (location_id && tasks.length > 0) {
      const washroomName = reportData[0].washroom_name.replace(/\s+/g, "_");
      reportName = `${washroomName}_Detailed_Report`;
    } else if (cleaner_id && tasks.length > 0) {
      const cleanerName = reportData[0].cleaner_name.replace(/\s+/g, "_");
      reportName = `${cleanerName}_Detailed_Report`;
    } else if (zoneInfo) {
      const zoneName = zoneInfo.name.replace(/\s+/g, "_");
      reportName = `${zoneName}_Detailed_Report`;
    }

    const reportMetadata = {
      report_type: "Detailed Cleaning Report",
      report_name: reportName,
      generated_on: new Date().toISOString(),
      organization: company.name,
      user_role_id: user?.role_id,
      date_range: {
        start: start_date || "Beginning",
        end: end_date || "Now",
      },

      // ✅ Summary metrics
      total_tasks,
      completed_tasks,
      ongoing_tasks,

      // ✅ New metrics
      compliance_rate: parseFloat(compliance_rate),
      compliant_tasks,
      average_duration_minutes,
      average_ai_score: parseFloat(average_ai_score),
      average_final_rating: parseFloat(average_final_rating),
      image_capture_rate: parseFloat(image_capture_rate),
      tasks_with_images,
    };

    console.log("✅ Report generated successfully", {
      total_tasks,
      compliance_rate,
      user_role_id: user?.role_id,
      allowed_locations: allowedLocationIds.length,
    });

    res.status(200).json({
      status: "success",
      message: "Detailed Cleaning report generated successfully",
      metadata: reportMetadata,
      data: reportData,
      count: total_tasks,
    });
  } catch (error) {
    console.error("❌ Error generating detailed cleaning report:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to generate detailed cleaning report",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const getWashroomDailyScoresReport = async (req, res) => {
  console.log("🔍 Generating Washroom Daily Scores Report");
  try {
    const { company_id, start_date, end_date, type_id } = req.query;
    // const user = req.user;

    console.log("📥 Request Params:", {
      company_id,
      start_date,
      end_date,
      type_id,
    });

    // ✅ VALIDATION
    if (!company_id) {
      return res.status(400).json({
        status: "error",
        message: "company_id is required",
      });
    }

    if (!start_date || !end_date) {
      return res.status(400).json({
        status: "error",
        message: "start_date and end_date are required",
      });
    }

    // Parse dates
    const startDateTime = new Date(start_date);
    const endDateTime = new Date(end_date);
    endDateTime.setHours(23, 59, 59, 999);

    // console.log(start_date, end_date, "original dates");
    // console.log(startDateTime, "start date modified ")
    // console.log(endDateTime, "end date modified ")
    if (startDateTime > endDateTime) {
      return res.status(400).json({
        status: "error",
        message: "start_date must be before or equal to end_date",
      });
    }

    // ✅ Fetch company details
    const company = await prisma.companies.findUnique({
      where: { id: BigInt(company_id) },
      select: { name: true },
    });

    console.log(company, "company data");
    if (!company) {
      return res.status(404).json({
        status: "error",
        message: "Company not found",
      });
    }

    // ✅ STEP 1: Get RBAC-filtered locations
    const locationWhereClause = {
      company_id: BigInt(company_id),
      status: true,
      deleted_at: null,
    };

    // const roleFilter = await RBACFilterService.getLocationFilter(user, "washroom_daily_scores");
    // Object.assign(locationWhereClause, roleFilter);

    if (type_id && type_id !== "undefined") {
      locationWhereClause.type_id = BigInt(type_id);
    }

    // ✅ STEP 2: Fetch all washrooms with location types
    const washrooms = await prisma.locations.findMany({
      where: locationWhereClause,
      include: {
        location_types: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    console.log(`✅ Found ${washrooms.length} washrooms`);

    if (washrooms.length === 0) {
      return res.status(204).json({
        status: "success",
        message: "No washrooms found",
        metadata: {
          report_type: "Washroom Daily Scores Report",
          organization: company.name,
          generated_on: new Date().toISOString(),
          date_range: { start: start_date, end: end_date },
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

    // ✅ STEP 3: Get assigned cleaners (role_id = 5)
    const assignments = await prisma.cleaner_assignments.findMany({
      where: {
        location_id: { in: washroomIds },
        status: "assigned",
        deleted_at: null,
        role_id: 5,
        cleaner_user: {
          deleted_at: null,
        },
      },
      include: {
        cleaner_user: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
      },
    });

    // console.log(assignments, "assignments")

    // console.log(`✅ Found ${assignments.length} cleaner assignments`);

    // Group assignments by location
    const assignmentsByLocation = new Map();
    assignments.forEach((assignment) => {
      const locId = assignment.location_id?.toString();
      if (!locId || !assignment.cleaner_user) return;

      if (!assignmentsByLocation.has(locId)) {
        assignmentsByLocation.set(locId, []);
      }

      assignmentsByLocation.get(locId).push({
        id: assignment.cleaner_user.id.toString(),
        name: assignment.cleaner_user.name,
        phone: assignment.cleaner_user.phone,
      });
    });

    // ✅ STEP 4: Fetch hygiene scores for date range
    const hygieneScores = await prisma.hygiene_scores.findMany({
      where: {
        location_id: { in: washroomIds },
        inspected_at: {
          gte: startDateTime,
          lte: endDateTime,
        },
      },
      select: {
        location_id: true,
        score: true,
        inspected_at: true,
      },
      orderBy: {
        inspected_at: "asc",
      },
    });

    console.log(`📊 Found ${hygieneScores.length} hygiene score records`);

    // ✅ STEP 5: Group scores by location + date, keep ALL scores for overall average
    const scoresByLocationAndDate = new Map();
    const allScoresByLocation = new Map(); // NEW: Track all scores per washroom

    hygieneScores.forEach((record) => {
      if (!record.location_id || record.score == null) return;

      const locId = record.location_id.toString();
      const dateStr = new Date(record.inspected_at).toISOString().split("T")[0];
      const key = `${locId}_${dateStr}`;

      // Store all scores with timestamps for that location + date
      if (!scoresByLocationAndDate.has(key)) {
        scoresByLocationAndDate.set(key, []);
      }

      scoresByLocationAndDate.get(key).push({
        score: Number(record.score),
        timestamp: record.inspected_at,
      });

      // NEW: Track all scores for this location (for overall average)
      if (!allScoresByLocation.has(locId)) {
        allScoresByLocation.set(locId, []);
      }
      allScoresByLocation.get(locId).push(Number(record.score));
    });

    console.log(scoresByLocationAndDate, "by score and date before");
    console.log(allScoresByLocation, "by allScores by location before");
    // NEW: Get LATEST score per location per day (not average)
    const latestScorePerDay = new Map();
    scoresByLocationAndDate.forEach((scores, key) => {
      // Sort by timestamp descending, get most recent
      const sortedScores = scores.sort(
        (a, b) => new Date(b.timestamp) - new Date(a.timestamp),
      );
      latestScorePerDay.set(key, parseFloat(sortedScores[0].score.toFixed(2)));
    });

    console.log(scoresByLocationAndDate, "after score and date");
    console.log(
      `📈 Found latest scores for ${latestScorePerDay.size} location-date combinations`,
    );

    // ✅ STEP 6: Generate date columns
    const dateColumns = [];
    const dateColumnsFormatted = [];
    const currentDate = new Date(startDateTime);

    while (currentDate <= endDateTime) {
      const dateStr = currentDate.toISOString().split("T")[0]; // YYYY-MM-DD
      dateColumns.push(dateStr);

      // Format as "15 Nov", "16 Nov", etc.
      const formatted = currentDate.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      });
      dateColumnsFormatted.push(formatted);

      currentDate.setDate(currentDate.getDate() + 1);
    }

    const totalDays = dateColumns.length;
    console.log(`📅 Generated ${totalDays} date columns`);

    // ✅ STEP 7: Build report data
    const reportData = washrooms.map((washroom, index) => {
      const washroomId = washroom.id.toString();
      const assignedCleaners = assignmentsByLocation.get(washroomId) || [];

      // Build daily_scores with LATEST score per day
      const dailyScores = {};

      dateColumns.forEach((dateStr) => {
        const key = `${washroomId}_${dateStr}`;
        const latestScore = latestScorePerDay.get(key);

        dailyScores[dateStr] = latestScore !== undefined ? latestScore : null;
      });

      // ✅ Calculate average from ALL inspections (not daily averages)
      const allScores = allScoresByLocation.get(washroomId) || [];
      const averageScore =
        allScores.length > 0
          ? parseFloat(
              (
                allScores.reduce((sum, s) => sum + s, 0) / allScores.length
              ).toFixed(2),
            )
          : 0;

      return {
        sr_no: index + 1,
        washroom_id: washroomId,
        washroom_name: washroom.name,
        zone_type: washroom.location_types?.name || "N/A",
        assigned_cleaners: assignedCleaners.map((c) => c.name),
        assigned_cleaners_ids: assignedCleaners.map((c) => c.id),
        daily_scores: dailyScores,
        average_score: averageScore,
        // Hidden fields
        address: washroom.address || "N/A",
        city: washroom.city || "N/A",
        state: washroom.state || "N/A",
        pincode: washroom.pincode || "N/A",
      };
    });

    // ✅ STEP 8: Calculate overall metrics
    const totalWashrooms = reportData.length;
    const overallAvgScore =
      totalWashrooms > 0
        ? parseFloat(
            (
              reportData.reduce((sum, w) => sum + w.average_score, 0) /
              totalWashrooms
            ).toFixed(2),
          )
        : 0;

    console.log(
      `📊 Overall average score across all washrooms: ${overallAvgScore}`,
    );
    console.log(`📊 Total washrooms in report: ${totalWashrooms}`);
    // console.log('✅ Washroom Daily Scores Report generated successfully', reportData);

    // ✅ STEP 9: Return response
    res.status(200).json({
      status: "success",
      message: "Washroom daily scores report generated successfully",
      metadata: {
        report_type: "Washroom Daily Scores Report",
        organization: company.name,
        generated_on: new Date().toISOString(),
        // user_role_id: user?.role_id,
        date_range: {
          start: start_date,
          end: end_date,
        },
        total_days: totalDays,
        total_washrooms: totalWashrooms,
        overall_avg_score: overallAvgScore,
        date_columns: dateColumnsFormatted,
      },
      data: reportData,
      count: totalWashrooms,
    });
  } catch (error) {
    console.error("❌ Error generating washroom daily scores report:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to generate washroom daily scores report",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const getAiScoringReport = async (req, res) => {
  try {
    const { company_id, start_date, end_date, location_id } = req.query;

    if (!company_id) {
      return res
        .status(400)
        .json({ status: "error", message: "company_id is required" });
    }

    // 1. Build `where` clause for hygiene_scores
    const whereClause = {
      locations: {
        company_id: BigInt(company_id),
      },
    };

    if (location_id) {
      whereClause.location_id = BigInt(location_id);
    }

    if (start_date || end_date) {
      whereClause.inspected_at = {};
      if (start_date) whereClause.inspected_at.gte = new Date(start_date);
      if (end_date) {
        const endDateTime = new Date(end_date);
        endDateTime.setHours(23, 59, 59, 999);
        whereClause.inspected_at.lte = endDateTime;
      }
    }

    // 2. Fetch all relevant scores, ordered by date
    const allScores = await prisma.hygiene_scores.findMany({
      where: whereClause,
      select: {
        location_id: true,
        score: true,
        locations: {
          // Include location name
          select: { name: true },
        },
      },
      orderBy: {
        inspected_at: "asc",
      },
    });

    if (allScores.length === 0) {
      return res.status(200).json({
        status: "success",
        message: "No scores found",
        data: [],
        count: 0,
      });
    }

    // 3. Group scores by location_id
    const scoresByLocation = new Map();
    allScores.forEach((item) => {
      const locId = item.location_id.toString();
      if (!scoresByLocation.has(locId)) {
        scoresByLocation.set(locId, {
          location_name: item.locations.name,
          scores: [],
        });
      }
      // Convert score to a number and push
      scoresByLocation.get(locId).scores.push(Number(item.score));
    });

    // 4. Process each location to calculate average and improvement
    const reportData = [];
    for (const [
      locationId,
      { location_name, scores },
    ] of scoresByLocation.entries()) {
      // Calculate overall average score
      const totalScore = scores.reduce((sum, score) => sum + score, 0);
      const averageScore = scores.length > 0 ? totalScore / scores.length : 0;

      // Calculate improvement
      let improvementPercentage = 0;
      if (scores.length >= 2) {
        const midpoint = Math.ceil(scores.length / 2);
        const firstHalf = scores.slice(0, midpoint);
        const secondHalf = scores.slice(midpoint);

        const avgFirstHalf =
          firstHalf.reduce((sum, s) => sum + s, 0) / firstHalf.length;
        const avgSecondHalf =
          secondHalf.length > 0
            ? secondHalf.reduce((sum, s) => sum + s, 0) / secondHalf.length
            : avgFirstHalf;

        if (avgFirstHalf > 0) {
          improvementPercentage =
            ((avgSecondHalf - avgFirstHalf) / avgFirstHalf) * 100;
        }
      }

      reportData.push({
        location_id: locationId,
        location_name: location_name,
        average_score: parseFloat(averageScore.toFixed(2)),
        improvement_percentage: parseFloat(improvementPercentage.toFixed(2)),
        total_inspections: scores.length,
      });
    }

    // 5. Build Metadata
    const overallAverage =
      reportData.reduce((sum, loc) => sum + loc.average_score, 0) /
      (reportData.length || 1);

    const reportMetadata = {
      report_type: "AI Scoring Report",
      generated_on: new Date().toISOString(),
      date_range: { start: start_date || "Beginning", end: end_date || "Now" },
      total_locations_inspected: reportData.length,
      overall_average_score: parseFloat(overallAverage.toFixed(2)),
    };

    res.status(200).json({
      status: "success",
      message: "AI Scoring Report generated successfully",
      metadata: reportMetadata,
      data: reportData,
      count: reportData.length,
    });
  } catch (error) {
    console.error("Error generating AI Scoring Report:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to generate AI Scoring Report",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

export const getCleanerPerformanceReport = async (req, res) => {
  try {
    const { company_id, start_date, end_date } = req.query;

    if (!company_id) {
      return res
        .status(400)
        .json({ status: "error", message: "company_id is required" });
    }

    // 1. Get the total number of checklist items for compliance calculation
    const checklistConfig = await prisma.configurations.findFirst({
      where: {
        name: "after_cleaning_checklist",
        company_id: BigInt(company_id),
      },
    });
    const totalChecklistItems = checklistConfig?.description?.length || 8;

    // 2. Build where clause for fetching cleaner reviews
    const whereClause = { company_id: BigInt(company_id) };
    if (start_date || end_date) {
      whereClause.created_at = {};
      if (start_date) whereClause.created_at.gte = new Date(start_date);
      if (end_date) {
        const endDateTime = new Date(end_date);
        endDateTime.setHours(23, 59, 59, 999);
        whereClause.created_at.lte = endDateTime;
      }
    }

    // 3. Fetch all cleaner reviews within the date range
    const reviews = await prisma.cleaner_review.findMany({
      where: whereClause,
      select: {
        cleaner_user_id: true,
        score: true, // AI Score
        tasks: true, // For compliance
        updated_at: true,
        created_at: true,
        final_comment: true, // For remarks count
      },
    });

    // 4. Group reviews by cleaner
    const cleanerData = new Map();
    for (const review of reviews) {
      if (!review.cleaner_user_id) continue;

      const cleanerId = review.cleaner_user_id.toString();
      if (!cleanerData.has(cleanerId)) {
        cleanerData.set(cleanerId, {
          scores: [],
          compliances: [],
          durations: [],
          remarks: 0,
        });
      }

      const data = cleanerData.get(cleanerId);
      if (review.score) data.scores.push(review.score);

      // Compliance
      const compliancePercentage =
        (review.tasks.length / totalChecklistItems) * 100;
      data.compliances.push(compliancePercentage);

      // Duration
      const duration = Math.round(
        (new Date(review.updated_at || Date.now()) -
          new Date(review.created_at)) /
          60000,
      );
      data.durations.push(duration);

      // Remarks
      if (review.final_comment && review.final_comment.trim() !== "") {
        data.remarks++;
      }
    }

    // 5. Fetch cleaner names
    const cleanerIds = Array.from(cleanerData.keys()).map((id) => BigInt(id));
    const cleaners = await prisma.users.findMany({
      where: { id: { in: cleanerIds } },
      select: { id: true, name: true },
    });
    const cleanerNameMap = new Map(
      cleaners.map((c) => [c.id.toString(), c.name]),
    );

    // 6. Calculate final report data for each cleaner
    const reportData = [];
    for (const [cleanerId, data] of cleanerData.entries()) {
      const totalTasks = data.scores.length;
      const avgAiScore =
        (data.scores.reduce((a, b) => a + b, 0) / totalTasks) * 10; // Scale to 100
      const avgCompliance =
        data.compliances.reduce((a, b) => a + b, 0) / totalTasks;
      const avgDuration =
        data.durations.reduce((a, b) => a + b, 0) / totalTasks;

      // Calculate Grade
      const finalScore =
        avgAiScore * 0.5 + avgCompliance * 0.4 + (1 / (1 + data.remarks)) * 10; // Remarks bonus scaled to 10
      let grade = "D";
      if (finalScore >= 95) grade = "A+";
      else if (finalScore >= 85) grade = "A";
      else if (finalScore >= 75) grade = "B";
      else if (finalScore >= 60) grade = "C";

      reportData.push({
        cleaner_id: cleanerId,
        cleaner_name: cleanerNameMap.get(cleanerId) || "Unknown Cleaner",
        total_tasks: totalTasks,
        avg_ai_score: parseFloat(avgAiScore.toFixed(2)),
        avg_compliance: parseFloat(avgCompliance.toFixed(2)),
        avg_duration: parseFloat(avgDuration.toFixed(2)),
        remarks_count: data.remarks,
        grade: grade,
      });
    }

    // 7. Metadata and Response
    const metadata = {
      report_type: "Cleaner Performance Report",
      date_range: { start: start_date || "Beginning", end: end_date || "Now" },
      total_cleaners: reportData.length,
    };

    res.status(200).json({ status: "success", data: reportData, metadata });
  } catch (error) {
    console.error("Error generating Cleaner Performance Report:", error);
    res.status(500).json({ status: "error", message: "Internal Server Error" });
  }
};

export const getPerformanceSummary = async (req, res) => {
  console.log("get performance summary report");
  try {
    const { company_id, start_date, end_date, cleaner_id } = req.query;

    if (!company_id) {
      return res
        .status(400)
        .json({ status: "error", message: "company_id is required" });
    }

    // 1. Build user (cleaner) filter
    const userWhere = { company_id: BigInt(company_id), role_id: 5 }; // dev - only include cleaners
    if (cleaner_id) userWhere.id = BigInt(cleaner_id);

    const cleanerUsers = await prisma.users.findMany({
      where: userWhere,
      select: { id: true, name: true },
    });
    const cleanerUserIds = cleanerUsers.map((u) => u.id);

    // 2. Build review filter
    const reviewWhere = {
      cleaner_user_id: { in: cleanerUserIds },
      status: "completed",
    };
    if (start_date || end_date) {
      reviewWhere.created_at = {};
      if (start_date) reviewWhere.created_at.gte = new Date(start_date);
      if (end_date) {
        const e = new Date(end_date);
        e.setHours(23, 59, 59, 999);
        reviewWhere.created_at.lte = e;
      }
    }

    // 3. Get checklist config for compliance calculation
    const checklistConfig = await prisma.configurations.findFirst({
      where: {
        name: "after_cleaning_checklist",
        company_id: BigInt(company_id),
      },
    });
    const totalChecklistItems = checklistConfig?.description?.length || 8;

    // 4. Fetch all relevant reviews in one go
    const reviews = await prisma.cleaner_review.findMany({
      where: reviewWhere,
      select: {
        cleaner_user_id: true,
        score: true,
        tasks: true,
        created_at: true,
        updated_at: true,
      },
    });

    // 5. Group & aggregate data for each cleaner
    const statsByCleaner = {};
    for (const review of reviews) {
      const cId = review.cleaner_user_id?.toString();
      if (!cId) continue;
      if (!statsByCleaner[cId]) {
        statsByCleaner[cId] = {
          tasks: 0,
          aiScoreSum: 0,
          complianceSum: 0,
          durationSum: 0,
          lastTaskDate: null,
        };
      }
      const stats = statsByCleaner[cId];
      stats.tasks += 1;
      stats.aiScoreSum += review.score || 0;
      stats.complianceSum +=
        ((review.tasks?.length || 0) / totalChecklistItems) * 100;
      const created = new Date(review.created_at);
      const updated = review.updated_at
        ? new Date(review.updated_at)
        : new Date();
      const duration = Math.round((updated - created) / 60000);
      stats.durationSum += duration;
      if (!stats.lastTaskDate || updated > stats.lastTaskDate) {
        stats.lastTaskDate = updated;
      }
    }

    // 6. Prepare final output
    const data = cleanerUsers.map((u) => {
      const stats = statsByCleaner[u.id.toString()] || {
        tasks: 0,
        aiScoreSum: 0,
        complianceSum: 0,
        durationSum: 0,
        lastTaskDate: null,
      };
      return {
        cleaner_name: u.name,
        total_tasks: stats.tasks,
        avg_ai_score: stats.tasks
          ? Number((stats.aiScoreSum / stats.tasks).toFixed(1))
          : 0,
        avg_compliance: stats.tasks
          ? Number((stats.complianceSum / stats.tasks).toFixed(1))
          : 0,
        avg_duration: stats.tasks
          ? Number((stats.durationSum / stats.tasks).toFixed(1))
          : 0,
        last_task_date: stats.lastTaskDate
          ? stats.lastTaskDate.toISOString()
          : null,
      };
    });

    return res.status(200).json({
      status: "success",
      message: "Cleaner performance summary generated",
      data,
      metadata: {
        report_type: "Cleaner Performance Summary",
        date_range: { start: start_date || "-", end: end_date || "-" },
        total_cleaners: cleanerUsers.length,
      },
    });
  } catch (error) {
    console.error("Error:", error);
    return res
      .status(500)
      .json({ status: "error", message: "Internal Server Error" });
  }
};

///////////////////////////////// CLEANERS & LOCATIONS FOR REPORT FILTERS //////////////////////////////////

export const getCleanersForReport = async (req, res) => {
  try {
    const { company_id, location_id } = req.query;
    const user = req.user; // ✅ From verifyToken middleware

    console.log("🔍 Fetching cleaners:", {
      company_id,
      location_id,
      user_role_id: user?.role_id,
    });

    if (!company_id) {
      return res.status(400).json({
        status: "error",
        message: "company_id is required",
      });
    }

    // ✅ STEP 1: Get RBAC-filtered locations for this user
    const locationWhereClause = {
      company_id: BigInt(company_id),
      status: true,
      deleted_at: null,
    };

    const roleFilter = await RBACFilterService.getLocationFilter(
      user,
      "cleaner_list",
    );
    Object.assign(locationWhereClause, roleFilter);

    // If specific location_id is provided, add it to filter
    if (location_id && location_id !== "undefined") {
      locationWhereClause.id = BigInt(location_id);
    }

    const allowedLocations = await prisma.locations.findMany({
      where: locationWhereClause,
      select: { id: true },
    });

    const allowedLocationIds = allowedLocations.map((loc) => loc.id);

    console.log(`✅ User has access to ${allowedLocationIds.length} locations`);

    if (allowedLocationIds.length === 0) {
      return res.status(200).json({
        status: "success",
        data: [],
        count: 0,
        message: "No locations accessible to your role",
      });
    }

    // ✅ STEP 2: Get cleaners assigned to these allowed locations
    const assignments = await prisma.cleaner_assignments.findMany({
      where: {
        location_id: { in: allowedLocationIds }, // ✅ Only RBAC-filtered locations
        company_id: BigInt(company_id),
        deleted_at: null,
        status: "assigned", // ✅ Only active assignments
      },
      select: {
        cleaner_user_id: true,
      },
      distinct: ["cleaner_user_id"], // Get unique cleaner IDs
    });

    console.log(
      `📋 Found ${assignments.length} cleaner assignments for allowed locations`,
    );

    // Extract unique cleaner user IDs
    const cleanerUserIds = [
      ...new Set(assignments.map((a) => a.cleaner_user_id).filter(Boolean)),
    ];

    if (cleanerUserIds.length === 0) {
      return res.status(200).json({
        status: "success",
        data: [],
        count: 0,
        message: location_id
          ? "No cleaners assigned to this location"
          : "No cleaners assigned to accessible locations",
      });
    }

    // ✅ STEP 3: Fetch user details for those cleaner IDs
    const cleaners = await prisma.users.findMany({
      where: {
        id: { in: cleanerUserIds },
        company_id: BigInt(company_id),
        role_id: 5, // Cleaner role
        deleted_at: null,
      },
      select: {
        id: true,
        name: true,
        phone: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    console.log(
      `✅ Found ${cleaners.length} active cleaners for accessible locations`,
    );

    // ✅ Manually convert BigInt to String
    const formattedCleaners = cleaners.map((cleaner) => ({
      id: cleaner.id.toString(),
      name: cleaner.name,
      phone: cleaner.phone || "N/A",
    }));

    res.status(200).json({
      status: "success",
      data: formattedCleaners,
      count: formattedCleaners.length,
    });
  } catch (error) {
    console.error("❌ Error fetching cleaners:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to fetch cleaners",
    });
  }
};

export const getLocationsForReport = async (req, res) => {
  try {
    const { company_id, type_id } = req.query;
    const user = req.user; // ✅ From verifyToken middleware

    console.log("🔍 Fetching locations:", {
      company_id,
      type_id,
      user_role_id: user?.role_id,
    });

    if (!company_id) {
      return res.status(400).json({
        status: "error",
        message: "company_id is required",
      });
    }

    // ✅ Build WHERE clause with RBAC filter
    const whereClause = {
      company_id: BigInt(company_id),
      status: true,
      deleted_at: null,
    };

    // ✅ Apply RBAC location filter
    const roleFilter = await RBACFilterService.getLocationFilter(
      user,
      "location_list",
    );
    Object.assign(whereClause, roleFilter);

    // Add type_id filter if provided
    if (type_id && type_id !== "undefined") {
      console.log("✅ Filtering by type_id:", type_id);
      whereClause.type_id = BigInt(type_id);
    }

    const locations = await prisma.locations.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        address: true,
        type_id: true,
        location_types: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        name: "asc",
      },
    });

    console.log(`✅ Found ${locations.length} locations (RBAC filtered)`);

    // ✅ Manually convert BigInt to String
    const formattedLocations = locations.map((loc) => ({
      id: loc.id.toString(),
      name: loc.name,
      type: loc.location_types?.name || "N/A",
      address: loc.address || "N/A",
      type_id: loc.type_id?.toString() || null,
      display_name: `${loc.name}${loc.location_types?.name ? ` (${loc.location_types.name})` : ""}`,
    }));

    res.status(200).json({
      status: "success",
      data: formattedLocations,
      count: formattedLocations.length,
    });
  } catch (error) {
    console.error("❌ Error fetching locations:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to fetch locations",
    });
  }
};

export const getAvailableZones = async (req, res) => {
  try {
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({
        status: "error",
        message: "company_id is required",
      });
    }

    const zones = await prisma.location_types.findMany({
      where: {
        company_id: BigInt(company_id),
      },
      select: {
        id: true,
        name: true,
        is_toilet: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    const serialized = zones.map((zone) => ({
      id: zone.id.toString(),
      name: zone.name,
      is_toilet: zone.is_toilet,
    }));

    res.status(200).json({
      status: "success",
      data: serialized,
    });
  } catch (error) {
    console.error("Error fetching zones:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to fetch zones",
    });
  }
};
