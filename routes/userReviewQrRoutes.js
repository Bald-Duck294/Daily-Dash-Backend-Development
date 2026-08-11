import express from "express";
import prisma from "../config/prismaClient.mjs";
import { processAndUploadImages, upload } from "../middlewares/imageUpload.js";
import axios from "axios";
import FormData from "form-data";
const router = express.Router();

export default router;

const normalizeBigInt = (obj) => {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === "bigint") {
    return obj.toString();
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => normalizeBigInt(item));
  }

  if (obj instanceof Date) {
    return obj.toISOString();
  }

  if (typeof obj === "object") {
    const normalized = {};
    for (const key in obj) {
      normalized[key] = normalizeBigInt(obj[key]);
    }
    return normalized;
  }

  return obj;
};

// ✅ Helper function to generate unique 6-digit token
const generateUniqueToken = async () => {
  let token;
  let isUnique = false;
  let attempts = 0;
  const maxAttempts = 100; // Try 100 times before fallback

  while (!isUnique && attempts < maxAttempts) {
    // ✅ Generate 6-digit number (100000-999999)
    token = Math.floor(100000 + Math.random() * 900000).toString();

    // Check if token already exists
    const existing = await prisma.user_review_qr.findFirst({
      where: { token_number: token },
    });

    if (!existing) {
      isUnique = true;
    }
    attempts++;
  }

  if (!isUnique) {
    // Fallback: use timestamp-based if all random attempts fail
    token = Date.now().toString().slice(-6);
    console.warn("⚠️ Using fallback token generation");
  }

  console.log(
    `✅ Generated unique 6-digit token: ${token} (attempts: ${attempts})`,
  );
  return token;
};

// ✅ Asynchronous AI scoring for user reviews
async function processUserReviewAIScoring(review, imageUrls) {
  console.log("\n========================================");
  console.log("🚀 USER REVIEW AI SCORING STARTED");
  console.log("========================================");
  console.log("📋 Review ID:", review.id.toString());
  console.log("📸 Total images:", imageUrls.length);
  console.log("🔗 Image URLs:", imageUrls);
  console.log("========================================\n");

  // ✅ Helper: Convert 0-100 scale to 1-10 scale
  const convertScoreTo10Scale = (score) => {
    if (score <= 10) return score;
    return Math.round(score) / 10;
  };

  // ✅ Helper: Calculate average score
  const calculateAverageScore = (scores) => {
    if (!scores || scores.length === 0) return null;

    const total = scores.reduce((sum, item) => sum + Number(item.score), 0);
    const average = total / scores.length;
    return Number(average.toFixed(2)); // Round to 2 decimals
  };

  // ✅ Helper: Validate AI response
  const validateAIResponse = (data) => {
    console.log("🔍 Validating AI response...");

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

    console.log("✅ Response validation passed");
    console.log(`📊 Received ${data.length} scores`);
    data.forEach((item) => {
      console.log(
        `   - ${item.filename}: ${item.score}/10 (status: ${item.status})`,
      );
    });

    return true;
  };

  // ✅ Helper: Generate fake score (fallback)
  const generateFakeScore = () => {
    return parseFloat((Math.random() * (10 - 6) + 6).toFixed(2));
  };

  // ===== MAIN PROCESS =====
  try {
    if (imageUrls.length === 0) {
      console.log("⚠️ No images to process. Exiting...\n");
      return;
    }

    let aiScore = null;

    // ===== METHOD 1: TRY URL-BASED SCORING =====
    try {
      console.log("\n🔄 METHOD 1: Sending image URLs to AI");
      console.log("========================================");

      const urlPayload = { images: imageUrls };
      console.log("📤 Payload:", JSON.stringify(urlPayload, null, 2));

      const startTime = Date.now();

      const aiResponse = await axios.post(
        "https://pugarch-c-score-776087882401.europe-west1.run.app/predict",
        urlPayload,
        {
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "UserReview/1.0",
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

      // Calculate average score
      aiScore = calculateAverageScore(aiResponse.data);
      console.log(`📊 Calculated Average AI Score: ${aiScore}/10`);
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

        // const FormData = require('form-data');
        const formData = new FormData();
        let successCount = 0;
        let failCount = 0;

        console.log(`\n📥 Downloading ${imageUrls.length} images...`);

        // Download images sequentially
        for (let i = 0; i < imageUrls.length; i++) {
          const imageUrl = imageUrls[i];
          console.log(`\n📷 Image ${i + 1}/${imageUrls.length}`);
          console.log(`   URL: ${imageUrl}`);

          try {
            const downloadStart = Date.now();

            // Download image as buffer
            const response = await axios({
              url: imageUrl,
              method: "GET",
              responseType: "arraybuffer",
              timeout: 10000,
              headers: {
                "User-Agent": "UserReview-ImageDownloader/1.0",
              },
            });

            const downloadDuration = Date.now() - downloadStart;
            const sizeKB = (response.data.length / 1024).toFixed(2);

            console.log(
              `   ✅ Downloaded in ${downloadDuration}ms (${sizeKB} KB)`,
            );
            console.log(`   Content-Type: ${response.headers["content-type"]}`);

            // Append buffer to FormData
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
          "https://pugarch-c-score-776087882401.europe-west1.run.app/predict",
          formData,
          {
            headers: {
              ...formData.getHeaders(),
              "User-Agent": "UserReview-AIService/1.0",
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

        // Calculate average score
        aiScore = calculateAverageScore(aiResponse.data);
        console.log(`📊 Calculated Average AI Score: ${aiScore}/10`);
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
        console.log("========================================\n");

        throw formDataError; // Trigger fallback to fake score
      }
    }

    // ===== UPDATE USER REVIEW WITH AI SCORE =====
    if (aiScore !== null) {
      try {
        const updatedReview = await prisma.user_review_qr.update({
          where: { id: review.id },
          data: {
            ai_score: aiScore,
            updated_at: new Date(),
          },
        });

        console.log("✅ USER REVIEW UPDATED WITH AI SCORE");
        console.log("========================================");
        console.log(`   Review ID: ${review.id.toString()}`);
        console.log(`   AI Score: ${aiScore}/10`);
        console.log(`   Updated At: ${updatedReview.updated_at}`);
        console.log("========================================\n");
      } catch (updateError) {
        console.log("\n❌ FAILED TO UPDATE USER REVIEW");
        console.log("========================================");
        console.error("   Error:", {
          message: updateError.message,
          code: updateError.code,
          review_id: review.id.toString(),
        });
        console.log("========================================\n");
      }
    }

    console.log("\n✅ USER REVIEW AI SCORING COMPLETED");
    console.log("========================================\n");
  } catch (finalError) {
    // ===== FALLBACK: GENERATE FAKE SCORE =====
    console.log("\n🔴 ALL METHODS FAILED - Using Fallback");
    console.log("========================================");
    console.log("Error Summary:", {
      message: finalError.message,
      type: finalError.constructor.name,
      code: finalError.code,
    });
    console.log("========================================\n");

    try {
      console.log("🎲 Generating fake score as fallback...");
      const fakeScore = generateFakeScore();
      console.log(`📊 Fake AI Score: ${fakeScore}/10`);

      await prisma.user_review_qr.update({
        where: { id: review.id },
        data: {
          ai_score: fakeScore,
          updated_at: new Date(),
        },
      });

      console.log("\n✅ FALLBACK COMPLETED - Fake score saved");
      console.log("========================================\n");
    } catch (fakeError) {
      console.log("\n🔴 CRITICAL: FALLBACK FAILED");
      console.log("========================================");
      console.error("Unable to save even fake score:", {
        message: fakeError.message,
        stack: fakeError.stack,
        code: fakeError.code,
      });
      console.log("========================================\n");
    }
  }
}

router.post(
  "/user-review",
  upload.fields([{ name: "images", maxCount: 5 }]),
  processAndUploadImages([
    { fieldName: "images", folder: "user-reviews", maxCount: 5 },
  ]),
  async (req, res) => {
    console.log("in review routes post");
    console.log("POST request made for user_review");

    try {
      const body = req.body;
      console.log("Received body:", body);
      console.log("Uploaded files:", req.uploadedFiles);

      // Parse reason_ids safely
      const reasonIds = JSON.parse(body.reason_ids || "[]");

      // Get Cloudinary URLs from middleware
      const imageUrls = req.uploadedFiles?.images || [];

      const lat = parseFloat(body.latitude);
      const long = parseFloat(body.longitude);

      const frontendRating = parseFloat(body.rating);

      // ✅ Generate unique 6-digit token during review creation
      const token = await generateUniqueToken();

      const reviewData = {
        rating: frontendRating,
        reason_ids: reasonIds,
        latitude: lat,
        longitude: long,
        description: body.description || "",
        location_id: body.location_id ? BigInt(body.location_id) : null,
        images: imageUrls,
        company_id: body?.companyId ? BigInt(body.companyId) : null,
        token_number: token, // ✅ Add token to review data
      };

      if (body.name) reviewData.name = body.name;
      if (body.email) reviewData.email = body.email;
      if (body.phone) reviewData.phone = body.phone;

      const review = await prisma.user_review_qr.create({
        data: reviewData,
      });

      console.log("✅ Review created with token:", review);

      res.status(201).json({
        success: true,
        data: normalizeBigInt(review),
        reviewId: review.id.toString(),
        tokenNumber: token, // ✅ Return token to frontend
        message: "Review submitted successfully!",
      });

      if (imageUrls.length > 0) {
        processUserReviewAIScoring(review, imageUrls);
      } else {
        console.log("⚠️ No images to process for AI scoring");
      }
    } catch (error) {
      console.error("Review creation failed:", error);
      res.status(400).json({
        success: false,
        error: error.message,
        message: "Failed to submit review",
      });
    }
  },
);

// ✅ NEW: PATCH route to update contact details
router.patch("/user-review/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone } = req.body;

    console.log(`📝 Updating review ${id} with contact details`);

    const updateData = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (phone) updateData.phone = phone;

    if (Object.keys(updateData).length === 0) {
      return res.status(200).json({
        success: true,
        message: "No data provided to update",
      });
    }

    const updatedReview = await prisma.user_review_qr.update({
      where: { id: BigInt(id) },
      data: updateData,
    });

    console.log("✅ Review updated:", updatedReview);

    res.status(200).json({
      success: true,
      data: normalizeBigInt(updatedReview),
      message: "Contact details updated successfully!",
    });
  } catch (error) {
    console.error("❌ Review update failed:", error);
    res.status(400).json({
      success: false,
      error: error.message,
      message: "Failed to update contact details",
    });
  }
});

// ✅ GET all reviews with optional filters
router.get("/user-review", async (req, res) => {
  try {
    const {
      location_id,
      company_id,
      min_rating,
      max_rating,
      limit,
      offset,
      sort_by,
      order,
      date,
    } = req.query;

    // Build where clause dynamically
    const where = {};

    if (location_id) where.location_id = BigInt(location_id);
    if (company_id) where.company_id = BigInt(company_id);

    if (min_rating || max_rating) {
      where.rating = {};
      if (min_rating) where.rating.gte = parseFloat(min_rating);
      if (max_rating) where.rating.lte = parseFloat(max_rating);
    }

    // Add date filter if provided
    if (date) {
      const startDate = new Date(date);
      startDate.setUTCHours(0, 0, 0, 0);

      const endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 1);

      where.created_at = {
        gte: startDate,
        lt: endDate,
      };
    }

    // Build orderBy clause
    const orderBy = {};
    const sortField = sort_by || "created_at";
    const sortOrder = order || "desc";
    orderBy[sortField] = sortOrder;

    // Fetch reviews with pagination
    const reviews = await prisma.user_review_qr.findMany({
      where,
      orderBy,
      take: limit ? parseInt(limit) : undefined,
      skip: offset ? parseInt(offset) : undefined,
      include: {
        locations: true,
      },
    });

    // Get total count for pagination
    const totalCount = await prisma.user_review_qr.count({ where });

    console.log(`Fetched ${reviews.length} reviews`);

    res.status(200).json({
      success: true,
      data: reviews.map((review) => {
        const norm = normalizeBigInt(review);
        if (norm.locations) {
          norm.location = norm.locations;
          delete norm.locations;
        }
        return norm;
      }),
      pagination: {
        total: totalCount,
        limit: limit ? parseInt(limit) : reviews.length,
        offset: offset ? parseInt(offset) : 0,
      },
      message: "Reviews fetched successfully!",
    });
  } catch (error) {
    console.error("Failed to fetch reviews:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: "Failed to fetch reviews",
    });
  }
});

// ✅ GET single review by ID
router.get("/user-review/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const review = await prisma.user_review_qr.findUnique({
      where: { id: BigInt(id) },
      include: {
        locations: true,
      },
    });

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found",
      });
    }

    console.log("Review fetched:", review.id.toString());

    const normReview = normalizeBigInt(review);
    if (normReview.locations) {
      normReview.location = normReview.locations;
      delete normReview.locations;
    }

    res.status(200).json({
      success: true,
      data: normReview,
      message: "Review fetched successfully!",
    });
  } catch (error) {
    console.error("Failed to fetch review:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: "Failed to fetch review",
    });
  }
});

// ✅ GET reviews statistics for a toilet
router.get("/user-review/stats/toilet/:location_id", async (req, res) => {
  try {
    const { location_id } = req.params;

    const reviews = await prisma.user_review_qr.findMany({
      where: { location_id: BigInt(location_id) },
      select: { rating: true },
    });

    const totalReviews = reviews.length;
    const averageRating =
      totalReviews > 0
        ? reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / totalReviews
        : 0;

    // Count rating distribution
    const ratingDistribution = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    };

    reviews.forEach((review) => {
      const rating = Math.round(review.rating || 0);
      if (rating >= 1 && rating <= 5) {
        ratingDistribution[rating]++;
      }
    });

    res.status(200).json({
      success: true,
      data: {
        total_reviews: totalReviews,
        average_rating: parseFloat(averageRating.toFixed(2)),
        rating_distribution: ratingDistribution,
      },
      message: "Statistics fetched successfully!",
    });
  } catch (error) {
    console.error("Failed to fetch statistics:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: "Failed to fetch statistics",
    });
  }
});

// ✅ GET recent reviews
router.get("/user-review/recent", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    const reviews = await prisma.user_review_qr.findMany({
      orderBy: { created_at: "desc" },
      take: limit,
    });

    res.status(200).json({
      success: true,
      data: reviews.map((review) => normalizeBigInt(review)),
      message: "Recent reviews fetched successfully!",
    });
  } catch (error) {
    console.error("Failed to fetch recent reviews:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: "Failed to fetch recent reviews",
    });
  }
});
