// backend/controllers/attendance.controller.js
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// export async function getCleanerAttendance(req, res) {
//   const { 

export async function getCleanerAttendance(req, res) {
  const { 
    cleaner_user_id, 
    search,          
    company_id, 
    location_id,
    start_date, 
    end_date,
    page = 1, 
    limit = 15 
  } = req.query;

  try {
    const whereClause = {};

    if (company_id) {
      whereClause.company_id = BigInt(company_id);
    }
    
    // Note: We keep the filter for the review, but we will handle the "assigned cleaner"
    // visibility in the frontend using the 'allCleaners' prop
    if (location_id && location_id !== "all") {
      try {
        whereClause.location_id = BigInt(location_id);
      } catch (error) {
        return res.json({ data: [], pagination: { total_items: 0, total_pages: 0 } });
      }
    }

    if (cleaner_user_id && cleaner_user_id !== "all") {
      try {
        whereClause.cleaner_user_id = BigInt(cleaner_user_id);
      } catch (error) {
        return res.json({ 
          data: [], 
          pagination: { 
            total_items: 0, total_pages: 0,
            current_page: parseInt(page), items_per_page: parseInt(limit),
            has_next_page: false, has_prev_page: false
          } 
        });
      }
    }

    // Exclude Deleted Users
    whereClause.cleaner_user = {
      deleted_at: null 
    };

    if (search && search.trim() !== "") {
      whereClause.cleaner_user.name = {
        contains: search.trim(), 
        mode: 'insensitive' 
      };
    }

    const startDateObj = start_date ? new Date(start_date) : new Date();
    startDateObj.setUTCHours(0, 0, 0, 0);

    const endDateObj = end_date ? new Date(end_date) : new Date(startDateObj);
    endDateObj.setUTCHours(23, 59, 59, 999);

    whereClause.created_at = {
      gte: startDateObj,
      lte: endDateObj,
    };

    // 🟢 UPDATED: Include cleaner_assignments_as_cleaner in the selection
    const reviews = await prisma.cleaner_review.findMany({
      where: whereClause,
      select: {
        id: true,
        cleaner_user_id: true,
        created_at: true,
        status: true,
        cleaner_user: {
          select: { 
            id: true, 
            name: true,
            cleaner_assignments_as_cleaner: { // Fetch assignments to send locations
                select: {
                    locations: { select: { name: true } }
                }
            }
          }
        },
        location: {
          select: { name: true }
        }
      },
      orderBy: {
        created_at: 'asc' 
      }
    });

    const attendanceMap = {};

    reviews.forEach((review) => {
      const cleanerId = review.cleaner_user_id.toString();
      const localDate = new Date(review.created_at).toLocaleDateString('en-CA'); 
      const key = `${cleanerId}_${localDate}`;

      // 🟢 Extract all assigned locations for this user
      const assignedLocations = review.cleaner_user?.cleaner_assignments_as_cleaner
        ?.map(a => a.locations?.name)
        .filter(Boolean) || [];

      if (!attendanceMap[key]) {
        attendanceMap[key] = {
          id: `${cleanerId}_${localDate}`,
          cleaner_id: cleanerId,
          cleaner_name: review.cleaner_user?.name || "Unknown",
          date: localDate,
          check_in_time: review.created_at, 
          location: review.location?.name || "N/A",
          assigned_locations: assignedLocations, // Send array of assignments
          logs_count: 1, 
          status: "Present"
        };
      } else {
        attendanceMap[key].logs_count += 1;
      }
    });

    const allAttendanceRecords = Object.values(attendanceMap);
    allAttendanceRecords.sort((a, b) => new Date(b.check_in_time) - new Date(a.check_in_time));

    const take = parseInt(limit);
    const skip = (parseInt(page) - 1) * take;
    const paginatedRecords = allAttendanceRecords.slice(skip, skip + take);
    const totalItems = allAttendanceRecords.length;
    const totalPages = Math.ceil(totalItems / take) || 1;

    const safeSerialize = (obj) => {
      if (obj === null || obj === undefined) return obj;
      if (typeof obj === 'bigint') return obj.toString();
      if (obj instanceof Date) return obj.toISOString();
      if (Array.isArray(obj)) return obj.map(safeSerialize);
      if (typeof obj === 'object') {
        const serialized = {};
        for (const [key, value] of Object.entries(obj)) {
          serialized[key] = safeSerialize(value);
        }
        return serialized;
      }
      return obj;
    };

    res.json({
      data: safeSerialize(paginatedRecords),
      pagination: {
        total_items: totalItems,
        total_pages: totalPages,
        current_page: parseInt(page),
        items_per_page: take,
        has_next_page: parseInt(page) < totalPages,
        has_prev_page: parseInt(page) > 1
      }
    });

  } catch (err) {
    console.error("Fetch Cleaner Attendance Error:", err);
    res.status(500).json({ error: "Failed to fetch cleaner attendance" });
  }
}

// export async function getCleanerAttendance(req, res) {
//   const { 
//     cleaner_user_id, 
//     search,          
//     company_id, 
//     location_id,
//     start_date, 
//     end_date,
//     page = 1, 
//     limit = 15 
//   } = req.query;

//   try {
//     const whereClause = {};

//     // 1. Filter by Company & Location
//     if (company_id) {
//       whereClause.company_id = BigInt(company_id);
//     }
    
//     if (location_id && location_id !== "all") {
//       try {
//         whereClause.location_id = BigInt(location_id);
//       } catch (error) {
//         return res.json({ data: [], pagination: { total_items: 0, total_pages: 0 } });
//       }
//     }

//     // 2. Exact Cleaner ID filtering
//     if (cleaner_user_id && cleaner_user_id !== "all") {
//       try {
//         whereClause.cleaner_user_id = BigInt(cleaner_user_id);
//       } catch (error) {
//         return res.json({ 
//           data: [], 
//           pagination: { 
//             total_items: 0, total_pages: 0,
//             current_page: parseInt(page), items_per_page: parseInt(limit),
//             has_next_page: false, has_prev_page: false
//           } 
//         });
//       }
//     }

//     // 3. Exclude Deleted Users & Handle Search
//     // We use the relation name 'cleaner_user' to look inside the 'users' table
//     whereClause.cleaner_user = {
//       deleted_at: null 
//     };

//     if (search && search.trim() !== "") {
//       whereClause.cleaner_user.name = {
//         contains: search.trim(), 
//         mode: 'insensitive' 
//       };
//     }

//     // 4. Define Date Window
//     const startDateObj = start_date ? new Date(start_date) : new Date();
//     startDateObj.setUTCHours(0, 0, 0, 0);

//     const endDateObj = end_date ? new Date(end_date) : new Date(startDateObj);
//     endDateObj.setUTCHours(23, 59, 59, 999);

//     whereClause.created_at = {
//       gte: startDateObj,
//       lte: endDateObj,
//     };

//     // 5. Fetch all reviews
//     const reviews = await prisma.cleaner_review.findMany({
//       where: whereClause,
//       select: {
//         id: true,
//         cleaner_user_id: true,
//         created_at: true,
//         status: true,
//         cleaner_user: {
//           select: { id: true, name: true }
//         },
//         location: {
//           select: { name: true }
//         }
//       },
//       orderBy: {
//         created_at: 'asc' 
//       }
//     });

//     // 6. Grouping Logic: One record per cleaner per day
//     const attendanceMap = {};

//     reviews.forEach((review) => {
//       const cleanerId = review.cleaner_user_id.toString();
//       const localDate = new Date(review.created_at).toLocaleDateString('en-CA'); 
//       const key = `${cleanerId}_${localDate}`;

//       if (!attendanceMap[key]) {
//         attendanceMap[key] = {
//           id: `${cleanerId}_${localDate}`,
//           cleaner_id: cleanerId,
//           cleaner_name: review.cleaner_user?.name || "Unknown",
//           date: localDate,
//           check_in_time: review.created_at, 
//           location: review.location?.name || "N/A",
//           logs_count: 1, 
//           status: "Present"
//         };
//       } else {
//         attendanceMap[key].logs_count += 1;
//       }
//     });

//     const allAttendanceRecords = Object.values(attendanceMap);
//     allAttendanceRecords.sort((a, b) => new Date(b.check_in_time) - new Date(a.check_in_time));

//     // 7. Manual Pagination
//     const take = parseInt(limit);
//     const skip = (parseInt(page) - 1) * take;
//     const paginatedRecords = allAttendanceRecords.slice(skip, skip + take);
//     const totalItems = allAttendanceRecords.length;
//     const totalPages = Math.ceil(totalItems / take) || 1;

//     // 8. Safe Serialization
//     const safeSerialize = (obj) => {
//       if (obj === null || obj === undefined) return obj;
//       if (typeof obj === 'bigint') return obj.toString();
//       if (obj instanceof Date) return obj.toISOString();
//       if (Array.isArray(obj)) return obj.map(safeSerialize);
//       if (typeof obj === 'object') {
//         const serialized = {};
//         for (const [key, value] of Object.entries(obj)) {
//           serialized[key] = safeSerialize(value);
//         }
//         return serialized;
//       }
//       return obj;
//     };

//     res.json({
//       data: safeSerialize(paginatedRecords),
//       pagination: {
//         total_items: totalItems,
//         total_pages: totalPages,
//         current_page: parseInt(page),
//         items_per_page: take,
//         has_next_page: parseInt(page) < totalPages,
//         has_prev_page: parseInt(page) > 1
//       }
//     });

//   } catch (err) {
//     console.error("Fetch Cleaner Attendance Error:", err);
//     res.status(500).json({ error: "Failed to fetch cleaner attendance" });
//   }
// }