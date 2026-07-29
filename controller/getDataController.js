import prisma from "../config/prismaClient.mjs";
import db from "../db.js";


console.log('from getLocation controller')
export async function getUser(req, res) {

  // console.log('in get user');
  try {
    const companyId = req.query;

    // console.log(companyId, "company_id");
    const users = await prisma.users.findMany({
      where: {
        company_id: companyId
      }
    });
    // console.log(users, "users");

    // Convert BigInt to string
    const usersWithStringIds = users.map((user) => ({
      ...user,
      id: user.id.toString(),
      company_id: user.company_id?.toString() || null,
    }));

    res.json(usersWithStringIds);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching users");
  }
}

// export const getLocation = async (req, res) => {
//   try {
//     const locations = await prisma.locations.findMany({
//       where: {
//         type_id: BigInt(4), // Make sure this matches your DB
//       },

//       include:{
//         review:{
//           select:{rating:true}
//         }
//       }
//     });

//     console.log(locations.slice(0, 10), "users");

//     // Convert BigInt fields to strings for frontend safety
//     const usersWithStringIds = locations.map((locations) => ({
//       ...locations,
//       id: locations.id.toString(),
//       parent_id: locations.parent_id?.toString() || null,
//       company_id: locations.company_id?.toString() || null,
//       type_id: locations.type_id?.toString() || null,
//     }));

//     res.json(usersWithStringIds);
//   } catch (err) {
//     console.error(err);
//     res.status(500).send("Error fetching users");
//   }
// };

// export const getAllToilets = async (req, res) => {
//   console.log("get all toilets");
//   try {
//     const allLocations = await prisma.locations.findMany({
//       include: {
//         hygiene_scores: {
//           orderBy: { inspected_at: "desc" },
//           take: 1,
//           select: { score: true },
//         },
//       },
//     });

//     const allReviews = await prisma.review.findMany({
//       where: {
//         site_id: {
//           in: allLocations.map((loc) => Number(loc.id)),
//         },
//       },
//       select: {
//         site_id: true,
//         rating: true,
//       },
//     });

//     // Group user ratings by site
//     const reviewsBySite = {};
//     allReviews.forEach((r) => {
//       if (!reviewsBySite[r.site_id]) reviewsBySite[r.site_id] = [];
//       if (r.rating !== null) reviewsBySite[r.site_id].push(r.rating);
//     });

//     const result = allLocations.map((loc) => {
//       const userRatings = reviewsBySite[Number(loc.id)] || [];

//       // Hygiene score → rating out of 10
//       const hygieneScore = loc.hygiene_scores[0]?.score ?? null;
//       const hygieneRating =
//         hygieneScore !== null ? Number(hygieneScore) / 10 : null;

//       const allRatings = [
//         ...userRatings,
//         ...(hygieneRating !== null ? [hygieneRating] : []),
//       ];

//       const ratingCount = allRatings.length;
//       const averageRating =
//         ratingCount > 0
//           ? allRatings.reduce((sum, r) => sum + r, 0) / ratingCount
//           : null;

//       return {
//         ...loc,
//         id: loc.id.toString(),
//         parent_id: loc.parent_id?.toString() || null,
//         company_id: loc.company_id?.toString() || null,
//         type_id: loc.type_id?.toString() || null,
//         averageRating,
//         ratingCount,
//       };
//     });

//     console.log(result.slice*(0,6), "result");
//     res.json(result);
//   } catch (err) {
//     console.error(err);
//     res.status(500).send("Error fetching toilet locations");
//   }
// };


// export const getAllToilets = async (req, res) => {
//   console.log("get all toilets");
//   try {
//     const { company_id, type_id } = req.query; // get query params
//     console.log(company_id, type_id, "all params comp and type id");
//     // Build where clause dynamically
//     const whereClause = {};
//     if (company_id && !company_id == undefined) {
//       console.log('in cmp id');
//       whereClause.company_id = BigInt(company_id);
//     }
//     if (type_id) whereClause.type_id = BigInt(type_id);

//     const allLocations = await prisma.locations.findMany({
//       where: Object.keys(whereClause).length ? whereClause : undefined, // apply only if filters exist
//       include: {
//         hygiene_scores: {
//           // orderBy: { inspected_at: "desc" },
//           take: 1,
//           select: { score: true },
//         },
//       },
//     });
//     console.log(allLocations?.slice(0, 6), 'alll loc');

//     const allReviews = await prisma.review.findMany({
//       where: {
//         site_id: {
//           in: allLocations.map((loc) => Number(loc.id)),
//         },
//       },
//       select: {
//         site_id: true,
//         rating: true,
//       },
//     });

//     // Group user ratings by site
//     const reviewsBySite = {};
//     allReviews.forEach((r) => {
//       if (!reviewsBySite[r.site_id]) reviewsBySite[r.site_id] = [];
//       if (r.rating !== null) reviewsBySite[r.site_id].push(r.rating);
//     });

//     const result = allLocations.map((loc) => {
//       const userRatings = reviewsBySite[Number(loc.id)] || [];

//       // Hygiene score → rating out of 10
//       const hygieneScore = loc.hygiene_scores[0]?.score ?? null;
//       const hygieneRating =
//         hygieneScore !== null ? Number(hygieneScore) / 10 : null;

//       const allRatings = [
//         ...userRatings,
//         ...(hygieneRating !== null ? [hygieneRating] : []),
//       ];

//       const ratingCount = allRatings.length;
//       const averageRating =
//         ratingCount > 0
//           ? allRatings.reduce((sum, r) => sum + r, 0) / ratingCount
//           : null;

//       return {
//         ...loc,
//         id: loc.id.toString(),
//         parent_id: loc.parent_id?.toString() || null,
//         company_id: loc.company_id?.toString() || null,
//         type_id: loc.type_id?.toString() || null,
//         averageRating,
//         ratingCount,
//       };
//     });

//     console.log(result.slice(0, 6), "result");
//     res.json(result);
//   } catch (err) {
//     console.error(err);
//     res.status(500).send("Error fetching toilet locations");
//   }
// };



export const getAllToilets = async (req, res) => {
  // console.log("get all toilets");
  try {
    const { company_id, type_id } = req.query; // get query params
    // console.log(company_id, type_id, "all types of ids");
    // Build where clause dynamically
    const whereClause = {};
    if (company_id) {
      whereClause.company_id = BigInt(company_id);
    }
    if (type_id) {
      whereClause.type_id = BigInt(type_id);
    }

    const allLocations = await prisma.locations.findMany({
      where: Object.keys(whereClause).length ? whereClause : undefined,
      include: {
        // Fetch ALL hygiene scores for each location
        hygiene_scores: {
          select: { score: true },
        },
      },
    });

    const result = allLocations.map((loc) => {
      // --- New Rating Calculation Logic ---
      const hygieneScores = loc.hygiene_scores.map(hs => Number(hs.score));
      const ratingCount = hygieneScores.length;

      let averageRating = null;
      if (ratingCount > 0) {
        const sumOfScores = hygieneScores.reduce((sum, score) => sum + score, 0);
        // Calculate the direct average of the scores.
        averageRating = sumOfScores / ratingCount;
      }

      return {
        ...loc,
        id: loc.id.toString(),
        parent_id: loc.parent_id?.toString() || null,
        company_id: loc.company_id?.toString() || null,
        type_id: loc.type_id?.toString() || null,
        averageRating: averageRating ? parseFloat(averageRating.toFixed(2)) : null, // Format to 2 decimal places
        ratingCount,
        hygiene_scores: undefined, // Remove the original hygiene_scores array from the final output
      };
    });

    // console.log(result.slice(0, 6), "result");
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching toilet locations");
  }
};



export const getToiletById = async (req, res) => {
  try {
    // const locationId = BigInt(req.params.id);
    let locId = req.params.id;

    const location = await prisma.locations.findUnique({
      where: { id: Number(locId) },
      include: {
        hygiene_scores: {
          orderBy: { inspected_at: "desc" },
          take: 1,
          select: { score: true },
        },
      },
    });

    if (!location) {
      return res.status(404).json({ message: "Toilet not found" });
    }

    const reviews = await prisma.review.findMany({
      where: { site_id: Number(locId) },
    });

    const intReviews = reviews.map((item) => ({
      ...item,
      id: item.id.toString(),
      user_id: item.user_id.toString(),
    }));
    // console.log(reviews, "reviews");
    const userRatings = reviews.map((r) => r.rating).filter(Boolean);
    const hygieneScore = location.hygiene_scores[0]?.score ?? null;

    const hygieneRatingMapped =
      hygieneScore !== null
        ? hygieneScore >= 100
          ? 5
          : hygieneScore >= 80
            ? 4
            : hygieneScore >= 60
              ? 3
              : hygieneScore >= 40
                ? 2
                : 1
        : null;

    const allRatings = [
      ...userRatings,
      ...(hygieneRatingMapped !== null ? [hygieneRatingMapped] : []),
    ];
    const ratingCount = allRatings.length;
    const averageRating =
      ratingCount > 0
        ? allRatings.reduce((sum, r) => sum + r, 0) / ratingCount
        : null;

    const result = {
      ...location,
      id: location.id.toString(),
      parent_id: location.parent_id?.toString() || null,
      company_id: location.company_id?.toString() || null,
      type_id: location.type_id?.toString() || null,
      averageRating,
      ratingCount,
      ReviewData: intReviews,
    };

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching toilet by ID");
  }
};

export const getZonesWithToilets = async (req, res) => {
  console.log("new zones with toilets from location_types & locations");
  try {
    const { company_id } = req.query;
    const companyId = company_id || req.user?.company_id;

    const whereClause = {};
    if (
      companyId &&
      companyId !== "all" &&
      companyId !== "null" &&
      companyId !== "undefined"
    ) {
      whereClause.company_id = BigInt(companyId);
    }

    // 1. Fetch hierarchy nodes (zones) from location_types
    const zones = await prisma.location_types.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        ui_type: true,
      },
      orderBy: { name: "asc" },
    });

    if (!zones.length) return res.json([]);

    const zoneIds = zones.map((z) => z.id);

    // 2. Fetch physical washrooms from locations whose type_id points to these zone/hierarchy IDs
    const toiletsWhere = {
      type_id: { in: zoneIds },
    };
    if (whereClause.company_id) {
      toiletsWhere.company_id = whereClause.company_id;
    }

    const toilets = await prisma.locations.findMany({
      where: toiletsWhere,
      select: {
        id: true,
        name: true,
        type_id: true,
        latitude: true,
        longitude: true,
        hygiene_scores: {
          orderBy: { inspected_at: "desc" },
          take: 1,
          select: { image_url: true },
        },
      },
    });

    // Group toilets by their hierarchy node (type_id)
    const toiletsByZone = {};
    toilets.forEach((toilet) => {
      const zoneId = toilet.type_id ? toilet.type_id.toString() : "";
      if (!toiletsByZone[zoneId]) toiletsByZone[zoneId] = [];

      toiletsByZone[zoneId].push({
        id: toilet.id.toString(),
        name: toilet.name,
        image_url: toilet.hygiene_scores[0]?.image_url || null,
        latitude: toilet.latitude,
        longitude: toilet.longitude,
      });
    });

    // Attach washrooms (toilets) to hierarchy nodes (zones)
    const result = zones.map((zone) => ({
      id: zone.id.toString(),
      name: zone.name,
      type_id: zone.id.toString(),
      ui_type: zone.ui_type || null,
      children: toiletsByZone[zone.id.toString()] || [],
    }));

    return res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching zones and toilets" });
  }
};



export const createLocation = async (req, res) => {

  console.log("in create location -----------------------------////------------")
  try {
    const { name, parent_id, type_id, latitude, longitude, options } = req.body;

    const { companyId } = req.query;
    console.log(companyId, "company id create location")
    console.log(
      name,
      parent_id,
      type_id,
      latitude,
      longitude,
      options,
      "all data"
    );
    // Basic validation
    if (!name || !type_id) {
      return res.status(400).json({ error: "Name and typeId are required." });
    }

    // Insert into DB
    const newLocation = await prisma.locations.create({
      data: {
        name,
        parent_id: parent_id ? BigInt(parent_id) : null,
        company_id: (companyId) ? BigInt(companyId) : null,
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        metadata: {},
        // Legacy, you mentioned backend should handle it
        type_id: BigInt(type_id),
        options: options ?? {},
      },
    });

    res.status(201).json({
      success: true,
      message: "Location added successfully.",
      data: {
        ...newLocation,
        id: newLocation.id.toString(), // convert BigInt to string
        parent_id: newLocation.parent_id?.toString() || null,
        type_id: newLocation.type_id?.toString() || null,
        company_id: newLocation.company_id?.toString() || null,
      },
    });
  } catch (err) {
    console.error("Error creating location:", err);
    res.status(500).json({ error: "Failed to create location." });
  }
};

////////////////////// new get locations with zone apis /////////////////////

// Group by zones (original functionality with company option)
const getLocationsByZone = async (req, res, showCompanyZones) => {
  const ZONE_TYPE_IDS = [BigInt(5), BigInt(7), BigInt(2), BigInt(3), BigInt(6)];
  const TOILET_TYPE_ID = BigInt(4);

  const zones = await prisma.locations.findMany({
    where: {
      type_id: { in: ZONE_TYPE_IDS },
    },
    select: {
      id: true,
      name: true,
      type_id: true,
      company_id: true,
      companies: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!zones.length) return res.json([]);

  const zoneIds = zones.map((z) => z.id);

  const toilets = await prisma.locations.findMany({
    where: {
      type_id: TOILET_TYPE_ID,
      parent_id: { in: zoneIds },
    },
    select: {
      id: true,
      name: true,
      parent_id: true,
      company_id: true,
      latitude: true,
      longitude: true,
      hygiene_scores: {
        orderBy: { inspected_at: "desc" },
        take: 1,
        select: { image_url: true },
      },
    },
  });

  if (showCompanyZones === "true") {
    // Group by company, then by zone
    const companiesMap = {};

    zones.forEach((zone) => {
      const companyId = zone.company_id?.toString() || "no-company";
      const companyName = zone.companies?.name || "No Company";

      if (!companiesMap[companyId]) {
        companiesMap[companyId] = {
          id: companyId,
          name: companyName,
          zones: [],
          totalToilets: 0,
        };
      }
    });

    // Group toilets by zone
    const toiletsByZone = {};
    toilets.forEach((toilet) => {
      const zoneId = toilet.parent_id.toString();
      if (!toiletsByZone[zoneId]) toiletsByZone[zoneId] = [];

      toiletsByZone[zoneId].push({
        id: toilet.id.toString(),
        name: toilet.name,
        image_url: toilet.hygiene_scores[0]?.image_url || null,
        latitude: toilet.latitude,
        longitude: toilet.longitude,
      });
    });

    // Attach toilets to zones and zones to companies
    zones.forEach((zone) => {
      const companyId = zone.company_id?.toString() || "no-company";
      const zoneToilets = toiletsByZone[zone.id.toString()] || [];

      companiesMap[companyId].zones.push({
        id: zone.id.toString(),
        name: zone.name,
        type_id: zone.type_id.toString(),
        children: zoneToilets,
      });

      companiesMap[companyId].totalToilets += zoneToilets.length;
    });

    return res.json(Object.values(companiesMap));
  } else {
    // Original zone grouping without company grouping
    const toiletsByZone = {};
    toilets.forEach((toilet) => {
      const zoneId = toilet.parent_id.toString();
      if (!toiletsByZone[zoneId]) toiletsByZone[zoneId] = [];

      toiletsByZone[zoneId].push({
        id: toilet.id.toString(),
        name: toilet.name,
        image_url: toilet.hygiene_scores[0]?.image_url || null,
        latitude: toilet.latitude,
        longitude: toilet.longitude,
      });
    });

    const result = zones.map((zone) => ({
      id: zone.id.toString(),
      name: zone.name,
      type_id: zone.type_id.toString(),
      company_name: zone.companies?.name || "No Company",
      children: toiletsByZone[zone.id.toString()] || [],
    }));

    return res.json(result);
  }
};

// Group by company
const getLocationsByCompany = async (req, res) => {
  // const TOILET_TYPE_ID = BigInt(4);

  // Get all toilets with their company information
  const toilets = await prisma.locations.findMany({
    where: {
      // type_id: TOILET_TYPE_ID,
      latitude: { not: null },
      longitude: { not: null },
    },
    select: {
      id: true,
      name: true,
      company_id: true,
      latitude: true,
      longitude: true,
      companies: {
        select: {
          id: true,
          name: true,
        },
      },
      hygiene_scores: {
        orderBy: { inspected_at: "desc" },
        take: 1,
        select: { image_url: true },
      },
    },
  });

  // Group toilets by company
  const companiesMap = {};
  toilets.forEach((toilet) => {
    const companyId = toilet.company_id?.toString() || "no-company";
    const companyName = toilet.companies?.name || "No Company";

    if (!companiesMap[companyId]) {
      companiesMap[companyId] = {
        id: companyId,
        name: companyName,
        type_id: "company",
        children: [],
      };
    }

    companiesMap[companyId].children.push({
      id: toilet.id.toString(),
      name: toilet.name,
      image_url: toilet.hygiene_scores[0]?.image_url || null,
      latitude: toilet.latitude,
      longitude: toilet.longitude,
    });
  });

  return res.json(Object.values(companiesMap));
};

// Group by hierarchical type structure
const getLocationsByType = async (req, res) => {
  const TOILET_TYPE_ID = BigInt(4);

  // Start from Nagpur (assuming it has parent_id: null and is the root)
  const rootLocation = await prisma.locations.findFirst({
    where: {
      name: { contains: "Nagpur", mode: "insensitive" },
      parent_id: null,
    },
    select: {
      id: true,
      name: true,
      type_id: true,
    },
  });

  if (!rootLocation) {
    return res.status(404).json({ message: "Nagpur root location not found" });
  }

  // Build hierarchical structure
  const buildHierarchy = async (parentId, level = 0) => {
    // Get direct children of this parent
    const children = await prisma.locations.findMany({
      where: {
        parent_id: parentId,
      },
      select: {
        id: true,
        name: true,
        type_id: true,
        latitude: true,
        longitude: true,
        hygiene_scores: {
          orderBy: { inspected_at: "desc" },
          take: 1,
          select: { image_url: true },
        },
      },
    });

    const result = [];

    for (const child of children) {
      if (child.type_id === TOILET_TYPE_ID) {
        // This is a toilet - leaf node
        result.push({
          id: child.id.toString(),
          name: child.name,
          type_id: child.type_id.toString(),
          latitude: child.latitude,
          longitude: child.longitude,
          image_url: child.hygiene_scores[0]?.image_url || null,
          isToilet: true,
        });
      } else {
        // This is a zone/area - recursive call to get its children
        const grandChildren = await buildHierarchy(child.id, level + 1);
        result.push({
          id: child.id.toString(),
          name: child.name,
          type_id: child.type_id.toString(),
          children: grandChildren,
          isToilet: false,
        });
      }
    }

    return result;
  };

  const hierarchy = await buildHierarchy(rootLocation.id);

  return res.json([
    {
      id: rootLocation.id.toString(),
      name: rootLocation.name,
      type_id: rootLocation.type_id.toString(),
      children: hierarchy,
      isToilet: false,
    },
  ]);
};

/////////////////////////////// Get Near by Location \\\\\\\\\\\\\\\\\\\\\\\\\

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
  `, [parseFloat(lng), parseFloat(lat), parseInt(radius)]);

    // const updatedResults = result.map((item) => ({
    //   ...item,
    //   id:item.id.toString()
    // }));
    // console.log(result , "results");
    // res.json(updatedResults);
    console.log(result, "data");
    res.json(result)
  } catch (error) {
    console.error("Error fetching nearby locations:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};





// app.get('/api/nearby', async (req, res) => {
//   const { lat, lng, radius } = req.query;

//   if (!lat || !lng || !radius) {
//     return res.status(400).json({ error: 'Missing parameters' });
//   }

//   const result = await db.query(`
//     SELECT
//       id,
//       name,
//       ST_AsText(geom) AS geo_location,
//       ST_Distance(
//         geom::geography,
//         ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
//       ) AS distance
//     FROM locations
//     WHERE ST_DWithin(
//       geom::geography,
//       ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
//       $3
//     )
//     ORDER BY distance ASC
//     LIMIT 50
//   `, [parseFloat(lng), parseFloat(lat), parseInt(radius)]);

//   res.json(result.rows);
// });
