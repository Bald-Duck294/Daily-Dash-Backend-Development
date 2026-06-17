// backend/controllers/attendance.controller.js
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// export async function getCleanerAttendance(req, res) {
//   const { 
//     cleaner_user_id, 
//     company_id, 
//     start_date, 
//     end_date,
//     page = 1, 
//     limit = 15 
//   } = req.query;

//   try {
//     const whereClause = {};

//     if (company_id) {
//       whereClause.company_id = BigInt(company_id);
//     }
//     if (cleaner_user_id && cleaner_user_id !== "all") {
//       whereClause.cleaner_user_id = BigInt(cleaner_user_id);
//     }

//     // Set Date Range
//     const startDateObj = start_date ? new Date(start_date) : new Date();
//     startDateObj.setUTCHours(0, 0, 0, 0);

//     const endDateObj = end_date ? new Date(end_date) : new Date(startDateObj);
//     endDateObj.setUTCHours(23, 59, 59, 999);

//     whereClause.created_at = {
//       gte: startDateObj,
//       lte: endDateObj,
//     };

//     // Fetch all reviews in range, oldest first
//     const reviews = await prisma.cleaner_review.findMany({
//       where: whereClause,
//       select: {
//         id: true,
//         cleaner_user_id: true,
//         created_at: true,
//         status: true,
//         cleaner_user: { select: { id: true, name: true } },
//         location: { select: { name: true } }
//       },
//       orderBy: { created_at: 'asc' } // Earliest first to catch true check-in
//     });

//     // GROUPING LOGIC: One record per user, per day
//     const attendanceMap = {};

//     reviews.forEach((review) => {
//       const cleanerId = review.cleaner_user_id.toString();
//       // Safely extract YYYY-MM-DD
//       const localDate = new Date(review.created_at).toLocaleDateString('en-CA'); 
//       const key = `${cleanerId}_${localDate}`;

//       if (!attendanceMap[key]) {
//         // First review of the day -> This is their Check-In
//         attendanceMap[key] = {
//           id: `${cleanerId}_${localDate}`,
//           cleaner_id: cleanerId,
//           cleaner_name: review.cleaner_user?.name || "Unknown",
//           date: localDate,
//           check_in_time: review.created_at, // Send the raw ISO date
//           location: review.location?.name || "N/A",
//           logs_count: 1, // Start count at 1
//           status: "Present"
//         };
//       } else {
//         // They already checked in, just increment their log count
//         attendanceMap[key].logs_count += 1;
//       }
//     });

//     const allAttendanceRecords = Object.values(attendanceMap);

//     // Sort newest to oldest for the UI
//     allAttendanceRecords.sort((a, b) => new Date(b.check_in_time) - new Date(a.check_in_time));

//     // Manual Pagination
//     const take = parseInt(limit);
//     const skip = (parseInt(page) - 1) * take;
//     const paginatedRecords = allAttendanceRecords.slice(skip, skip + take);
//     const totalItems = allAttendanceRecords.length;

//     // Serialize BigInts
//     const safeSerialize = (obj) => {
//       if (typeof obj === 'bigint') return obj.toString();
//       if (Array.isArray(obj)) return obj.map(safeSerialize);
//       if (typeof obj === 'object' && obj !== null) {
//         if (obj instanceof Date) return obj.toISOString();
//         return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, safeSerialize(v)]));
//       }
//       return obj;
//     };

//     res.json({
//       data: safeSerialize(paginatedRecords),
//       pagination: {
//         total_items: totalItems,
//         total_pages: Math.ceil(totalItems / take),
//         current_page: parseInt(page),
//         items_per_page: take,
//         has_next_page: parseInt(page) < Math.ceil(totalItems / take),
//         has_prev_page: parseInt(page) > 1
//       }
//     });

//   } catch (err) {
//     console.error("Fetch Cleaner Attendance Error:", err);
//     res.status(500).json({ error: "Failed to fetch attendance" });
//   }
// }
// backend/controllers/attendance.controller.js

export async function getCleanerAttendance(req, res) {
  const { 
    cleaner_user_id, // For exact ID filtering (e.g., from a specific link or dropdown)
    search,          // For text-based name searching
    company_id, 
    start_date, 
    end_date,
    page = 1, 
    limit = 15 
  } = req.query;

  try {
    const whereClause = {};

    // 1. Filter by Company ID
    if (company_id) {
      whereClause.company_id = BigInt(company_id);
    }

    // 2. Safely handle exact Cleaner ID filtering (if provided)
    if (cleaner_user_id && cleaner_user_id !== "all") {
      try {
        whereClause.cleaner_user_id = BigInt(cleaner_user_id);
      } catch (error) {
        // If an invalid ID string is sent, safely return empty data instead of a 500 error
        return res.json({ 
          data: [], 
          pagination: { 
            total_items: 0, 
            total_pages: 0,
            current_page: parseInt(page),
            items_per_page: parseInt(limit),
            has_next_page: false,
            has_prev_page: false
          } 
        });
      }
    }

    // 3. Handle Name Search (if a string is typed in the search box)
    if (search && search.trim() !== "") {
      whereClause.cleaner_user = {
        name: {
          contains: search.trim(), // Partial match for the string
          mode: 'insensitive' 
        }
      };
    }

    // 4. Define Date Window
    const startDateObj = start_date ? new Date(start_date) : new Date();
    startDateObj.setUTCHours(0, 0, 0, 0);

    const endDateObj = end_date ? new Date(end_date) : new Date(startDateObj);
    endDateObj.setUTCHours(23, 59, 59, 999);

    whereClause.created_at = {
      gte: startDateObj,
      lte: endDateObj,
    };

    // 5. Fetch all reviews in the window, ordered oldest first to catch the initial check-in
    const reviews = await prisma.cleaner_review.findMany({
      where: whereClause,
      select: {
        id: true,
        cleaner_user_id: true,
        created_at: true,
        status: true,
        cleaner_user: {
          select: { id: true, name: true }
        },
        location: {
          select: { name: true }
        }
      },
      orderBy: {
        created_at: 'asc' 
      }
    });

    // 6. Grouping Logic: One record per cleaner per day
    const attendanceMap = {};

    reviews.forEach((review) => {
      const cleanerId = review.cleaner_user_id.toString();
      // Using en-CA to safely extract YYYY-MM-DD in local time
      const localDate = new Date(review.created_at).toLocaleDateString('en-CA'); 
      const key = `${cleanerId}_${localDate}`;

      if (!attendanceMap[key]) {
        // First review of the day is marked as the check-in
        attendanceMap[key] = {
          id: `${cleanerId}_${localDate}`,
          cleaner_id: cleanerId,
          cleaner_name: review.cleaner_user?.name || "Unknown",
          date: localDate,
          check_in_time: review.created_at, // The exact punch-in time
          location: review.location?.name || "N/A",
          logs_count: 1, // Start count at 1
          status: "Present"
        };
      } else {
        // Already checked in today, just increment the total logs for the day
        attendanceMap[key].logs_count += 1;
      }
    });

    // Convert map to array and sort newest to oldest for the UI display
    const allAttendanceRecords = Object.values(attendanceMap);
    allAttendanceRecords.sort((a, b) => new Date(b.check_in_time) - new Date(a.check_in_time));

    // 7. Manual Pagination on the grouped records
    const take = parseInt(limit);
    const skip = (parseInt(page) - 1) * take;
    const paginatedRecords = allAttendanceRecords.slice(skip, skip + take);
    const totalItems = allAttendanceRecords.length;
    const totalPages = Math.ceil(totalItems / take) || 1;

    // 8. Safe Serialization for BigInts and Dates
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

    // Return final response
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