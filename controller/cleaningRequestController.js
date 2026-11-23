import prisma from "../config/prismaClient.mjs";
import { getMessaging } from "firebase-admin/messaging";
import { getApps } from "firebase-admin/app";

// Helper to safely serialize BigInt and Date for JSON responses
export const serializeBigInt = (obj) => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "bigint") return obj.toString();
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(serializeBigInt);
  if (typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [key, serializeBigInt(value)])
    );
  }
  return obj;
};

// Universal push notification dispatcher helper
const sendPushNotificationToUser = async (userId, { title, body, data = {} }) => {
  if (!userId) return { success: false, reason: "No userId" };
  try {
    if (!getApps().length) {
      console.warn("[FCM] Firebase Admin is not initialized.");
      return { success: false, reason: "Firebase Admin not initialized" };
    }
    const messaging = getMessaging();
    const userIdBigInt = BigInt(userId);

    // 1. Check user_fcm_tokens (active)
    const tokenRecords = await prisma.user_fcm_tokens.findMany({
      where: {
        user_id: userIdBigInt,
        is_active: true,
      },
      select: { fcm_token: true },
    });

    const tokens = new Set(tokenRecords.map((r) => r.fcm_token).filter(Boolean));

    // 2. Also check legacy users.fcm_token
    const userRecord = await prisma.users.findUnique({
      where: { id: userIdBigInt },
      select: { fcm_token: true, name: true },
    });

    if (userRecord?.fcm_token) {
      tokens.add(userRecord.fcm_token);
    }

    if (tokens.size === 0) {
      console.log(`[FCM] No active FCM tokens found for user ${userId} (${userRecord?.name || "Unknown"})`);
      return { success: false, tokenCount: 0, reason: "No active FCM tokens for user" };
    }

    console.log(`[FCM] Sending push notification to user ${userId} (${userRecord?.name}) across ${tokens.size} token(s)...`);

    let sentCount = 0;
    for (const token of tokens) {
      const message = {
        token,
        notification: { title, body },
        data: {
          title: String(title),
          body: String(body),
          click_action: "FLUTTER_NOTIFICATION_CLICK",
          ...Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, String(v ?? "")])
          ),
        },
        android: {
          priority: "high",
          notification: {
            sound: "default",
            channelId: "saafai_cleaning_tasks",
            priority: "max",
          },
        },
        apns: {
          headers: {
            "apns-priority": "10",
          },
          payload: {
            aps: {
              sound: "default",
              badge: 1,
            },
          },
        },
        webpush: {
          notification: {
            title,
            body,
            icon: "/icon-192x192.png",
          },
        },
      };

      try {
        const response = await messaging.send(message);
        console.log(`[FCM] Successfully delivered to token ${token.slice(0, 15)}... MsgID:`, response);
        sentCount++;
      } catch (err) {
        console.warn(`[FCM] Delivery failed for token ${token.slice(0, 15)}...:`, err.message);
        const errLower = (err.message || "").toLowerCase();
        if (
          err.code === "messaging/registration-token-not-registered" ||
          err.code === "messaging/invalid-registration-token" ||
          errLower.includes("not registered") ||
          errLower.includes("invalid")
        ) {
          await prisma.user_fcm_tokens.updateMany({
            where: { fcm_token: token },
            data: { is_active: false },
          }).catch(() => {});
        }
      }
    }

    return { success: sentCount > 0, tokenCount: tokens.size, sentCount };
  } catch (err) {
    console.error("[FCM] Error in sendPushNotificationToUser:", err.message);
    return { success: false, error: err.message };
  }
};

/**
 * 1. POST /api/cleaning-requests
 * Create a new cleaning request (submitted by citizens or staff)
 */
export const createCleaningRequest = async (req, res) => {
  try {
    const {
      location_id,
      issue_type,
      description,
      photos,
      priority = "normal",
      user_name,
      user_phone,
    } = req.body;

    if (!location_id) {
      return res.status(400).json({ success: false, message: "location_id is required" });
    }
    if (!issue_type) {
      return res.status(400).json({ success: false, message: "issue_type is required" });
    }

    const userId = req.user?.id ? BigInt(req.user.id) : null;
    const locationIdBigInt = BigInt(location_id);

    const newRequest = await prisma.cleaning_requests.create({
      data: {
        location_id: locationIdBigInt,
        user_id: userId,
        user_name: user_name || req.user?.name || "Citizen",
        user_phone: user_phone || req.user?.phone || null,
        issue_type: Array.isArray(issue_type) ? issue_type.join(", ") : String(issue_type),
        description: description || null,
        photos: Array.isArray(photos) ? photos : photos ? [photos] : [],
        priority: priority === "urgent" ? "urgent" : "normal",
        status: "pending",
        assignment_type: "manual",
      },
      include: {
        locations: {
          select: {
            id: true,
            name: true,
            address: true,
            city: true,
          },
        },
      },
    });

    // -------------------------------------------------------------------------
    // AUTO-ASSIGN ON THRESHOLD FEATURE CHECK (service_req_threshold)
    // -------------------------------------------------------------------------
    try {
      const locDetails = await prisma.locations.findUnique({
        where: { id: locationIdBigInt },
        select: { id: true, name: true, company_id: true },
      });

      if (locDetails?.company_id) {
        // Check if service_req_threshold is active for this company
        const thresholdConfig = await prisma.configurations.findFirst({
          where: {
            company_id: locDetails.company_id,
            name: { in: ["service_req_threshold", "service_req_thredshold"] },
            is_active: true,
          },
        });

        if (thresholdConfig) {
          const desc = thresholdConfig.description && typeof thresholdConfig.description === "object"
            ? thresholdConfig.description
            : {};
          const thresholdLimit = Math.max(1, Number(desc.threshold || desc.value) || 3);

          // Count pending cleaning requests for this washroom
          const pendingCount = await prisma.cleaning_requests.count({
            where: {
              location_id: locationIdBigInt,
              status: "pending",
            },
          });

          console.log(`[THRESHOLD CHECK] Location #${locationIdBigInt} (${locDetails.name}): Pending ${pendingCount} / Threshold ${thresholdLimit}`);

          if (pendingCount >= thresholdLimit) {
            // Find active cleaner assigned to this washroom in cleaner_assignments
            const cleanerAssignment = await prisma.cleaner_assignments.findFirst({
              where: {
                location_id: locationIdBigInt,
                deleted_at: null,
                cleaner_user: {
                  role_id: 5,
                  deleted_at: null,
                },
              },
              orderBy: { assigned_on: "desc" },
              include: { cleaner_user: true },
            });

            if (cleanerAssignment?.cleaner_user) {
              const cleanerId = cleanerAssignment.cleaner_id;
              const cleanerName = cleanerAssignment.cleaner_user.name || "Cleaner";

              // Auto-assign all pending requests for this washroom
              await prisma.cleaning_requests.updateMany({
                where: {
                  location_id: locationIdBigInt,
                  status: "pending",
                },
                data: {
                  assigned_cleaner_id: cleanerId,
                  status: "in_progress",
                  assignment_type: "auto_threshold",
                  assigned_at: new Date(),
                  notes: `Auto-assigned: Requests reached threshold of ${thresholdLimit} (${pendingCount} pending requests)`,
                  updated_at: new Date(),
                },
              });

              console.log(`[AUTO-ASSIGNED] Cleanliness threshold reached for ${locDetails.name}. Assigned to ${cleanerName} (User #${cleanerId}).`);

              // Notify cleaner via FCM
              sendPushNotificationToUser(cleanerId, {
                title: "Auto-Assigned Cleaning Task",
                body: `Multiple cleaning requests (${pendingCount}) reported at ${locDetails.name}. Task automatically assigned to you.`,
                data: {
                  type: "auto_threshold_assignment",
                  location_id: locationIdBigInt.toString(),
                  threshold: thresholdLimit.toString(),
                },
              }).catch((e) => console.warn("[FCM] Cleaner threshold notification error:", e.message));

              // Update newRequest in response to reflect auto-assigned state
              newRequest.assigned_cleaner_id = cleanerId;
              newRequest.status = "in_progress";
              newRequest.assignment_type = "auto_threshold";
              newRequest.assigned_at = new Date();
            } else {
              console.warn(`[THRESHOLD CHECK] Threshold reached at ${locDetails.name}, but no active cleaner is mapped to this washroom in cleaner_assignments.`);
            }
          }
        }
      }
    } catch (thresholdErr) {
      console.warn("Non-blocking error checking service_req_threshold:", thresholdErr.message);
    }

    const serialized = serializeBigInt(newRequest);
    const loc = serialized.locations || serialized.location || null;
    return res.status(201).json({
      success: true,
      message: "Cleaning request submitted successfully",
      data: {
        ...serialized,
        location: loc,
        locations: loc,
      },
    });
  } catch (error) {
    console.error("Error creating cleaning request:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 2. GET /api/cleaning-requests
 * Paginated list of cleaning requests with multi-filters
 */
export const getCleaningRequests = async (req, res) => {
  try {
    const {
      company_id,
      location_id,
      status,
      priority,
      cleaner_id,
      supervisor_id,
      search,
      page = 1,
      limit = 15,
    } = req.query;

    const whereClause = {};

    // 1. Company Filter
    const targetCompanyId = company_id || req.user?.company_id;
    if (targetCompanyId && targetCompanyId !== "all" && targetCompanyId !== "ALL") {
      whereClause.locations = {
        company_id: BigInt(targetCompanyId),
      };
    }

    // 2. Location Filter
    if (location_id && location_id !== "all" && location_id !== "ALL") {
      whereClause.location_id = BigInt(location_id);
    }

    // 3. Status Filter
    if (status && status !== "all" && status !== "ALL") {
      whereClause.status = status;
    }

    // 4. Priority Filter
    if (priority && priority !== "all" && priority !== "ALL") {
      whereClause.priority = priority;
    }

    // 5. Assigned Cleaner Filter
    if (cleaner_id && cleaner_id !== "all" && cleaner_id !== "ALL") {
      whereClause.assigned_cleaner_id = BigInt(cleaner_id);
    }

    // 6. Supervisor Filter
    if (supervisor_id && supervisor_id !== "all" && supervisor_id !== "ALL") {
      whereClause.supervisor_id = BigInt(supervisor_id);
    }

    // 7. Text Search
    if (search && search.trim()) {
      const q = search.trim();
      whereClause.OR = [
        { user_name: { contains: q, mode: "insensitive" } },
        { user_phone: { contains: q } },
        { issue_type: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        {
          locations: {
            name: { contains: q, mode: "insensitive" },
          },
        },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 15);
    const skip = (pageNum - 1) * limitNum;

    const [total, requests] = await Promise.all([
      prisma.cleaning_requests.count({ where: whereClause }),
      prisma.cleaning_requests.findMany({
        where: whereClause,
        skip,
        take: limitNum,
        orderBy: { created_at: "desc" },
        include: {
          locations: {
            select: {
              id: true,
              name: true,
              address: true,
              city: true,
              company_id: true,
            },
          },
          users_cleaning_requests_assigned_cleaner_idTousers: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              avatar_url: true,
            },
          },
          users_cleaning_requests_supervisor_idTousers: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
            },
          },
          users_cleaning_requests_user_idTousers: {
            select: {
              id: true,
              name: true,
              phone: true,
            },
          },
        },
      }),
    ]);

    // Format cleaner, supervisor, citizen, location, issues, and photos cleanly
    const formatted = requests.map((r) => {
      const s = serializeBigInt(r);
      const loc = s.locations || s.location || null;

      // Parse issue_type string (e.g. "Dirty Toilet, No Water") into array of chips
      const rawIssues = s.issue_type || "";
      const parsedIssues = Array.isArray(rawIssues)
        ? rawIssues
        : rawIssues
        ? rawIssues.split(",").map((i) => i.trim()).filter(Boolean)
        : [];

      // Normalize photos array
      const rawPhotos = s.photos || s.images || [];
      const parsedPhotos = Array.isArray(rawPhotos)
        ? rawPhotos
        : rawPhotos
        ? [rawPhotos]
        : [];

      return {
        ...s,
        location: loc,
        locations: loc,
        issues: parsedIssues,
        images: parsedPhotos,
        photos: parsedPhotos,
        assigned_cleaner: s.users_cleaning_requests_assigned_cleaner_idTousers || null,
        supervisor: s.users_cleaning_requests_supervisor_idTousers || null,
        citizen: s.users_cleaning_requests_user_idTousers || null,
        users_cleaning_requests_assigned_cleaner_idTousers: undefined,
        users_cleaning_requests_supervisor_idTousers: undefined,
        users_cleaning_requests_user_idTousers: undefined,
      };
    });

    return res.status(200).json({
      success: true,
      data: formatted,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("Error in getCleaningRequests:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 3. GET /api/cleaning-requests/cleaners
 * Get cleaners assigned to a specific washroom location in cleaner_assignments
 */
export const getToiletCleaners = async (req, res) => {
  try {
    const { location_id } = req.query;

    if (!location_id) {
      return res.status(400).json({
        success: false,
        message: "location_id is required",
      });
    }

    const assignments = await prisma.cleaner_assignments.findMany({
      where: {
        location_id: BigInt(location_id),
        deleted_at: null,
        cleaner_user: {
          role_id: 5, // Cleaner role (excludes supervisors, facility managers, and admins)
        },
      },
      include: {
        cleaner_user: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            avatar_url: true,
            role_id: true,
          },
        },
      },
      orderBy: { assigned_on: "desc" },
    });

    // Deduplicate unique cleaners
    const seenCleanerIds = new Set();
    const cleaners = [];

    for (const a of assignments) {
      if (a.cleaner_user && !seenCleanerIds.has(a.cleaner_user.id.toString())) {
        seenCleanerIds.add(a.cleaner_user.id.toString());
        cleaners.push({
          id: a.cleaner_user.id.toString(),
          name: a.cleaner_user.name || "Cleaner",
          phone: a.cleaner_user.phone || null,
          email: a.cleaner_user.email || null,
          avatar_url: a.cleaner_user.avatar_url || null,
        });
      }
    }

    return res.status(200).json({
      success: true,
      data: cleaners,
      count: cleaners.length,
    });
  } catch (error) {
    console.error("Error in getToiletCleaners:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 4. POST /api/cleaning-requests/assign
 * Supervisor task allocation: assigns cleaner to 1 or more cleaning requests
 */
export const assignCleaningTask = async (req, res) => {
  try {
    const cleaner_id_val = req.body.cleaner_user_id || req.body.cleaner_id;
    const supervisor_id_val = req.body.supervisor_id || req.user?.id;
    const notes_val = req.body.notes;

    if (!cleaner_id_val) {
      return res.status(400).json({
        success: false,
        message: "cleaner_user_id (or cleaner_id) is required",
      });
    }

    const ids = Array.isArray(req.body.request_ids)
      ? req.body.request_ids.map((id) => BigInt(id))
      : req.body.request_id
      ? [BigInt(req.body.request_id)]
      : req.body.id
      ? [BigInt(req.body.id)]
      : [];

    if (!ids.length) {
      return res.status(400).json({
        success: false,
        message: "request_ids (or request_id) is required",
      });
    }

    const cleanerIdBigInt = BigInt(cleaner_id_val);
    const supervisorIdBigInt = supervisor_id_val ? BigInt(supervisor_id_val) : null;

    // Update all matching requests
    await prisma.cleaning_requests.updateMany({
      where: {
        id: { in: ids },
      },
      data: {
        assigned_cleaner_id: cleanerIdBigInt,
        supervisor_id: supervisorIdBigInt,
        status: "in_progress",
        assignment_type: "manual",
        assigned_at: new Date(),
        notes: notes_val || undefined,
        updated_at: new Date(),
      },
    });

    // Fetch location and cleaner details for push notifications
    const sampleReq = await prisma.cleaning_requests.findFirst({
      where: { id: ids[0] },
      include: {
        locations: { select: { id: true, name: true } },
        users_cleaning_requests_assigned_cleaner_idTousers: { select: { id: true, name: true } },
      },
    });

    const locationName = sampleReq?.locations?.name || "Washroom";
    const cleanerName = sampleReq?.users_cleaning_requests_assigned_cleaner_idTousers?.name || "Cleaner";

    // 1. Notify cleaner via FCM
    const cleanerNotification = await sendPushNotificationToUser(cleaner_id_val, {
      title: "New Cleaning Task Assigned",
      body: `You have been assigned ${ids.length > 1 ? `${ids.length} cleaning tasks` : "a cleaning task"} at ${locationName}.`,
      data: {
        type: "cleaning_task_assigned",
        request_id: ids[0].toString(),
        location_id: sampleReq?.locations?.id?.toString() || "",
      },
    });

    // 2. Notify citizen user if present on request
    let citizenNotification = null;
    if (sampleReq?.user_id) {
      citizenNotification = await sendPushNotificationToUser(sampleReq.user_id, {
        title: "Cleaning Request Update",
        body: `Your cleaning request #${ids[0]} for ${locationName} has been assigned to ${cleanerName} and is now in progress.`,
        data: {
          type: "cleaning_task_in_progress",
          request_id: ids[0].toString(),
        },
      });
    }

    return res.status(200).json({
      success: true,
      message: `Assigned ${ids.length} cleaning task(s) to cleaner successfully`,
      assigned_count: ids.length,
      cleaner_notification: cleanerNotification,
      citizen_notification: citizenNotification,
    });
  } catch (error) {
    console.error("Error in assignCleaningTask:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 5. PUT /api/cleaning-requests/:id/status
 * Update cleaning request status (e.g. pending -> in_progress -> resolved)
 */
export const updateCleaningRequestStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, resolution_notes } = req.body;
    const notes_val = resolution_notes || notes;

    if (!id) {
      return res.status(400).json({ success: false, message: "Request ID is required" });
    }

    const validStatuses = ["pending", "in_progress", "resolved"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed values: ${validStatuses.join(", ")}`,
      });
    }

    const updateData = {
      status,
      updated_at: new Date(),
    };

    if (notes_val !== undefined) {
      updateData.notes = notes_val;
    }

    if (status === "resolved") {
      updateData.resolved_at = new Date();
    }

    const updated = await prisma.cleaning_requests.update({
      where: { id: BigInt(id) },
      data: updateData,
      include: {
        locations: { select: { name: true } },
      },
    });

    // Notify citizen user when ticket is resolved
    if (status === "resolved" && updated.user_id) {
      sendPushNotificationToUser(updated.user_id, {
        title: "Cleaning Request Resolved",
        body: `Your cleaning request #${id} for ${updated.locations?.name || "Washroom"} has been resolved. Thank you!`,
        data: {
          type: "cleaning_task_resolved",
          request_id: id.toString(),
        },
      }).catch((err) => {
        console.warn("[FCM] Citizen resolution notification error:", err.message);
      });
    }

    const serializedUpdated = serializeBigInt(updated);
    const updatedLoc = serializedUpdated.locations || serializedUpdated.location || null;
    return res.status(200).json({
      success: true,
      message: `Request status updated to '${status}'`,
      data: {
        ...serializedUpdated,
        location: updatedLoc,
        locations: updatedLoc,
      },
    });
  } catch (error) {
    console.error("Error updating cleaning request status:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 6. GET /api/cleaning-requests/stats
 * Get overview KPI statistics for cleaning requests
 */
export const getCleaningRequestStats = async (req, res) => {
  try {
    const { company_id, supervisor_id, cleaner_id } = req.query;

    const whereClause = {};

    const targetCompanyId = company_id || req.user?.company_id;
    if (targetCompanyId && targetCompanyId !== "all" && targetCompanyId !== "ALL") {
      whereClause.locations = {
        company_id: BigInt(targetCompanyId),
      };
    }

    if (supervisor_id && supervisor_id !== "all" && supervisor_id !== "ALL") {
      whereClause.supervisor_id = BigInt(supervisor_id);
    }

    if (cleaner_id && cleaner_id !== "all" && cleaner_id !== "ALL") {
      whereClause.assigned_cleaner_id = BigInt(cleaner_id);
    }

    const [
      total,
      pending,
      inProgress,
      resolved,
      urgent,
      autoAssigned,
    ] = await Promise.all([
      prisma.cleaning_requests.count({ where: whereClause }),
      prisma.cleaning_requests.count({ where: { ...whereClause, status: "pending" } }),
      prisma.cleaning_requests.count({ where: { ...whereClause, status: "in_progress" } }),
      prisma.cleaning_requests.count({ where: { ...whereClause, status: "resolved" } }),
      prisma.cleaning_requests.count({ where: { ...whereClause, priority: "urgent" } }),
      prisma.cleaning_requests.count({ where: { ...whereClause, assignment_type: "auto_threshold" } }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        total,
        pending,
        in_progress: inProgress,
        resolved,
        urgent,
        auto_assigned: autoAssigned,
      },
    });
  } catch (error) {
    console.error("Error in getCleaningRequestStats:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
