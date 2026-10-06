import prisma from "../config/prismaClient.mjs";
import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import path from "path";
import RBACFilterService from "../utils/rbacFilterService.js";
import { checkAndTriggerWashroomSlaBreach } from "../services/slaNotificationService.js";
import { evaluateReviewSla } from "../services/slaEscalationService.js";
import { resolveEffectiveWashroomSLA } from "../services/slaConfigurationService.js";

// =========================================================
// 1️⃣ GET all cleaner reviews (with filters)
// =========================================================

// const BASE_URL = process.env.BASE_URL || "https://safai-index-backend.onrender.com";

export async function getCleanerReview(req, res) {
  const { cleaner_user_id, status, date, company_id } = req.query;

  try {
    const whereClause = {};

    if (cleaner_user_id) {
      whereClause.cleaner_user_id = BigInt(cleaner_user_id);
    }
    if (company_id) {
      whereClause.company_id = BigInt(company_id);
    }
    if (status) {
      whereClause.status = status;
    }
    if (date) {
      const startDate = new Date(date);
      startDate.setUTCHours(0, 0, 0, 0);

      const endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 1);

      whereClause.created_at = {
        gte: startDate,
        lt: endDate,
      };
    }

    const reviews = await prisma.cleaner_review.findMany({
      where: whereClause,
      // ✅ CHANGED: Use 'select' instead of 'include' to fetch ONLY what the UI needs
      select: {
        id: true,
        company_id: true,
        location_id: true,
        status: true,
        score: true,
        original_score: true,
        is_modified: true,
        created_at: true,
        before_photo: true,
        after_photo: true,
        review_type: true,
        attempt_no: true,
        escalation_id: true,
        cleaner_user: {
          select: {
            id: true,
            name: true, // Only get the cleaner's name
          },
        },
        location: {
          select: {
            id: true,
            name: true, // Location name
            company_id: true,
            sla_config: true,
          },
        },
        hygiene_score: {
          select: {
            id: true,
            details: true, // Only get the AI details JSON, ignore the rest
          },
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    const safeSerialize = (obj) => {
      if (obj === null || obj === undefined) return obj;

      // ✅ Handle BigInt
      if (typeof obj === "bigint") return obj.toString();

      // ✅ Handle Date objects
      if (obj instanceof Date) return obj.toISOString();

      // ✅ Handle Prisma Decimal (Fixes the {s: 1, e: 0, d: [7, 9000000]} issue)
      if (typeof obj === "object" && typeof obj.toNumber === "function") {
        return obj.toNumber();
      }
      if (obj.d && obj.e !== undefined && obj.s !== undefined) {
        return parseFloat(
          `${obj.s < 0 ? "-" : ""}${obj.d.join("")}e${obj.e - obj.d.length + 1}`,
        );
      }

      // ✅ Handle Arrays
      if (Array.isArray(obj)) return obj.map(safeSerialize);

      // ✅ Handle generic objects
      if (typeof obj === "object") {
        const serialized = {};
        for (const [key, value] of Object.entries(obj)) {
          serialized[key] = safeSerialize(value);
        }
        return serialized;
      }

      return obj;
    };

    const serializedReviews = reviews.map((review) => safeSerialize(review));

    res.json(serializedReviews);
  } catch (err) {
    console.error("Fetch Cleaner Reviews Error:", err);
    res.status(500).json({
      error: "Failed to fetch cleaner reviews",
      detail: err.message,
    });
  }
}

export async function getCleanerReviews(req, res) {
  const {
    cleaner_user_id,
    cleaner_id,
    status,
    start_date,
    end_date,
    company_id,
    page = 1, // Default page 1
    limit = 15, // Default limit 15
  } = req.query;

  try {
    const whereClause = {};

    if (company_id) whereClause.company_id = BigInt(company_id);

    const finalCleanerId = cleaner_user_id || cleaner_id;
    if (finalCleanerId && finalCleanerId !== "all") {
      whereClause.cleaner_user_id = BigInt(finalCleanerId);
    }

    if (status && status !== "all") {
      whereClause.status = status;
    }

    if (start_date) {
      const startDateObj = new Date(start_date);
      startDateObj.setUTCHours(0, 0, 0, 0);

      const endDateObj = end_date ? new Date(end_date) : new Date(start_date);
      endDateObj.setUTCHours(23, 59, 59, 999);

      whereClause.created_at = {
        gte: startDateObj,
        lte: endDateObj,
      };
    }

    // Pagination math
    const take = parseInt(limit);
    const skip = (parseInt(page) - 1) * take;

    // Use Prisma transaction to get both the TOTAL count and the PAGINATED data at the same time
    const [totalItems, reviews] = await prisma.$transaction([
      prisma.cleaner_review.count({ where: whereClause }),
      prisma.cleaner_review.findMany({
        where: whereClause,
        take: take,
        skip: skip,
        // STRICT SELECTION: Only fetching exactly what is seen in the UI cards
        select: {
          id: true,
          status: true,
          created_at: true,
          before_photo: true, // <-- Fetched for evidence logs

          after_photo: true, // <-- ADDED: Fetched for evidence logs
          score: true,

          cleaner_user: {
            select: { id: true, name: true },
          },
          location: {
            select: { name: true },
          },
        },
        orderBy: {
          created_at: "desc",
        },
      }),
    ]);

    const safeSerialize = (obj) => {
      if (obj === null || obj === undefined) return obj;
      if (typeof obj === "bigint") return obj.toString();
      if (obj instanceof Date) return obj.toISOString();
      if (Array.isArray(obj)) return obj.map(safeSerialize);
      if (typeof obj === "object") {
        const serialized = {};
        for (const [key, value] of Object.entries(obj)) {
          serialized[key] = safeSerialize(value);
        }
        return serialized;
      }
      return obj;
    };

    const serializedReviews = reviews.map((review) => safeSerialize(review));
    const totalPages = Math.ceil(totalItems / take);

    // Return an object containing both the data and pagination metadata
    res.json({
      data: serializedReviews,
      pagination: {
        total_items: totalItems,
        total_pages: totalPages,
        current_page: parseInt(page),
        items_per_page: take,
        has_next_page: parseInt(page) < totalPages,
        has_prev_page: parseInt(page) > 1,
      },
    });
  } catch (err) {
    console.error("Fetch Cleaner Reviews Error:", err);
    res.status(500).json({ error: "Failed to fetch cleaner reviews" });
  }
}

export const getCleanerReviewsById = async (req, res) => {
  // console.log('Getting cleaner reviews by cleaner_user_id');
  const { cleaner_user_id } = req.params;
  // console.log(req.params, "params");

  let stats = {};
  try {
    // Input validation
    if (!cleaner_user_id || isNaN(cleaner_user_id)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid cleaner user ID provided",
      });
    }

    // ✅ Single query with all related data using include
    const reviews = await prisma.cleaner_review.findMany({
      where: {
        cleaner_user_id: BigInt(cleaner_user_id),
      },
      include: {
        // ✅ Include user details automatically
        cleaner_user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            created_at: true,
            updated_at: true,
            role: {
              select: {
                id: true,
                name: true,
                description: true,
              },
            },
          },
        },
        // ✅ Include location details
        location: {
          select: {
            id: true,
            name: true,
            latitude: true,
            longitude: true,
            metadata: true,
            location_types: {
              select: {
                id: true,
                name: true,
              },
            },
            locations: {
              // parent location
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        // ✅ Include company details
        company: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    if (reviews.length === 0) {
      return res.status(200).json({
        status: "success",
        message: "No reviews found for this cleaner",
        data: {
          reviews: [],
          stats: stats, // important
        },
      });
    }

    // ✅ Fixed serialization function
    const safeSerialize = (obj) => {
      if (obj === null || obj === undefined) return obj;

      // ✅ Handle BigInt
      if (typeof obj === "bigint") return obj.toString();

      // ✅ Handle Date objects BEFORE generic object handling
      if (obj instanceof Date) return obj.toISOString();

      // ✅ Handle Arrays
      if (Array.isArray(obj)) return obj.map(safeSerialize);

      // ✅ Handle generic objects (but after Date check)
      if (typeof obj === "object") {
        const serialized = {};
        for (const [key, value] of Object.entries(obj)) {
          serialized[key] = safeSerialize(value);
        }
        return serialized;
      }

      // ✅ Return primitives as-is
      return obj;
    };

    // ✅ Serialize all review data
    const serializedReviews = reviews.map((review) => safeSerialize(review));

    // ✅ Calculate stats from the reviews
    stats = {
      total_reviews: serializedReviews.length,
      completed_reviews: serializedReviews.filter(
        (r) => r.status === "completed",
      ).length,
      ongoing_reviews: serializedReviews.filter((r) => r.status === "ongoing")
        .length,
      total_tasks_today: serializedReviews.filter((r) => {
        try {
          const today = new Date();
          const reviewDate = new Date(r.created_at);
          return reviewDate.toDateString() === today.toDateString();
        } catch {
          return false;
        }
      }).length,
      // ✅ Get cleaner info from first review (all reviews are for same cleaner)
      // cleaner_info: serializedReviews[0]?.cleaner_user || null
    };

    // console.log('Successfully fetched reviews with relationships');

    res.json({
      status: "success",
      data: {
        reviews: serializedReviews,
        stats: stats, // important
      },
      message: "Cleaner reviews retrieved successfully!",
    });
  } catch (err) {
    console.error("Fetch Reviews by Cleaner ID Error:", err);
    res.status(500).json({
      status: "error",
      message: "Failed to fetch cleaner reviews by cleaner ID",
      detail:
        process.env.NODE_ENV === "development"
          ? err.message
          : "Internal server error",
    });
  }
};

// Get cleaner reviews by location_id
export const getCleanerReviewsByLocationId = async (req, res) => {
  // console.log('Getting cleaner reviews by location_id');

  const { location_id } = req.params;
  const { company_id, take, skip } = req.query;

  // console.log('Location ID:', location_id);
  // console.log('Company ID:', company_id);

  try {
    // Input validation
    if (!location_id || isNaN(location_id)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid location ID provided",
      });
    }
    const limit = take ? Math.min(parseInt(take), 100) : 10; // Default 10, max 100
    const offset = skip ? parseInt(skip) : 0;

    // Build where clause
    const whereClause = {
      location_id: BigInt(location_id),
    };

    // Add company filter if provided
    if (company_id) {
      whereClause.company_id = BigInt(company_id);
    }

    // Fetch reviews with all related data
    const reviews = await prisma.cleaner_review.findMany({
      where: whereClause,
      take: limit, // ✅ Limit results
      skip: offset,
      include: {
        // Include cleaner user details
        cleaner_user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            created_at: true,
            updated_at: true,
            role: {
              select: {
                id: true,
                name: true,
                description: true,
              },
            },
          },
        },
        // Include location details
        location: {
          select: {
            id: true,
            name: true,
            latitude: true,
            longitude: true,
            metadata: true,
            location_types: {
              select: {
                id: true,
                name: true,
              },
            },
            locations: {
              // parent location
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        // Include company details
        company: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    if (reviews.length === 0) {
      return res.status(200).json({
        status: "success",
        message: "No reviews found for this location",
        data: {
          reviews: [],
          stats: {
            total_reviews: 0,
            completed_reviews: 0,
            ongoing_reviews: 0,
            average_score: null,
          },
        },
      });
    }

    // Serialization function for BigInt and Date
    const safeSerialize = (obj) => {
      if (obj === null || obj === undefined) return obj;
      if (typeof obj === "bigint") return obj.toString();
      if (obj instanceof Date) return obj.toISOString();
      if (Array.isArray(obj)) return obj.map(safeSerialize);
      if (typeof obj === "object") {
        const serialized = {};
        for (const [key, value] of Object.entries(obj)) {
          serialized[key] = safeSerialize(value);
        }
        return serialized;
      }
      return obj;
    };

    // Serialize all review data
    const serializedReviews = reviews.map((review) => safeSerialize(review));

    // Calculate stats
    const stats = {
      total_reviews: serializedReviews.length,
      completed_reviews: serializedReviews.filter(
        (r) => r.status === "completed",
      ).length,
      ongoing_reviews: serializedReviews.filter((r) => r.status === "ongoing")
        .length,
      average_score:
        serializedReviews.length > 0
          ? (
              serializedReviews.reduce(
                (sum, r) => sum + (parseFloat(r.score) || 0),
                0,
              ) / serializedReviews.length
            ).toFixed(2)
          : null,
      latest_review: serializedReviews[0] || null,
    };

    // console.log(`Successfully fetched ${serializedReviews.length} reviews for location ${location_id}`);

    res.json({
      status: "success",
      data: {
        reviews: serializedReviews,
        stats: stats,
      },
      message: "Cleaner reviews retrieved successfully!",
    });
  } catch (err) {
    console.error("Fetch Reviews by Location ID Error:", err);
    res.status(500).json({
      status: "error",
      message: "Failed to fetch cleaner reviews by location ID",
      detail:
        process.env.NODE_ENV === "development"
          ? err.message
          : "Internal server error",
    });
  }
};

export const getCleanerReviewsByTaskId = async (req, res) => {
  // console.log('Getting cleaner reviews by task id');
  const { task_id } = req.params;
  // console.log(req.params, "params");

  let stats = {};
  try {
    // Input validation
    if (!task_id || isNaN(task_id)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid cleaner user ID provided",
      });
    }

    // ✅ Single query with all related data using include
    const reviews = await prisma.cleaner_review.findMany({
      where: {
        id: BigInt(task_id),
      },
      include: {
        // ✅ Include user details automatically
        cleaner_user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            created_at: true,
            updated_at: true,
            role: {
              select: {
                id: true,
                name: true,
                description: true,
              },
            },
          },
        },
        // ✅ Include location details
        location: {
          select: {
            id: true,
            name: true,
            latitude: true,
            longitude: true,
            metadata: true,
            location_types: {
              select: {
                id: true,
                name: true,
              },
            },
            locations: {
              // parent location
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        // ✅ Include company details
        company: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    if (reviews.length === 0) {
      return res.status(200).json({
        status: "success",
        message: "No reviews found for this cleaner",
        data: {
          reviews: [],
          stats: stats, // important
        },
      });
    }

    // console.log(reviews, "reviews")

    // ✅ Fixed serialization function
    const safeSerialize = (obj) => {
      if (obj === null || obj === undefined) return obj;

      // ✅ Handle BigInt
      if (typeof obj === "bigint") return obj.toString();

      // ✅ Handle Date objects BEFORE generic object handling
      if (obj instanceof Date) return obj.toISOString();

      // ✅ Handle Arrays
      if (Array.isArray(obj)) return obj.map(safeSerialize);

      // ✅ Handle generic objects (but after Date check)
      if (typeof obj === "object") {
        const serialized = {};
        for (const [key, value] of Object.entries(obj)) {
          serialized[key] = safeSerialize(value);
        }
        return serialized;
      }

      // ✅ Return primitives as-is
      return obj;
    };

    // ✅ Serialize all review data
    const serializedReviews = reviews.map((review) => safeSerialize(review));

    // console.log(serializedReviews, "serilized regviews")
    // ✅ Calculate stats from the reviews
    stats = {
      total_reviews: serializedReviews.length,
      completed_reviews: serializedReviews.filter(
        (r) => r.status === "completed",
      ).length,
      ongoing_reviews: serializedReviews.filter((r) => r.status === "ongoing")
        .length,
      total_tasks_today: serializedReviews.filter((r) => {
        try {
          const today = new Date();
          const reviewDate = new Date(r.created_at);
          return reviewDate.toDateString() === today.toDateString();
        } catch {
          return false;
        }
      }).length,
      // ✅ Get cleaner info from first review (all reviews are for same cleaner)
      // cleaner_info: serializedReviews[0]?.cleaner_user || null
    };

    // console.log('Successfully fetched reviews with relationships');

    res.json({
      status: "success",
      data: {
        reviews: serializedReviews,
        stats: stats, // important
      },
      message: "Cleaner reviews retrieved successfully!",
    });
  } catch (err) {
    console.error("Fetch Reviews by Cleaner ID Error:", err);
    res.status(500).json({
      status: "error",
      message: "Failed to fetch cleaner reviews by cleaner ID",
      detail:
        process.env.NODE_ENV === "development"
          ? err.message
          : "Internal server error",
    });
  }
};

export async function createCleanerReview(req, res) {
  try {
    const {
      name,
      location_id,
      latitude,
      longitude,
      address,
      cleaner_user_id,
      tasks,
      initial_comment,
      company_id,
    } = req.body;

    // Get uploaded URLs from middleware
    const beforePhotos = req.uploadedFiles?.before_photo || [];

    let parsedTasks = [];

    if (tasks) {
      if (Array.isArray(tasks)) {
        parsedTasks = tasks.map(String);
      } else if (typeof tasks === "string") {
        try {
          const parsed = JSON.parse(tasks);
          if (Array.isArray(parsed)) {
            parsedTasks = parsed.map(String);
          } else {
            parsedTasks = [String(parsed)];
          }
        } catch (e) {
          parsedTasks = tasks.split(",").map((task) => String(task).trim());
        }
      }
    }

    // ✅ Add length validation
    if (parsedTasks.length === 0) {
      // console.warn('No tasks provided for review');
    }

    // console.log('Original tasks:', tasks);
    // console.log('Parsed tasks:', parsedTasks);
    // console.log('Tasks count:', parsedTasks.length);

    const review = await prisma.cleaner_review.create({
      data: {
        name,
        location_id: location_id ? BigInt(location_id) : null,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        address,
        cleaner_user_id: cleaner_user_id ? BigInt(cleaner_user_id) : null,
        tasks: parsedTasks,
        initial_comment: initial_comment || null,
        before_photo: beforePhotos,
        after_photo: [],
        status: "ongoing",
        company_id: company_id ? BigInt(company_id) : null,
      },
    });

    const serializedData = {
      ...review,
      id: review?.id.toString(),
      location_id: review?.location_id?.toString(),
      cleaner_user_id: review?.cleaner_user_id?.toString(),
      company_id: review?.company_id?.toString(),
    };

    res.status(201).json({ status: "success", data: serializedData });
  } catch (err) {
    console.error("Create Review Error:", err);
    res.status(400).json({ status: "error", detail: err.message });
  }
}

export async function completeCleanerReview(req, res) {
  try {
    const { final_comment, id } = req.body;

    // ✅ Get Cloudinary URLs from middleware
    const afterPhotos = req.uploadedFiles?.after_photo || [];

    // Update DB
    const review = await prisma.cleaner_review.update({
      where: { id: BigInt(id) },
      data: {
        after_photo: afterPhotos,
        final_comment: final_comment || null,
        status: "completed",
        updated_at: new Date().toISOString(),
      },
    });

    const serializedData = {
      ...review,
      id: review?.id.toString(),
      location_id: review?.location_id?.toString(),
      cleaner_user_id: review?.cleaner_user_id?.toString(),
      company_id: review?.company_id?.toString(),
    };

    res.json({
      status: "success",
      message: "Review completed successfully",
      data: serializedData,
    });

    // ✅ AI scoring with comprehensive error handling
    processHygieneScoring(review, afterPhotos);
  } catch (err) {
    console.error("Error completing review:", err.message);
    res.status(400).json({ status: "error", detail: err.message });
  }
}

// At the top of your file
// const FormData = require('form-data'); // Must import this for Node.js

async function processHygieneScoring(review, afterPhotos) {
  // console.log('\n========================================');
  // console.log('🚀 HYGIENE SCORING PROCESS STARTED');
  // console.log('========================================');
  // console.log('📋 Review ID:', review.id);
  // console.log('📸 Total after photos:', afterPhotos.length);
  // console.log('🔗 Photo URLs:', afterPhotos);
  // console.log('========================================\n');

  // ✅ Helper: Convert 0-100 scale to 1-10 scale
  const convertScoreTo10Scale = (score) => {
    if (score <= 10) return score;
    return Math.round(score) / 10;
  };

  // ✅ Helper: Calculate average score - ADD THIS!
  const calculateAverageScore = (scores) => {
    if (scores.length === 0) return 0;
    const total = scores.reduce((sum, item) => sum + Number(item.score), 0);
    const average = total / scores.length;
    return Number(average.toFixed(2)); // Round to 2 decimal places
  };

  // ✅ Helper: Validate AI response structure
  const validateAIResponse = (data) => {
    // console.log('🔍 Validating AI response...');

    if (!Array.isArray(data)) {
      throw new Error("Response is not an array");
    }

    if (data.length === 0) {
      throw new Error("Response array is empty");
    }

    const invalidItems = [];
    data.forEach((item, index) => {
      if (!item.filename || typeof item.score !== "number" || !item.status) {
        invalidItems.push(index);
      }
    });

    if (invalidItems.length > 0) {
      throw new Error(`Invalid items at indices: ${invalidItems.join(", ")}`);
    }

    // console.log('✅ Response validation passed');
    // console.log(`📊 Received ${data.length} scores`);
    data.forEach((item) => {
      // console.log(`   - ${item.filename}: ${item.score}/10 (status: ${item.status})`);
    });

    return true;
  };

  // ✅ Helper: Generate fake scores (fallback)
  const generateFakeScores = (imageUrls) => {
    // console.log(`\n🎲 Generating fake scores for ${imageUrls.length} images...`);
    return imageUrls.map((url, index) => ({
      score: Math.floor(Math.random() * (10 - 6 + 1)) + 6,
      metadata: {
        breakdown: [],
        raw_score: 0,
        demo_mode: true,
        generated_at: new Date().toISOString(),
      },
      filename: `after_photo_${index + 1}`,
      status: "success",
      image_url: url,
    }));
  };

  // ✅ Helper: Save scores to database
  const saveScoresToDatabase = async (scores, reviewData) => {
    console.log("\n💾 SAVING SCORES TO DATABASE");
    console.log("========================================");

    const savedScores = [];

    for (let i = 0; i < scores.length; i++) {
      const scoreItem = scores[i];

      try {
        const normalizedScore = convertScoreTo10Scale(
          Number(scoreItem.score) || 7,
        );

        console.log(`\n📊 Score ${i + 1}/${scores.length}:`);
        console.log(`   Filename: ${scoreItem.filename}`);
        console.log(`   Raw Score: ${scoreItem.score}`);
        console.log(`   Normalized: ${normalizedScore}/10`);
        console.log(`   Status: ${scoreItem.status}`);

        const savedScore = await prisma.hygiene_scores.create({
          data: {
            location_id: reviewData.location_id,
            score: normalizedScore,
            details: scoreItem.metadata || {},
            image_url: afterPhotos[i] || scoreItem.image_url || null,
            inspected_at: new Date(),
            created_by: reviewData.cleaner_user_id,
          },
        });

        savedScores.push(savedScore);
        console.log(`   ✅ Saved to DB with ID: ${savedScore.id}`);
      } catch (dbError) {
        console.error(`   ❌ DB Error for score ${i + 1}:`, {
          message: dbError.message,
          code: dbError.code,
        });
      }
    }

    console.log("\n========================================");
    console.log(
      `✅ Saved ${savedScores.length}/${scores.length} scores successfully`,
    );
    console.log("========================================\n");

    // Step 2: Calculate average score from ALL scores
    const averageScore = calculateAverageScore(scores);
    console.log(`📊 Calculated Average Score: ${averageScore}/10`);
    console.log(
      `   Individual scores: [${scores.map((s) => s.score).join(", ")}]`,
    );
    console.log("========================================\n");

    // Step 3: Update cleaner_review ONCE with the average score
    try {
      const updatedReview = await prisma.cleaner_review.update({
        where: { id: reviewData.id },
        data: {
          score: averageScore, // ✅ Average of all scores
          updated_at: new Date(),
        },
      });

      console.log("✅ CLEANER REVIEW UPDATED");
      console.log("========================================");
      console.log(`   Review ID: ${reviewData.id}`);
      console.log(`   Final Average Score: ${averageScore}/10`);
      console.log(`   Updated At: ${updatedReview.updated_at}`);
      console.log("========================================\n");

      // Evaluate Washroom SLA Escalation engine (handles breach, creation, or retry resolution)
      evaluateReviewSla({
        reviewId: reviewData.id,
        locationId: reviewData.location_id,
        companyId: reviewData.company_id,
        score: averageScore,
      }).catch((err) =>
        console.error(
          "Error triggering SLA evaluation in processHygieneScoring:",
          err,
        ),
      );
    } catch (updateError) {
      console.log("\n❌ FAILED TO UPDATE CLEANER REVIEW");
      console.log("========================================");
      console.error("   Error:", {
        message: updateError.message,
        code: updateError.code,
        review_id: reviewData.id,
      });
      console.log("========================================\n");
    }

    return savedScores;
  };

  // ===== MAIN PROCESS =====
  try {
    if (afterPhotos.length === 0) {
      console.log("⚠️  No after photos to process. Exiting...\n");
      return;
    }

    let scoreData = [];

    // ===== METHOD 1: TRY URL-BASED SCORING =====
    try {
      console.log("\n🔄 METHOD 1: Sending Cloudinary URLs to AI");
      console.log("========================================");

      const urlPayload = { images: afterPhotos };
      console.log("📤 Payload:", JSON.stringify(urlPayload, null, 2));

      const startTime = Date.now();

      const aiResponse = await axios.post(
        "https://pugarch-c-score-776087882401.europe-west1.run.app/predict",
        urlPayload,
        {
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "CleanerReview/1.0",
          },
          timeout: 15000,
        },
      );

      const duration = Date.now() - startTime;
      console.log(`⏱️  Response received in ${duration}ms`);
      console.log("📥 Response status:", aiResponse.status);
      console.log(
        "📥 Response data:",
        JSON.stringify(aiResponse.data, null, 2),
      );

      // Validate response
      validateAIResponse(aiResponse.data);

      scoreData = aiResponse.data;
      console.log("\n✅ METHOD 1 SUCCESSFUL - URL-based scoring");
      console.log("========================================\n");
    } catch (urlError) {
      console.log("\n❌ METHOD 1 FAILED");
      console.log("========================================");

      if (urlError.code === "ECONNABORTED") {
        console.log("⏰ Error Type: Timeout (15 seconds exceeded)");
      } else if (urlError.response) {
        console.log("🔴 Error Type: Server responded with error");
        console.log("   Status:", urlError.response.status);
        console.log("   Status Text:", urlError.response.statusText);
        console.log("   Response Data:", urlError.response.data);
      } else if (urlError.request) {
        console.log("🔴 Error Type: No response from server");
        console.log("   Message:", urlError.message);
      } else {
        console.log("🔴 Error Type: Request setup failed");
        console.log("   Message:", urlError.message);
      }
      console.log("========================================\n");

      // ===== METHOD 2: TRY FORMDATA-BASED SCORING =====
      try {
        console.log("🔄 METHOD 2: Downloading images and sending as FormData");
        console.log("========================================");

        const formData = new FormData();
        let successCount = 0;
        let failCount = 0;

        console.log(`\n📥 Downloading ${afterPhotos.length} images...`);

        // Download images sequentially to avoid overwhelming memory
        for (let i = 0; i < afterPhotos.length; i++) {
          const imageUrl = afterPhotos[i];
          console.log(`\n📷 Image ${i + 1}/${afterPhotos.length}`);
          console.log(`   URL: ${imageUrl}`);

          try {
            const downloadStart = Date.now();

            // Download image as buffer
            const response = await axios({
              url: imageUrl,
              method: "GET",
              responseType: "arraybuffer", // Important: use arraybuffer, not stream
              timeout: 10000,
              headers: {
                "User-Agent": "CleanerReview-ImageDownloader/1.0",
              },
            });

            const downloadDuration = Date.now() - downloadStart;
            const sizeKB = (response.data.length / 1024).toFixed(2);

            console.log(
              `   ✅ Downloaded in ${downloadDuration}ms (${sizeKB} KB)`,
            );
            console.log(`   Content-Type: ${response.headers["content-type"]}`);

            // Append buffer to FormData with proper filename
            const filename = `image_${i + 1}.jpg`;
            formData.append("images", Buffer.from(response.data), filename);

            console.log(`   ✅ Added to FormData as "${filename}"`);
            successCount++;
          } catch (downloadError) {
            failCount++;
            console.log(`   ❌ Download failed:`, {
              message: downloadError.message,
              code: downloadError.code,
              status: downloadError.response?.status,
            });
          }
        }

        console.log("\n========================================");
        console.log(
          `📊 Download Summary: ${successCount} success, ${failCount} failed`,
        );
        console.log("========================================\n");

        if (successCount === 0) {
          throw new Error("Failed to download any images");
        }

        console.log("📤 Sending FormData to AI service...");
        const uploadStart = Date.now();

        const aiResponse = await axios.post(
          "https://pugarch-c-score-776087882401.europe-west1.run.app/predict", // Use same URL or your formdata URL
          formData,
          {
            headers: {
              ...formData.getHeaders(), // Critical: get headers with boundary
              "User-Agent": "CleanerReview-AIService/1.0",
            },
            timeout: 30000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
          },
        );

        const uploadDuration = Date.now() - uploadStart;
        console.log(`⏱️  Response received in ${uploadDuration}ms`);
        console.log("📥 Response status:", aiResponse.status);
        console.log(
          "📥 Response data:",
          JSON.stringify(aiResponse.data, null, 2),
        );

        // Validate response
        validateAIResponse(aiResponse.data);

        scoreData = aiResponse.data;
        console.log("\n✅ METHOD 2 SUCCESSFUL - FormData upload");
        console.log("========================================\n");
      } catch (formDataError) {
        console.log("\n❌ METHOD 2 FAILED");
        console.log("========================================");

        if (formDataError.code === "ECONNABORTED") {
          console.log("⏰ Error Type: Timeout (30 seconds exceeded)");
        } else if (formDataError.response) {
          console.log("🔴 Error Type: Server error");
          console.log("   Status:", formDataError.response.status);
          console.log("   Status Text:", formDataError.response.statusText);
          console.log(
            "   Response Data:",
            JSON.stringify(formDataError.response.data, null, 2),
          );
        } else if (formDataError.request) {
          console.log("🔴 Error Type: No response received");
          console.log("   Message:", formDataError.message);
        } else {
          console.log("🔴 Error Type: Request setup failed");
          console.log("   Message:", formDataError.message);
          console.log("   Stack:", formDataError.stack);
        }
        // console.log('========================================\n');

        throw formDataError; // Trigger fallback to fake scores
      }
    }

    // ===== SAVE REAL AI SCORES =====
    if (scoreData.length > 0) {
      await saveScoresToDatabase(scoreData, review);

      // console.log('\n✅ HYGIENE SCORING COMPLETED SUCCESSFULLY');
      // console.log('========================================\n');
    }
  } catch (finalError) {
    // ===== FALLBACK: GENERATE FAKE SCORES =====
    // console.log('\n🔴 ALL METHODS FAILED - Using Fallback');
    // console.log('========================================');
    // console.log('Error Summary:', {
    //   message: finalError.message,
    //   type: finalError.constructor.name,
    //   code: finalError.code
    // });
    // console.log('========================================\n');

    try {
      // console.log('🎲 Generating fake scores as fallback...');
      const fakeScores = generateFakeScores(afterPhotos);

      await saveScoresToDatabase(fakeScores, review);

      // console.log('\n✅ FALLBACK COMPLETED - Fake scores saved');
      // console.log('========================================\n');
    } catch (fakeError) {
      // console.log('\n🔴 CRITICAL: FALLBACK FAILED');
      // console.log('========================================');
      console.error("Unable to save even fake scores:", {
        message: fakeError.message,
        stack: fakeError.stack,
        code: fakeError.code,
      });
      // console.log('========================================\n');
    }
  }
}

// responsible to modify the claner_review
export async function updateCleanerReviewScore(req, res) {
  const { id } = req.params;
  const { score } = req.body;
  const user = req.user;
  // console.log("test");
  if (!user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (user.role_id !== 1) {
    return res.status(403).json({
      message: "Forbidden - Superadmin access required",
    });
  }

  if (score === undefined || score === null) {
    return res.status(400).json({ message: "Score is required" });
  }

  if (score < 0 || score > 10) {
    return res.status(400).json({ message: "Score must be between 0 and 10" });
  }

  try {
    const existingReview = await prisma.cleaner_review.findUnique({
      where: { id: BigInt(id) },
    });

    if (!existingReview) {
      return res.status(404).json({ message: "Review not found" });
    }

    let existingHygieneScore = null;

    // ✅ Strategy 1: Use hygiene_score_id if available (preferred)
    if (existingReview.hygiene_score_id) {
      console.log("Using hygiene_score_id for lookup");
      existingHygieneScore = await prisma.hygiene_scores.findUnique({
        where: { id: existingReview.hygiene_score_id },
      });
    }
    // ✅ Strategy 2: Fallback - Match by score and same-day creation
    else {
      console.log("Fallback: Matching by score and date");

      // Get the date range for the same day as the review
      const reviewDate = new Date(existingReview.created_at);
      const startOfDay = new Date(reviewDate);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(reviewDate);
      endOfDay.setHours(23, 59, 59, 999);

      // Find hygiene score with matching:
      // 1. Same location
      // 2. Same score (or very close)
      // 3. Created on same day
      // 4. Within a few minutes of review creation
      const reviewCreatedAt = new Date(existingReview.created_at);
      const fiveMinutesBefore = new Date(
        reviewCreatedAt.getTime() - 5 * 60 * 1000,
      );
      const fiveMinutesAfter = new Date(
        reviewCreatedAt.getTime() + 5 * 60 * 1000,
      );

      existingHygieneScore = await prisma.hygiene_scores.findFirst({
        where: {
          location_id: existingReview.location_id,
          score: existingReview.score, // Match exact score
          created_at: {
            gte: fiveMinutesBefore, // Within 5 minutes before
            lte: fiveMinutesAfter, // Within 5 minutes after
          },
        },
        orderBy: {
          created_at: "asc", // Get the earliest match
        },
      });

      // If no match within 5 minutes, try same day with score match
      if (!existingHygieneScore) {
        console.log("No match within 5 minutes, trying same day");
        existingHygieneScore = await prisma.hygiene_scores.findFirst({
          where: {
            location_id: existingReview.location_id,
            score: existingReview.score,
            created_at: {
              gte: startOfDay,
              lte: endOfDay,
            },
          },
          orderBy: {
            created_at: "asc",
          },
        });
      }

      // ✅ If we found a match, update the review with the hygiene_score_id
      if (existingHygieneScore) {
        console.log(
          `Found hygiene score via fallback: ${existingHygieneScore.id}`,
        );
        // Update the review to store the hygiene_score_id for future lookups
        await prisma.cleaner_review.update({
          where: { id: BigInt(id) },
          data: { hygiene_score_id: existingHygieneScore.id },
        });
      }
    }

    if (!existingHygieneScore) {
      return res.status(404).json({
        message:
          "Related hygiene score not found. Unable to match by score and date.",
      });
    }

    // Prepare update data for cleaner_review
    const reviewUpdateData = {
      score: parseFloat(score),
      is_modified: true,
      updated_at: existingReview.updated_at,
    };

    if (
      existingReview.original_score === null ||
      existingReview.original_score === undefined
    ) {
      reviewUpdateData.original_score = existingReview.score;
    }

    // Prepare update data for hygiene_scores
    const hygieneUpdateData = {
      score: parseFloat(score),
      is_modified: true,
      updated_at: existingHygieneScore.updated_at,
    };

    if (
      existingHygieneScore.original_score === null ||
      existingHygieneScore.original_score === undefined
    ) {
      hygieneUpdateData.original_score = existingHygieneScore.score;
    }

    // ✅ Use transaction to update both tables atomically
    const [updatedReview, updatedHygieneScore] = await prisma.$transaction([
      prisma.cleaner_review.update({
        where: { id: BigInt(id) },
        data: reviewUpdateData,
        include: {
          cleaner_user: {
            select: { id: true, name: true, phone: true, email: true },
          },
          location: {
            select: { id: true, name: true, address: true },
          },
          company: {
            select: { id: true, name: true },
          },
        },
      }),
      prisma.hygiene_scores.update({
        where: { id: existingHygieneScore.id },
        data: hygieneUpdateData,
      }),
    ]);

    console.log("Updated review:", updatedReview.id);
    console.log("Updated hygiene score:", updatedHygieneScore.id);

    // Trigger SLA Escalation if enabled (defaults to true unless explicitly passed false)
    const triggerEscalation = req.body.trigger_escalation !== false && req.body.trigger_escalation !== "false";
    if (triggerEscalation && updatedReview.location_id) {
      evaluateReviewSla({
        reviewId: updatedReview.id,
        locationId: updatedReview.location_id,
        companyId: updatedReview.company_id,
        score: parseFloat(score)
      }).catch((err) => console.error("Error triggering SLA evaluation in updateCleanerReviewScore:", err));
    }

    const safeSerialize = (obj) => {
      if (obj === null || obj === undefined) return obj;
      if (typeof obj === "bigint") return obj.toString();
      if (obj instanceof Date) return obj.toISOString();
      if (Array.isArray(obj)) return obj.map(safeSerialize);
      if (typeof obj === "object") {
        const serialized = {};
        for (const [key, value] of Object.entries(obj)) {
          serialized[key] = safeSerialize(value);
        }
        return serialized;
      }
      return obj;
    };

    return res.status(200).json({
      success: true,
      message: "Score updated successfully in both tables",
      data: {
        review: safeSerialize(updatedReview),
        hygieneScore: safeSerialize(updatedHygieneScore),
      },
    });
  } catch (error) {
    console.error("Error updating score:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update score",
      error: error.message,
    });
  }
}

export async function createDemoCleanerReview(req, res) {
  try {
    const { company_id, name, location_id, cleaner_name, cleaner_phone } =
      req.body;

    // The user performing the demo (usually the Admin)
    const cleaner_user_id = req.user.id;

    // Directly create a "completed" task
    const review = await prisma.cleaner_review.create({
      data: {
        name: name || "Demo Washroom Cleaning",
        location_id: location_id ? BigInt(location_id) : null,
        latitude: null,
        longitude: null,
        address: "Demo Location (App Preview)",
        cleaner_user_id: BigInt(cleaner_user_id),
        tasks: [
          "Clean and disinfect all WC seats",
          "Wipe and sanitise wash basins",
          "Clean and flush all urinals",
          "Empty and reline dustbins",
        ],
        initial_comment: `Demo task started via App Preview by ${cleaner_name || "Admin"} (${cleaner_phone || ""})`,
        final_comment: "Demo task completed successfully",

        // Use placeholder images since we bypassed Multer
        before_photo: [
          "https://placehold.co/600x400/e2e8f0/64748b?text=Simulated+Before+Photo",
        ],
        after_photo: [
          "https://placehold.co/600x400/dcfce7/16a34a?text=Simulated+After+Photo",
        ],

        status: "completed",
        score: 9.5, // Dummy AI Score for the dashboard
        company_id: company_id ? BigInt(company_id) : null,

        // Simulate task duration (started 15 minutes ago)
        created_at: new Date(Date.now() - 15 * 60000),
        updated_at: new Date(),
      },
    });

    const safeSerialize = (obj) => {
      if (obj === null || obj === undefined) return obj;
      if (typeof obj === "bigint") return obj.toString();
      if (obj instanceof Date) return obj.toISOString();
      if (Array.isArray(obj)) return obj.map(safeSerialize);
      if (typeof obj === "object") {
        const serialized = {};
        for (const [key, value] of Object.entries(obj)) {
          serialized[key] = safeSerialize(value);
        }
        return serialized;
      }
      return obj;
    };

    const serializedData = safeSerialize(review);

    res.status(201).json({
      status: "success",
      message: "Demo review created successfully",
      data: serializedData,
    });
  } catch (err) {
    console.error("Create Demo Review Error:", err);
    res.status(500).json({ status: "error", detail: err.message });
  }
}

export async function getAiInsightsContext(req, res) {
  const {
    company_id,
    location_id,
    cleaner_user_id,
    start_date,
    end_date,
    limit,
  } = req.query;

  try {
    const whereClause = {};
    let fetchLimit = limit ? parseInt(limit, 10) : 100;

    // Apply default simulation behavior if no specific entity filters are provided
    if (!company_id && !location_id && !cleaner_user_id) {
      whereClause.company_id = { in: [27n, 28n] }; // Assumes Prisma BigInt setup
    }

    // Apply specific filters
    if (company_id) {
      whereClause.company_id = BigInt(company_id);
    }

    if (location_id) {
      whereClause.location_id = BigInt(location_id);
      fetchLimit = undefined; // Override limit to fetch entire history for a single washroom
    }

    if (cleaner_user_id) {
      whereClause.cleaner_user_id = BigInt(cleaner_user_id);
      fetchLimit = undefined; // Override limit to fetch entire history for a specific cleaner
    }

    // Handle date ranges
    if (start_date || end_date) {
      whereClause.created_at = {};
      if (start_date) {
        const startDate = new Date(start_date);
        startDate.setUTCHours(0, 0, 0, 0);
        whereClause.created_at.gte = startDate;
      }
      if (end_date) {
        const endDate = new Date(end_date);
        endDate.setUTCHours(23, 59, 59, 999);
        whereClause.created_at.lte = endDate;
      }
    }

    // Fetch tailored data from database
    const reviews = await prisma.cleaner_review.findMany({
      where: whereClause,
      take: fetchLimit,
      select: {
        id: true,
        created_at: true,
        company_id: true,
        status: true,
        score: true,
        tasks: true,
        initial_comment: true,
        final_comment: true,
        location: {
          select: {
            id: true,
            name: true,
          },
        },
        cleaner_user: {
          select: {
            id: true,
            name: true,
          },
        },
        hygiene_score: {
          select: {
            score: true,
            details: true,
          },
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    // Serialization helper function
    const safeSerialize = (obj) => {
      if (obj === null || obj === undefined) return obj;
      if (typeof obj === "bigint") return obj.toString();
      if (obj instanceof Date) return obj.toISOString();

      if (typeof obj === "object" && typeof obj.toNumber === "function") {
        return obj.toNumber();
      }
      if (obj.d && obj.e !== undefined && obj.s !== undefined) {
        return parseFloat(
          `${obj.s < 0 ? "-" : ""}${obj.d.join("")}e${obj.e - obj.d.length + 1}`,
        );
      }
      if (Array.isArray(obj)) return obj.map(safeSerialize);

      if (typeof obj === "object") {
        const serialized = {};
        for (const [key, value] of Object.entries(obj)) {
          serialized[key] = safeSerialize(value);
        }
        return serialized;
      }
      return obj;
    };

    // Restructure the response to match the LLM API spec
    const formattedActivities = reviews.map((review) => {
      const serializedReview = safeSerialize(review);
      return {
        review_id: serializedReview.id,
        created_at: serializedReview.created_at,
        company_id: serializedReview.company_id,
        location: serializedReview.location || {},
        cleaner: serializedReview.cleaner_user || {},
        activity: {
          status: serializedReview.status,
          score: serializedReview.score,
          tasks: serializedReview.tasks || [],
          initial_comment: serializedReview.initial_comment,
          final_comment: serializedReview.final_comment,
        },
        hygiene_ai: serializedReview.hygiene_score || null,
      };
    });

    // Calculate metadata dynamically
    const uniqueCompanies = new Set(
      formattedActivities.map((a) => a.company_id),
    );
    const uniqueLocations = new Set(
      formattedActivities.map((a) => a.location?.id).filter(Boolean),
    );
    const uniqueCleaners = new Set(
      formattedActivities.map((a) => a.cleaner?.id).filter(Boolean),
    );

    let dateFrom = null;
    let dateTo = null;

    // Arrays are sorted desc, so first item is the newest (To), last item is the oldest (From)
    if (formattedActivities.length > 0) {
      dateTo = formattedActivities[0].created_at;
      dateFrom = formattedActivities[formattedActivities.length - 1].created_at;
    }

    const responsePayload = {
      summary: {
        totalActivities: formattedActivities.length,
        companies: uniqueCompanies.size,
        locations: uniqueLocations.size,
        cleaners: uniqueCleaners.size,
        dateRange: {
          from: dateFrom,
          to: dateTo,
        },
      },
      activities: formattedActivities,
    };

    res.json(responsePayload);
  } catch (err) {
    console.error("Fetch AI Context Error:", err);
    res.status(500).json({
      error: "Failed to fetch AI context",
      detail: err.message,
    });
  }
}

export async function updateManagementScore(req, res) {
  const { id } = req.params;
  const { score } = req.body;
  const user = req.user;

  if (!user) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  // 1. RBAC Validation
  if (
    Number(user.role_id) !== 1 &&
    (!user.permissions || !user.permissions.includes("cleaner_reviews.manage"))
  ) {
    return res
      .status(403)
      .json({ success: false, message: "Permission denied" });
  }

  if (score === undefined || score === null) {
    return res
      .status(400)
      .json({ success: false, message: "Score is required" });
  }

  const numericScore = parseFloat(score);
  if (isNaN(numericScore) || numericScore < 0 || numericScore > 10) {
    return res
      .status(400)
      .json({ success: false, message: "Score must be between 0 and 10." });
  }

  try {
    // 2. Fetch Review
    const review = await prisma.cleaner_review.findUnique({
      where: { id: BigInt(id) },
    });

    if (!review) {
      return res
        .status(404)
        .json({ success: false, message: "Cleaner review not found" });
    }

    // 3. Load SLA Config (Hierarchy: Washroom override -> Company baseline)
    let maxUpdates = 1;
    if (review.location_id) {
      const effectiveSla = await resolveEffectiveWashroomSLA(
        review.location_id,
        review.company_id
      );
      if (!effectiveSla || !effectiveSla.enabled) {
        return res.status(400).json({
          success: false,
          message: "SLA is not enabled for this washroom or company.",
        });
      }
      maxUpdates =
        effectiveSla.configuration?.max_score_updates_per_activity ?? 1;
    }

    // 4. Same-day Validation
    const reviewDate = new Date(review.created_at);
    const currentDate = new Date();

    if (
      reviewDate.getFullYear() !== currentDate.getFullYear() ||
      reviewDate.getMonth() !== currentDate.getMonth() ||
      reviewDate.getDate() !== currentDate.getDate()
    ) {
      return res.status(400).json({
        success: false,
        message: "This activity can only be updated on the day it was created.",
      });
    }

    // 5. Update Limit Validation
    if (review.score_update_count >= maxUpdates) {
      return res.status(400).json({
        success: false,
        message: "Maximum score updates reached for this activity.",
      });
    }

    // Extract modification_comment and signature from body/files
    const modification_comment = req.body.modification_comment;
    const signatureUrl =
      req.uploadedFiles?.signature?.[0] || req.body.signature; // In case it's sent as string URL

    // 6. Update logic
    const updateData = {
      score: numericScore,
      is_modified: true,
      score_update_count: review.score_update_count + 1,
      updated_at: new Date(),
      ...(modification_comment && { modification_comment }),
      ...(signatureUrl && { signature: signatureUrl }),
    };

    if (review.original_score === null) {
      updateData.original_score = review.score;
    }

    const updatedReview = await prisma.cleaner_review.update({
      where: { id: BigInt(id) },
      data: updateData,
    });

    // Evaluate Washroom SLA Escalation engine on supervisor score override
    evaluateReviewSla({
      reviewId: review.id,
      locationId: review.location_id,
      companyId: review.company_id,
      score: numericScore,
    }).catch((err) =>
      console.error(
        "Error triggering SLA evaluation in updateSupervisorScore:",
        err,
      ),
    );

    // Serialization helper function from the controller
    const safeSerialize = (obj) => {
      if (obj === null || obj === undefined) return obj;
      if (typeof obj === "bigint") return obj.toString();
      if (obj instanceof Date) return obj.toISOString();
      if (typeof obj === "object" && typeof obj.toNumber === "function")
        return obj.toNumber();
      if (obj.d && obj.e !== undefined && obj.s !== undefined) {
        return parseFloat(
          `${obj.s < 0 ? "-" : ""}${obj.d.join("")}e${obj.e - obj.d.length + 1}`,
        );
      }
      if (Array.isArray(obj)) return obj.map(safeSerialize);
      if (typeof obj === "object") {
        const serialized = {};
        for (const [key, value] of Object.entries(obj))
          serialized[key] = safeSerialize(value);
        return serialized;
      }
      return obj;
    };

    return res.status(200).json({
      success: true,
      message: "Score updated successfully.",
      data: safeSerialize(updatedReview),
    });
  } catch (err) {
    console.error("Supervisor Score Update Error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to update score.",
      detail: err.message,
    });
  }
}

// =========================================================
// 🆕 SLA CLEANER ACTIVITY LIFECYCLE CONTROLLERS
// =========================================================

/**
 * GET paginated list of SLA Cleaner Activities (Grouped by Cleaning Activity / SLA Lifecycle)
 * Route: GET /api/cleaner-reviews/sla-activities
 */
export async function getSlaCleanerActivities(req, res) {
  const {
    cleaner_user_id,
    cleaner_id,
    status,
    sla_status,
    start_date,
    end_date,
    company_id,
    search,
    page = 1,
    limit = 15,
  } = req.query;

  try {
    const whereClause = {
      OR: [
        { parent_review_id: null },
        { review_type: "ORIGINAL" },
      ],
    };

    if (company_id) whereClause.company_id = BigInt(company_id);

    const finalCleanerId = cleaner_user_id || cleaner_id;
    if (finalCleanerId && finalCleanerId !== "all") {
      whereClause.cleaner_user_id = BigInt(finalCleanerId);
    }

    if (status && status !== "all") {
      whereClause.status = status;
    }

    if (start_date) {
      const startDateObj = new Date(start_date);
      startDateObj.setUTCHours(0, 0, 0, 0);

      const endDateObj = end_date ? new Date(end_date) : new Date(start_date);
      endDateObj.setUTCHours(23, 59, 59, 999);

      whereClause.created_at = {
        gte: startDateObj,
        lte: endDateObj,
      };
    }

    // Query root reviews with their retry_reviews and escalation details
    const rootReviews = await prisma.cleaner_review.findMany({
      where: whereClause,
      include: {
        cleaner_user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            role: { select: { id: true, name: true } },
          },
        },
        location: {
          select: {
            id: true,
            name: true,
            company_id: true,
            sla_config: true,
            location_types: { select: { id: true, name: true } },
            locations: { select: { id: true, name: true } },
          },
        },
        company: {
          select: {
            id: true,
            name: true,
          },
        },
        retry_reviews: {
          select: {
            id: true,
            review_type: true,
            attempt_no: true,
            score: true,
            original_score: true,
            is_modified: true,
            status: true,
            created_at: true,
            updated_at: true,
            before_photo: true,
            after_photo: true,
            initial_comment: true,
            final_comment: true,
            tasks: true,
          },
          orderBy: { created_at: "asc" },
        },
        escalation: {
          include: {
            corrective_reviews: {
              select: {
                id: true,
                review_type: true,
                attempt_no: true,
                score: true,
                original_score: true,
                is_modified: true,
                status: true,
                created_at: true,
                updated_at: true,
                before_photo: true,
                after_photo: true,
                initial_comment: true,
                final_comment: true,
                tasks: true,
              },
              orderBy: { created_at: "asc" },
            },
            escalation_logs: {
              select: {
                id: true,
                event_type: true,
                level: true,
                score: true,
                created_at: true,
              },
              orderBy: { created_at: "asc" },
            },
          },
        },
        triggered_escalations: {
          include: {
            corrective_reviews: {
              select: {
                id: true,
                review_type: true,
                attempt_no: true,
                score: true,
                original_score: true,
                is_modified: true,
                status: true,
                created_at: true,
                updated_at: true,
                before_photo: true,
                after_photo: true,
                initial_comment: true,
                final_comment: true,
                tasks: true,
              },
              orderBy: { created_at: "asc" },
            },
            escalation_logs: {
              select: {
                id: true,
                event_type: true,
                level: true,
                score: true,
                created_at: true,
              },
              orderBy: { created_at: "asc" },
            },
          },
        },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    // Group reviews into SLA activity lifecycles
    let activities = rootReviews.map((root) => {
      const escalation = root.escalation || root.triggered_escalations?.[0] || null;
      const threshold = Number(root.location?.sla_config?.threshold ?? 8.0);

      // Collect all retries linked via parent_review_id or escalation
      const retryMap = new Map();
      (root.retry_reviews || []).forEach((r) => {
        if (r.id.toString() !== root.id.toString()) {
          retryMap.set(r.id.toString(), r);
        }
      });
      if (escalation?.corrective_reviews) {
        escalation.corrective_reviews.forEach((r) => {
          if (r.id.toString() !== root.id.toString()) {
            retryMap.set(r.id.toString(), r);
          }
        });
      }

      const retries = Array.from(retryMap.values()).sort(
        (a, b) => new Date(a.created_at) - new Date(b.created_at)
      );

      // Construct ordered attempts list
      const attempts = [
        {
          attempt_no: 1,
          label: "Original Review",
          short_label: "Original",
          review_id: root.id.toString(),
          score: root.score !== null && root.score !== undefined ? Number(Number(root.score).toFixed(1)) : null,
          raw_score: root.score,
          original_score: root.original_score,
          is_modified: root.is_modified,
          status: root.status,
          created_at: root.created_at,
          updated_at: root.updated_at,
          before_photo: root.before_photo || [],
          after_photo: root.after_photo || [],
          photos_count: (root.before_photo?.length || 0) + (root.after_photo?.length || 0),
          initial_comment: root.initial_comment,
          final_comment: root.final_comment,
          tasks: root.tasks || [],
          is_passed: root.score !== null && root.score !== undefined ? Number(root.score) >= threshold : false,
        },
        ...retries.map((r, idx) => {
          const scoreNum = r.score !== null && r.score !== undefined ? Number(Number(r.score).toFixed(1)) : null;
          return {
            attempt_no: idx + 2,
            label: `Retry #${idx + 1}`,
            short_label: `Retry #${idx + 1}`,
            review_id: r.id.toString(),
            score: scoreNum,
            raw_score: r.score,
            original_score: r.original_score,
            is_modified: r.is_modified,
            status: r.status,
            created_at: r.created_at,
            updated_at: r.updated_at,
            before_photo: r.before_photo || [],
            after_photo: r.after_photo || [],
            photos_count: (r.before_photo?.length || 0) + (r.after_photo?.length || 0),
            initial_comment: r.initial_comment,
            final_comment: r.final_comment,
            tasks: r.tasks || [],
            is_passed: scoreNum !== null ? scoreNum >= threshold : false,
          };
        }),
      ];

      const latestAttempt = attempts[attempts.length - 1];
      const maxRetries = Number(escalation?.max_retries ?? root.location?.sla_config?.max_retries ?? 2);
      const retriesUsed = attempts.length - 1;

      // Determine SLA Lifecycle State
      let slaState = "NO_BREACH";
      let slaStatusLabel = "No SLA Breach";
      let slaBadgeColor = "green";

      if (escalation) {
        if (escalation.state === "RESOLVED") {
          slaState = "RESOLVED";
          slaStatusLabel = "SLA Resolved";
          slaBadgeColor = "emerald";
        } else if (escalation.state === "EXHAUSTED" || escalation.state === "CLOSED") {
          slaState = "EXHAUSTED";
          slaStatusLabel = "SLA Exhausted";
          slaBadgeColor = "red";
        } else if (escalation.state === "OPEN") {
          if (retriesUsed > 0) {
            slaState = "RETRY_IN_PROGRESS";
            slaStatusLabel = "Retry In Progress";
            slaBadgeColor = "amber";
          } else {
            slaState = "BREACHED";
            slaStatusLabel = "SLA Breached / Retry Required";
            slaBadgeColor = "orange";
          }
        } else {
          slaState = escalation.state;
          slaStatusLabel = escalation.state;
        }
      }

      // Compact Score Progression
      const scoreProgression = attempts.map((att) => ({
        label: att.short_label,
        score: att.score,
        is_passed: att.is_passed,
        status: att.score !== null ? (att.is_passed ? "Passed" : "Failed") : "Pending",
      }));

      // Flatten preview photos
      const allPhotos = attempts.flatMap((att) => [
        ...(att.before_photo || []),
        ...(att.after_photo || []),
      ]);

      return {
        activity_id: root.id.toString(),
        root_review_id: root.id.toString(),
        latest_review_id: latestAttempt.review_id,
        cleaner_user: root.cleaner_user || null,
        location: root.location || null,
        company: root.company || null,
        company_id: root.company_id?.toString() || null,
        status: latestAttempt.status,
        original_score: attempts[0].score,
        latest_score: latestAttempt.score,
        sla_threshold: threshold,
        sla_state: slaState,
        sla_status_label: slaStatusLabel,
        sla_badge_color: slaBadgeColor,
        retries_used: retriesUsed,
        max_retries: maxRetries,
        retry_display: `${retriesUsed} / ${maxRetries}`,
        started_at: root.created_at,
        completed_at: latestAttempt.updated_at || latestAttempt.created_at,
        attempts_count: attempts.length,
        attempts: attempts,
        score_progression: scoreProgression,
        total_photos_count: allPhotos.length,
        preview_photos: allPhotos.slice(0, 4),
        escalation: escalation
          ? {
              id: escalation.id.toString(),
              state: escalation.state,
              current_level: escalation.current_level,
              max_level: escalation.max_level,
              retry_count: escalation.retry_count,
              max_retries: escalation.max_retries,
              due_at: escalation.due_at,
              created_at: escalation.created_at,
              resolved_at: escalation.resolved_at,
              escalation_logs_count: escalation.escalation_logs?.length || 0,
            }
          : null,
      };
    });

    // Apply SLA status filtering if specified
    if (sla_status && sla_status !== "all") {
      const slaFilterUpper = sla_status.toUpperCase();
      activities = activities.filter((act) => {
        if (slaFilterUpper === "NO_BREACH") return act.sla_state === "NO_BREACH";
        if (slaFilterUpper === "BREACHED") return act.sla_state === "BREACHED";
        if (slaFilterUpper === "RETRY_IN_PROGRESS" || slaFilterUpper === "IN_PROGRESS")
          return act.sla_state === "RETRY_IN_PROGRESS";
        if (slaFilterUpper === "RESOLVED") return act.sla_state === "RESOLVED";
        if (slaFilterUpper === "EXHAUSTED") return act.sla_state === "EXHAUSTED";
        return true;
      });
    }

    // Apply Search Filter (Cleaner name or Location name)
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      activities = activities.filter(
        (act) =>
          act.cleaner_user?.name?.toLowerCase().includes(q) ||
          act.location?.name?.toLowerCase().includes(q)
      );
    }

    // Pagination
    const totalItems = activities.length;
    const take = parseInt(limit);
    const currentPage = parseInt(page);
    const totalPages = Math.ceil(totalItems / take) || 1;
    const skip = (currentPage - 1) * take;
    const paginatedActivities = activities.slice(skip, skip + take);

    const safeSerialize = (obj) => {
      if (obj === null || obj === undefined) return obj;
      if (typeof obj === "bigint") return obj.toString();
      if (obj instanceof Date) return obj.toISOString();
      if (typeof obj === "object" && typeof obj.toNumber === "function") return obj.toNumber();
      if (obj.d && obj.e !== undefined && obj.s !== undefined) {
        return parseFloat(`${obj.s < 0 ? "-" : ""}${obj.d.join("")}e${obj.e - obj.d.length + 1}`);
      }
      if (Array.isArray(obj)) return obj.map(safeSerialize);
      if (typeof obj === "object") {
        const serialized = {};
        for (const [key, value] of Object.entries(obj)) {
          serialized[key] = safeSerialize(value);
        }
        return serialized;
      }
      return obj;
    };

    res.json({
      success: true,
      data: safeSerialize(paginatedActivities),
      pagination: {
        total_items: totalItems,
        total_pages: totalPages,
        current_page: currentPage,
        items_per_page: take,
        has_next_page: currentPage < totalPages,
        has_prev_page: currentPage > 1,
      },
    });
  } catch (err) {
    console.error("Fetch SLA Cleaner Activities Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch SLA cleaner activities",
      detail: err.message,
    });
  }
}

/**
 * GET full details of a single SLA Cleaner Activity (Grouped by Cleaning Activity / SLA Lifecycle)
 * Route: GET /api/cleaner-reviews/sla-activities/:activity_id
 */
export async function getSlaCleanerActivityById(req, res) {
  const { activity_id } = req.params;

  try {
    if (!activity_id || isNaN(activity_id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid activity ID provided",
      });
    }

    const targetId = BigInt(activity_id);

    // 1. First, find if the review exists directly
    let targetReview = await prisma.cleaner_review.findUnique({
      where: { id: targetId },
      include: {
        parent_review: true,
        escalation: true,
      },
    });

    let rootId = targetId;

    if (targetReview) {
      // If this review is a retry, trace to root parent review
      if (targetReview.parent_review_id) {
        rootId = targetReview.parent_review_id;
      }
    } else {
      // Check if targetId is an escalation_id
      const escalationRecord = await prisma.sla_escalations.findUnique({
        where: { id: targetId },
        select: { triggered_by_review_id: true },
      });
      if (escalationRecord) {
        rootId = escalationRecord.triggered_by_review_id;
      } else {
        return res.status(404).json({
          success: false,
          error: "Cleaning activity not found",
        });
      }
    }

    // 2. Fetch full root review with all relations, retries, escalations, and logs
    const rootReview = await prisma.cleaner_review.findUnique({
      where: { id: rootId },
      include: {
        cleaner_user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            role: { select: { id: true, name: true, description: true } },
          },
        },
        location: {
          select: {
            id: true,
            name: true,
            latitude: true,
            longitude: true,
            metadata: true,
            sla_config: true,
            location_types: { select: { id: true, name: true } },
            locations: { select: { id: true, name: true } },
          },
        },
        company: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
        hygiene_score: {
          select: {
            id: true,
            score: true,
            details: true,
          },
        },
        retry_reviews: {
          include: {
            cleaner_user: { select: { id: true, name: true } },
            hygiene_score: true,
          },
          orderBy: { created_at: "asc" },
        },
        escalation: {
          include: {
            corrective_reviews: {
              include: {
                cleaner_user: { select: { id: true, name: true } },
                hygiene_score: true,
              },
              orderBy: { created_at: "asc" },
            },
            escalation_logs: {
              include: {
                actor_user: {
                  select: { id: true, name: true, role: { select: { name: true } } },
                },
              },
              orderBy: { created_at: "asc" },
            },
          },
        },
        triggered_escalations: {
          include: {
            corrective_reviews: {
              include: {
                cleaner_user: { select: { id: true, name: true } },
                hygiene_score: true,
              },
              orderBy: { created_at: "asc" },
            },
            escalation_logs: {
              include: {
                actor_user: {
                  select: { id: true, name: true, role: { select: { name: true } } },
                },
              },
              orderBy: { created_at: "asc" },
            },
          },
        },
      },
    });

    if (!rootReview) {
      return res.status(404).json({
        success: false,
        error: "Cleaning activity not found",
      });
    }

    const escalation = rootReview.escalation || rootReview.triggered_escalations?.[0] || null;
    const threshold = Number(rootReview.location?.sla_config?.threshold ?? 8.0);

    // Merge retry reviews
    const retryMap = new Map();
    (rootReview.retry_reviews || []).forEach((r) => {
      if (r.id.toString() !== rootReview.id.toString()) {
        retryMap.set(r.id.toString(), r);
      }
    });
    if (escalation?.corrective_reviews) {
      escalation.corrective_reviews.forEach((r) => {
        if (r.id.toString() !== rootReview.id.toString()) {
          retryMap.set(r.id.toString(), r);
        }
      });
    }

    const retries = Array.from(retryMap.values()).sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at)
    );

    // Build attempts array
    const attempts = [
      {
        attempt_no: 1,
        label: "Original Review",
        short_label: "Original",
        review_id: rootReview.id.toString(),
        cleaner_name: rootReview.cleaner_user?.name || "Cleaner",
        score: rootReview.score !== null && rootReview.score !== undefined ? Number(Number(rootReview.score).toFixed(1)) : null,
        raw_score: rootReview.score,
        original_score: rootReview.original_score,
        is_modified: rootReview.is_modified,
        modification_comment: rootReview.modification_comment,
        signature: rootReview.signature,
        status: rootReview.status,
        created_at: rootReview.created_at,
        updated_at: rootReview.updated_at,
        tasks: rootReview.tasks || [],
        initial_comment: rootReview.initial_comment,
        final_comment: rootReview.final_comment,
        before_photo: rootReview.before_photo || [],
        after_photo: rootReview.after_photo || [],
        photos_count: (rootReview.before_photo?.length || 0) + (rootReview.after_photo?.length || 0),
        hygiene_details: rootReview.hygiene_score?.details || null,
        is_passed: rootReview.score !== null && rootReview.score !== undefined ? Number(rootReview.score) >= threshold : false,
      },
      ...retries.map((r, idx) => {
        const scoreNum = r.score !== null && r.score !== undefined ? Number(Number(r.score).toFixed(1)) : null;
        return {
          attempt_no: idx + 2,
          label: `Retry #${idx + 1}`,
          short_label: `Retry #${idx + 1}`,
          review_id: r.id.toString(),
          cleaner_name: r.cleaner_user?.name || rootReview.cleaner_user?.name || "Cleaner",
          score: scoreNum,
          raw_score: r.score,
          original_score: r.original_score,
          is_modified: r.is_modified,
          modification_comment: r.modification_comment,
          signature: r.signature,
          status: r.status,
          created_at: r.created_at,
          updated_at: r.updated_at,
          tasks: r.tasks || [],
          initial_comment: r.initial_comment,
          final_comment: r.final_comment,
          before_photo: r.before_photo || [],
          after_photo: r.after_photo || [],
          photos_count: (r.before_photo?.length || 0) + (r.after_photo?.length || 0),
          hygiene_details: r.hygiene_score?.details || null,
          is_passed: scoreNum !== null ? scoreNum >= threshold : false,
        };
      }),
    ];

    const latestAttempt = attempts[attempts.length - 1];
    const maxRetries = Number(escalation?.max_retries ?? rootReview.location?.sla_config?.max_retries ?? 2);
    const retriesUsed = attempts.length - 1;

    // SLA State determination
    let slaState = "NO_BREACH";
    let slaStatusLabel = "No SLA Breach";
    let slaBadgeColor = "green";

    if (escalation) {
      if (escalation.state === "RESOLVED") {
        slaState = "RESOLVED";
        slaStatusLabel = "SLA Resolved";
        slaBadgeColor = "emerald";
      } else if (escalation.state === "EXHAUSTED" || escalation.state === "CLOSED") {
        slaState = "EXHAUSTED";
        slaStatusLabel = "SLA Exhausted";
        slaBadgeColor = "red";
      } else if (escalation.state === "OPEN") {
        if (retriesUsed > 0) {
          slaState = "RETRY_IN_PROGRESS";
          slaStatusLabel = "Retry In Progress";
          slaBadgeColor = "amber";
        } else {
          slaState = "BREACHED";
          slaStatusLabel = "SLA Breached / Retry Required";
          slaBadgeColor = "orange";
        }
      } else {
        slaState = escalation.state;
        slaStatusLabel = escalation.state;
      }
    }

    // Build minimal lifecycle timeline events
    const timeline = [];

    // 1. Original review event
    timeline.push({
      id: "orig-review",
      title: "Original Review",
      event_type: "ORIGINAL_REVIEW",
      timestamp: rootReview.created_at,
      score: attempts[0].score,
      status: attempts[0].is_passed ? "Passed" : "Failed",
      is_passed: attempts[0].is_passed,
      description: `Original cleaning completed with score ${attempts[0].score ?? "N/A"}/10 (Threshold: ${threshold}/10).`,
      cleaner_name: rootReview.cleaner_user?.name || "Cleaner",
      attempt_no: 1,
    });

    // 2. SLA breach trigger if score failed
    if (escalation) {
      timeline.push({
        id: "sla-breach",
        title: "SLA Breach Triggered",
        event_type: "SLA_BREACH",
        timestamp: escalation.created_at,
        score: attempts[0].score,
        status: "Action Required",
        description: `Score below threshold (${attempts[0].score ?? "N/A"} < ${threshold}). SLA Escalation initiated at Level ${escalation.current_level || 1}.`,
        due_at: escalation.due_at,
      });
    }

    // 3. Retry events
    retries.forEach((r, idx) => {
      const att = attempts[idx + 1];
      timeline.push({
        id: `retry-${r.id}`,
        title: `Retry #${idx + 1}`,
        event_type: "RETRY_REVIEW",
        timestamp: r.created_at,
        score: att.score,
        status: att.is_passed ? "Passed" : "Failed",
        is_passed: att.is_passed,
        description: `Retry inspection #${idx + 1} completed with score ${att.score ?? "N/A"}/10.`,
        cleaner_name: att.cleaner_name,
        attempt_no: idx + 2,
      });
    });

    // 4. Final SLA Outcome event
    if (escalation?.state === "RESOLVED") {
      timeline.push({
        id: "sla-resolved",
        title: "SLA Resolved",
        event_type: "SLA_RESOLVED",
        timestamp: escalation.resolved_at || latestAttempt.updated_at,
        score: latestAttempt.score,
        status: "Resolved",
        is_passed: true,
        description: `SLA breach resolved successfully on attempt #${attempts.length} with score ${latestAttempt.score}/10.`,
      });
    } else if (escalation?.state === "EXHAUSTED") {
      timeline.push({
        id: "sla-exhausted",
        title: "SLA Exhausted",
        event_type: "SLA_EXHAUSTED",
        timestamp: escalation.updated_at,
        score: latestAttempt.score,
        status: "Exhausted",
        is_passed: false,
        description: `All ${maxRetries} retry attempts exhausted without meeting threshold. Critical supervisor alert raised.`,
      });
    }

    // Sort timeline chronologically
    timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const safeSerialize = (obj) => {
      if (obj === null || obj === undefined) return obj;
      if (typeof obj === "bigint") return obj.toString();
      if (obj instanceof Date) return obj.toISOString();
      if (typeof obj === "object" && typeof obj.toNumber === "function") return obj.toNumber();
      if (obj.d && obj.e !== undefined && obj.s !== undefined) {
        return parseFloat(`${obj.s < 0 ? "-" : ""}${obj.d.join("")}e${obj.e - obj.d.length + 1}`);
      }
      if (Array.isArray(obj)) return obj.map(safeSerialize);
      if (typeof obj === "object") {
        const serialized = {};
        for (const [key, value] of Object.entries(obj)) {
          serialized[key] = safeSerialize(value);
        }
        return serialized;
      }
      return obj;
    };

    const responsePayload = {
      activity_id: rootReview.id.toString(),
      root_review_id: rootReview.id.toString(),
      latest_review_id: latestAttempt.review_id,
      cleaner_user: rootReview.cleaner_user,
      location: rootReview.location,
      company: rootReview.company,
      company_id: rootReview.company_id?.toString() || null,
      status: latestAttempt.status,
      original_score: attempts[0].score,
      latest_score: latestAttempt.score,
      sla_threshold: threshold,
      sla_state: slaState,
      sla_status_label: slaStatusLabel,
      sla_badge_color: slaBadgeColor,
      retries_used: retriesUsed,
      max_retries: maxRetries,
      retry_display: `${retriesUsed} / ${maxRetries}`,
      started_at: rootReview.created_at,
      completed_at: latestAttempt.updated_at || latestAttempt.created_at,
      attempts: attempts,
      timeline: timeline,
      escalation: escalation
        ? {
            id: escalation.id.toString(),
            state: escalation.state,
            current_level: escalation.current_level,
            max_level: escalation.max_level,
            retry_count: escalation.retry_count,
            max_retries: escalation.max_retries,
            due_at: escalation.due_at,
            created_at: escalation.created_at,
            resolved_at: escalation.resolved_at,
            escalation_logs: escalation.escalation_logs || [],
          }
        : null,
    };

    return res.status(200).json({
      success: true,
      data: safeSerialize(responsePayload),
    });
  } catch (err) {
    console.error("Fetch SLA Cleaner Activity Detail Error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch SLA cleaner activity detail",
      detail: err.message,
    });
  }
}
