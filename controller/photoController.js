import prisma from "../config/prismaClient.mjs";
import db from "../db.js";
// import RBACFilterService from "../services/rbacFilterService.js";
import RBACFilterService from "../utils/rbacFilterService.js";


export const getCleanerReviewPhotos = async (req, res) => {
  try {
    const { 
      company_id, 
      location_id, 
      image_type = "all", 
      start_date, 
      end_date,
      search,
      page = 1, 
      limit = 20 
    } = req.query;

    const pageNumber = parseInt(page, 10);
    const pageSize = parseInt(limit, 10);
    const skip = (pageNumber - 1) * pageSize;

    const whereClause = {};

    // 1. BULLETPROOF COMPANY FILTER
    if (company_id && company_id !== "all" && company_id !== "null") {
      // ⚠️ IMPORTANT: If your filter is failing, check schema.prisma!
      // If it's named 'facility_company_id' in your DB, change the line below to:
      // whereClause.facility_company_id = BigInt(company_id);
      whereClause.company_id = BigInt(company_id);
    }

    // 2. BULLETPROOF LOCATION FILTER
    if (location_id && location_id !== "all" && location_id !== "null") {
      // ⚠️ IMPORTANT: If your filter is failing, check schema.prisma!
      // If it's named 'locations_id' or 'facility_location_id', change the line below:
      whereClause.location_id = BigInt(location_id); 
    }

    // 3. DATE FILTER
    if (start_date && end_date) {
      whereClause.created_at = {
        gte: new Date(start_date),
        lte: new Date(end_date),
      };
    }

    // 4. SEARCH FILTER
    if (search) {
      whereClause.OR = [
        { company: { name: { contains: search, mode: "insensitive" } } },
        { location: { name: { contains: search, mode: "insensitive" } } }
      ];
    }

    // Run both queries in parallel
    // Query A: Fetches the PAGINATED records for the UI Grid
    // Query B: Fetches ONLY the photo arrays for ALL MATCHING records to calculate the true photo count
    const [paginatedReviews, allMatchingReviews] = await Promise.all([
      prisma.cleaner_review.findMany({
        where: whereClause,
        include: {
          company: { select: { name: true } },
          location: { select: { name: true } },
          cleaner_user: { select: { name: true } }
        },
        orderBy: { created_at: 'desc' },
        skip: skip,
        take: pageSize
      }),
      prisma.cleaner_review.findMany({
        where: whereClause,
        select: { before_photo: true, after_photo: true }
      })
    ]);

    // 5. CALCULATE TRUE TOTAL PHOTO COUNT (From all matching records, not just this page)
    let totalPhotosAcrossAllPages = 0;
    allMatchingReviews.forEach(review => {
      if ((image_type === "all" || image_type === "before" || image_type === "pairs") && Array.isArray(review.before_photo)) {
        totalPhotosAcrossAllPages += review.before_photo.length;
      }
      if ((image_type === "all" || image_type === "after" || image_type === "pairs") && Array.isArray(review.after_photo)) {
        totalPhotosAcrossAllPages += review.after_photo.length;
      }
    });

    // 6. FORMAT THE PHOTOS FOR THE CURRENT PAGE
    const formattedPhotos = [];

    paginatedReviews.forEach((review) => {
      const baseInfo = {
        company_id: review.company_id ? review.company_id.toString() : null,
        company_name: review.company?.name || "Unknown Company",
        location_name: review.location?.name || "Unknown Location",
        uploaded_by: review.cleaner_user?.name || "Unknown Cleaner",
        uploaded_at: review.created_at,
        cleaning_record_id: review.id.toString(),
      };

      const extractFileName = (url, prefix, index) => {
        try {
          const urlObj = new URL(url);
          const pathParts = urlObj.pathname.split('/');
          const name = pathParts[pathParts.length - 1];
          return name ? name : `${prefix}_${review.id}_${index}.jpg`;
        } catch (e) {
          return `${prefix}_${review.id}_${index}.jpg`;
        }
      };

      // Process Before Photos
      if (review.before_photo && Array.isArray(review.before_photo)) {
        if (image_type === "all" || image_type === "before" || image_type === "pairs") {
          review.before_photo.forEach((url, index) => {
            formattedPhotos.push({
              ...baseInfo,
              id: `${review.id}-before-${index}`,
              image_type: "before",
              image_url: url,
              file_name: extractFileName(url, "before", index)
            });
          });
        }
      }

      // Process After Photos
      if (review.after_photo && Array.isArray(review.after_photo)) {
        if (image_type === "all" || image_type === "after" || image_type === "pairs") {
          review.after_photo.forEach((url, index) => {
            formattedPhotos.push({
              ...baseInfo,
              id: `${review.id}-after-${index}`,
              image_type: "after",
              image_url: url,
              file_name: extractFileName(url, "after", index)
            });
          });
        }
      }
    });

    const totalDatabaseRows = allMatchingReviews.length;

    return res.status(200).json({
      data: formattedPhotos,
      pagination: {
        current_page: pageNumber,
        page_size: pageSize,
        total_pages: Math.ceil(totalDatabaseRows / pageSize),
        // This is now outputting the EXACT number of photos matching the filters
        total_records: totalPhotosAcrossAllPages, 
        returned_photos_count: formattedPhotos.length
      }
    });

  } catch (err) {
    console.error("Error fetching cleaner photos:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};