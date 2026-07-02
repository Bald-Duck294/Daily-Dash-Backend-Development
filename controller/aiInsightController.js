import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();


export async function getCompanies(req, res) {
  try {
    // Currently hardcoded to simulation companies, ready for RBAC later
    const companies = await prisma.companies.findMany({
      where: {
        id: { in: [27n, 28n] },
      },
      select: {
        id: true,
        name: true,
      },
    });

    const safeSerialize = (obj) =>
      typeof obj === "bigint" ? obj.toString() : obj;

    res.json(companies.map((c) => ({ id: safeSerialize(c.id), name: c.name })));
  } catch (err) {
    console.error("Fetch Companies Error:", err);
    res.status(500).json({ error: "Failed to fetch companies" });
  }
}

// GET /ai-insights/locations
export async function getLocations(req, res) {
  const { company_id } = req.query;

  try {
    const whereClause = {
      // 1. Adopt safety checks from your existing architecture
      deleted_at: null,
      OR: [{ status: true }, { status: null }],
    };

    // 2. Safely handle "all" or "null" strings from the frontend
    const isValidCompanyId = company_id && company_id !== "all" && company_id !== "null";

    if (isValidCompanyId) {
      whereClause.company_id = BigInt(company_id);
    } else {
      // Default simulation fallback
      whereClause.company_id = { in: [27n, 28n] }; 
    }

    // ---------------------------------------------------------
    // THE TOILET FILTER (Currently Disabled for Testing)
    // ---------------------------------------------------------
    // If you uncomment this block and Postman returns [], 
    // it confirms that Company 27 has no locations in the DB 
    // where the associated location_types.is_toilet is true.
    //
    // whereClause.location_types = {
    //   is_toilet: true,
    // };
    // ---------------------------------------------------------

    const locations = await prisma.locations.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        type_id: true, // Fetching this so you can see what type they actually are
        company_id: true,
        companies: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        name: "asc", // Adopting your alphabetical sort
      },
    });

    const formattedLocations = locations.map((loc) => ({
      id: loc.id.toString(),
      name: loc.name,
      type_id: loc.type_id ? loc.type_id.toString() : null,
      company_id: loc.company_id.toString(),
      company_name: loc.companies?.name || "Unknown",
    }));

    res.json(formattedLocations);
  } catch (err) {
    console.error("Fetch Locations Error:", err);
    res.status(500).json({ error: "Failed to fetch locations" });
  }
}

// GET /ai-insights/cleaners
export async function getCleaners(req, res) {
  // ✅ FIX: Ensure this says req.query, not req.body
  const { company_id } = req.query;

  // 🐛 DEBUG: Check your terminal when you hit Send in Postman
  console.log("---- Debug getCleaners ----");
  console.log("Received company_id:", company_id); 

  try {
    const whereClause = {
      deleted_at: null,
      role: {
        name: {
          equals: "cleaner",
          mode: "insensitive",
        },
      },
    };

    const isValidCompanyId = company_id && company_id !== "all" && company_id !== "null";

    if (isValidCompanyId) {
      whereClause.company_id = BigInt(company_id);
    } else {
      whereClause.company_id = { in: [27n, 28n] };
    }

    const cleaners = await prisma.users.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        company_id: true,
        companies: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        name: "asc", 
      },
    });

    const formattedCleaners = cleaners.map((cleaner) => ({
      id: cleaner.id.toString(),
      name: cleaner.name,
      company_id: cleaner.company_id ? cleaner.company_id.toString() : null,
      company_name: cleaner.companies?.name || "Unknown",
    }));

    res.json(formattedCleaners);
  } catch (err) {
    console.error("Fetch Cleaners Error:", err);
    res.status(500).json({ error: "Failed to fetch cleaners" });
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
