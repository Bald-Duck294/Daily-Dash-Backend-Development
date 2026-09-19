import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

// Ensure you have your custom serializer if needed
const serializeBigInt = (obj) => {
  return JSON.parse(
    JSON.stringify(obj, (key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );
};

const prisma = new PrismaClient();

// Use the exact role IDs from your database
const ROLE_MAPPING = { cleaner: 5, supervisor: 3, manager: 2, admin: 2 };

export const deployWorkspace = async (req, res) => {
  try {
    const { hierarchy = [], washrooms = [], users = [] } = req.body;
    const companyId = req.user.company_id;
    console.log(companyId, "company Ids");
    console.log(req.body, "body ");
    if (!companyId) {
      return res.status(400).json({
        success: false,
        code: "MISSING_COMPANY",
        message: "Company ID is required for deployment.",
      });
    }

    // ==========================================
    // 🛡️ PRE-TRANSACTION VALIDATION
    // ==========================================
    const validationErrors = [];
    const allTempIds = new Set();
    const hierarchyMap = new Map();
    const phoneSet = new Set();

    // 1. Validate Hierarchy & Duplicate IDs
    for (const node of hierarchy) {
      if (!node.temp_id)
        validationErrors.push(`Hierarchy node missing temp_id: ${node.name}`);
      if (allTempIds.has(node.temp_id))
        validationErrors.push(
          `Duplicate hierarchy temp_id found: ${node.temp_id}`,
        );
      allTempIds.add(node.temp_id);
      hierarchyMap.set(node.temp_id, node);
    }

    // 2. Validate Washrooms & References
    const washroomMap = new Map();
    for (const w of washrooms) {
      if (!w.temp_id)
        validationErrors.push(`Washroom missing temp_id: ${w.name}`);
      if (allTempIds.has(w.temp_id))
        validationErrors.push(`Duplicate washroom temp_id found: ${w.temp_id}`);
      allTempIds.add(w.temp_id);
      washroomMap.set(w.temp_id, w);

      if (w.zone_temp_id && !hierarchyMap.has(w.zone_temp_id)) {
        validationErrors.push(
          `Washroom '${w.name}' references invalid zone_temp_id: ${w.zone_temp_id}`,
        );
      }
    }

    // 3. Validate Missing Parents
    for (const node of hierarchy) {
      if (node.parent_temp_id && !hierarchyMap.has(node.parent_temp_id)) {
        validationErrors.push(
          `Node '${node.name}' references invalid parent_temp_id: ${node.parent_temp_id}`,
        );
      }
    }

    // 4. Validate Circular Hierarchy (Dry-Run Topological Sort)
    if (validationErrors.length === 0 && hierarchy.length > 0) {
      const dryRunNodes = [...hierarchy];
      const visitedMap = {};
      let dryRunCounter = 0;
      while (dryRunNodes.length > 0) {
        const idx = dryRunNodes.findIndex(
          (n) => !n.parent_temp_id || visitedMap[n.parent_temp_id],
        );
        if (idx === -1 || dryRunCounter > hierarchy.length * 2) {
          validationErrors.push("Circular hierarchy detected in payload.");
          break;
        }
        visitedMap[dryRunNodes[idx].temp_id] = true;
        dryRunNodes.splice(idx, 1);
        dryRunCounter++;
      }
    }

    // 5. Validate Users & Assignments
    const phoneMap = new Map();
    for (const u of users) {
      const cleanPhone = u.phone
        ? String(u.phone).trim().replace(/\D/g, "")
        : "";
      if (!cleanPhone) {
        validationErrors.push(`User '${u.name}' is missing a phone number.`);
      } else if (cleanPhone.length !== 10) {
        validationErrors.push(
          `User '${u.name}' has an invalid phone number '${u.phone}'. Phone number must be 10 digits.`,
        );
      } else if (phoneMap.has(cleanPhone)) {
        const existingName = phoneMap.get(cleanPhone);
        validationErrors.push(
          `Duplicate phone number '${cleanPhone}' detected for users '${existingName}' and '${u.name}'. Each user must have a unique phone number.`,
        );
      } else {
        phoneMap.set(cleanPhone, u.name);
      }

      const assignedLocations =
        u.assigned_locations ||
        (u.assigned_washrooms ? [u.assigned_washrooms] : []);
      for (const locId of assignedLocations) {
        if (!allTempIds.has(locId)) {
          validationErrors.push(
            `User '${u.name}' assigned to invalid location: ${locId}`,
          );
        }
      }
    }

    if (validationErrors.length > 0) {
      const firstError = validationErrors[0];
      let step = "users";
      if (
        firstError.includes("Hierarchy") ||
        firstError.includes("Node") ||
        firstError.includes("Circular") ||
        firstError.includes("parent_temp_id")
      ) {
        step = "hierarchy";
      } else if (
        firstError.includes("Washroom") ||
        firstError.includes("zone_temp_id")
      ) {
        step = "washrooms";
      }

      return res.status(400).json({
        success: false,
        code: "VALIDATION_FAILED",
        step,
        message: validationErrors.join(" "),
        errors: validationErrors,
      });
    }

    // ==========================================
    // 🔐 PASSWORD HASHING (Pre-Transaction)
    // ==========================================

    // 🚀 THE FIX: Pre-hash all passwords OUTSIDE the transaction!
    // This prevents Bcrypt from slowing down and crashing the Prisma transaction.
    const usersWithCredentials = await Promise.all(
      users.map(async (u) => {
        const plainPin = Math.floor(100000 + Math.random() * 900000).toString();
        const hashedPassword = await bcrypt.hash(plainPin, 10);
        return { ...u, plainPin, hashedPassword };
      }),
    );

    const generatedCredentials = [];

    // 🚀 START DATABASE TRANSACTION WITH EXTENDED TIMEOUT (30 seconds)
    await prisma.$transaction(
      async (tx) => {
        // ==========================================
        // 🚨 STEP 0: SAAS LIMITS BULK VERIFICATION
        // ==========================================
        const limits = await tx.system_limits.findMany({
          where: {
            OR: [{ company_id: BigInt(companyId) }, { company_id: null }],
            is_enabled: true,
          },
          orderBy: { company_id: "asc" },
        });

        const getLimit = (key) => limits.find((l) => l.limit_key === key);
        const washroomLimit = getLimit("MAX_WASHROOMS");
        const userLimit = getLimit("MAX_USERS");
        const cleanerLimit = getLimit("MAX_CLEANERS");
        const newCleanersCount = users.filter(
          (u) => u.role.toLowerCase() === "cleaner",
        ).length;

        console.log(washroomLimit, userLimit, cleanerLimit, newCleanersCount);
        if (
          washroomLimit &&
          washroomLimit.current_value + washrooms.length >
            washroomLimit.limit_value
        ) {
          throw new Error(`LIMIT_WASHROOMS:${washroomLimit.limit_value}`);
        }
        if (
          userLimit &&
          userLimit.current_value + users.length > userLimit.limit_value
        ) {
          throw new Error(`LIMIT_USERS:${userLimit.limit_value}`);
        }
        if (
          cleanerLimit &&
          cleanerLimit.current_value + newCleanersCount >
            cleanerLimit.limit_value
        ) {
          throw new Error(`LIMIT_CLEANERS:${cleanerLimit.limit_value}`);
        }

        // ==========================================
        // 🧹 STEP 1: IDEMPOTENT CLEANUP (ALWAYS PURGE ON DEPLOY)
        // ==========================================
        console.log(
          "Purging existing drafts for company to sync new deployment:",
          companyId,
        );
        await tx.cleaner_assignments.deleteMany({
          where: { company_id: BigInt(companyId) },
        });

        // 🚨 IMPORTANT: Prisma deleteMany on self-referencing tables can fail if order is wrong.
        // But since we are dropping everything for the company, we'll try a raw query or just deleteMany.
        // Actually, Prisma handles deleteMany correctly if there are no circular FK restrict rules.
        await tx.locations.deleteMany({
          where: { company_id: BigInt(companyId) },
        });

        await tx.location_types.updateMany({
          where: { company_id: BigInt(companyId) },
          data: { parent_id: null },
        });

        await tx.location_types.deleteMany({
          where: { company_id: BigInt(companyId) },
        });

        await tx.users.deleteMany({
          where: {
            company_id: BigInt(companyId),
            id: { not: BigInt(req.user.id) },
          },
        });

        // ==========================================
        // 🏗️ STEP 2: HIERARCHY AS LOCATION_TYPES (Topological Sort)
        // ==========================================
        // The hierarchy nodes (buildings, floors, zones) are stored as location_types,
        // NOT as locations. Only washrooms go into the locations table.

        const idMap = {}; // Maps temp_id -> real DB id (for location_types)
        const nodesToProcess = [...hierarchy];
        let safetyCounter = 0;

        while (nodesToProcess.length > 0) {
          const nodeIndex = nodesToProcess.findIndex(
            (n) => !n.parent_temp_id || idMap[n.parent_temp_id],
          );

          if (nodeIndex === -1 || safetyCounter > hierarchy.length * 2) {
            throw new Error("HIERARCHY_CIRCULAR_DEPENDENCY");
          }

          const node = nodesToProcess.splice(nodeIndex, 1)[0];

          const createdType = await tx.location_types.create({
            data: {
              name: node.name,
              parent_id: node.parent_temp_id
                ? BigInt(idMap[node.parent_temp_id])
                : null,
              company_id: BigInt(companyId),
              ui_type: node.type?.toLowerCase() || null,
            },
          });

          idMap[node.temp_id] = createdType.id;
          safetyCounter++;
        }

        // ==========================================
        // 🚻 STEP 3: WASHROOMS AS LOCATIONS
        // ==========================================
        // Washrooms are the actual locations. Each washroom is linked
        // to a location_type (hierarchy node) via type_id.

        for (const w of washrooms) {
          // The zone_temp_id references a hierarchy node, which is now a location_type
          const parentTypeId = w.zone_temp_id ? idMap[w.zone_temp_id] : null;

          const createdWashroom = await tx.locations.create({
            data: {
              name: w.name,
              type_id: parentTypeId ? BigInt(parentTypeId) : null,
              parent_id: null,
              company_id: BigInt(companyId),
              status: true,
              options: {
                type: w.type,
                wc_count: w.wc_count,
                basin_count: w.basin_count,
              },
            },
          });
          idMap[w.temp_id] = createdWashroom.id;
        }

        // ==========================================
        // 👥 STEP 5: USERS & ASSIGNMENTS
        // ==========================================
        for (const u of usersWithCredentials) {
          const roleId = ROLE_MAPPING[u.role.toLowerCase()] || 5;

          // Use the pre-calculated hash
          const createdUser = await tx.users.create({
            data: {
              name: u.name,
              phone: u.phone,
              role_id: roleId,
              company_id: BigInt(companyId),
              password: u.hashedPassword, // <-- Pre-calculated
              created_by: BigInt(req.user.id),
            },
          });

          generatedCredentials.push({
            name: u.name,
            phone: u.phone,
            pin: u.plainPin, // <-- Pre-calculated
            role: u.role,
          });

          const targetTempIds =
            u.assigned_locations && u.assigned_locations.length > 0
              ? u.assigned_locations
              : u.assigned_zone_temp_id
                ? [u.assigned_zone_temp_id]
                : [];

          for (const targetTempId of targetTempIds) {
            if (targetTempId && idMap[targetTempId]) {
              await tx.cleaner_assignments.create({
                data: {
                  name: `${u.name} Assignment`,
                  cleaner_user_id: createdUser.id,
                  company_id: BigInt(companyId),
                  location_id: BigInt(idMap[targetTempId]),
                  role_id: roleId,
                  status: "assigned",
                  assigned_on: new Date(),
                },
              });
            }
          }
        }

        // ==========================================
        // 📈 STEP 6: COMMIT BULK LIMIT UPDATES
        // ==========================================
        await tx.companies.update({
          where: { id: BigInt(companyId) },
          data: { is_onboarding_completed: true },
        });
        if (washroomLimit && washrooms.length > 0) {
          await tx.system_limits.update({
            where: { id: washroomLimit.id },
            data: { current_value: { increment: washrooms.length } },
          });
        }
        if (userLimit && users.length > 0) {
          await tx.system_limits.update({
            where: { id: userLimit.id },
            data: { current_value: { increment: users.length } },
          });
        }
        if (cleanerLimit && newCleanersCount > 0) {
          await tx.system_limits.update({
            where: { id: cleanerLimit.id },
            data: { current_value: { increment: newCleanersCount } },
          });
        }
      },
      {
        // 🚀 EXTENDED TIMEOUTS FOR VERCEL 🚀
        maxWait: 10000, // 10 seconds to connect
        timeout: 30000, // 30 seconds to finish
      },
    );

    console.log("SUCCESS! Generated Credentials:", generatedCredentials);

    res.status(201).json({
      success: true,
      message: "Workspace deployed successfully",
    });
  } catch (error) {
    console.error("Workspace Deployment Error:", error);

    if (error.code === "P2002") {
      const target = error.meta?.target || [];
      const targetStr = Array.isArray(target)
        ? target.join(",")
        : String(target);

      if (targetStr.includes("phone") || targetStr.includes("unique_phone")) {
        try {
          const userPhones = users
            .map((u) =>
              u.phone ? String(u.phone).trim().replace(/\D/g, "") : "",
            )
            .filter(Boolean);

          const existingInDb = await prisma.users.findMany({
            where: { phone: { in: userPhones } },
            select: { phone: true, name: true },
          });

          if (existingInDb.length > 0) {
            const conflictDetails = existingInDb
              .map((dbUser) => {
                const inputUser = users.find(
                  (u) =>
                    String(u.phone).trim().replace(/\D/g, "") === dbUser.phone,
                );
                return inputUser
                  ? `'${dbUser.phone}' (${inputUser.name})`
                  : `'${dbUser.phone}'`;
              })
              .join(", ");

            return res.status(422).json({
              success: false,
              code: "PHONE_ALREADY_EXISTS",
              step: "users",
              message: `The following phone number(s) are already registered in the system: ${conflictDetails}. Please use unique phone numbers for each user.`,
            });
          }
        } catch (dbErr) {
          console.error("Failed to query conflicting phone numbers:", dbErr);
        }

        return res.status(422).json({
          success: false,
          code: "PHONE_ALREADY_EXISTS",
          step: "users",
          message:
            "One or more user phone numbers are already registered in the system. Please ensure all phone numbers are unique.",
        });
      }
    }

    if (error.message.startsWith("LIMIT_")) {
      const parts = error.message.split(":");
      return res.status(403).json({
        success: false,
        code: "QUOTA_EXCEEDED",
        message: `Your plan limits you to ${parts[1]} ${parts[0].replace("LIMIT_", "").toLowerCase()}.`,
      });
    }

    res.status(500).json({
      success: false,
      code: "SERVER_ERROR",
      message: "Deployment failed due to a server error.",
      details: error.message,
    });
  }
};

export const getWorkspaceStatus = async (req, res) => {
  try {
    const companyId = req.user.company_id;

    if (!companyId) {
      return res
        .status(400)
        .json({ success: false, error: "Company ID missing" });
    }

    // Execute independent counts concurrently
    const [
      hierarchyCount,
      washroomCount,
      workspaceUserCount,
      assignmentCount,
      lastAssignment,
    ] = await Promise.all([
      // Count locations that are NOT toilets
      prisma.locations.count({
        where: {
          company_id: BigInt(companyId),
          location_types: { is_toilet: false },
        },
      }),
      // Count locations that ARE toilets
      prisma.locations.count({
        where: {
          company_id: BigInt(companyId),
          location_types: { is_toilet: true },
        },
      }),
      // Count all users EXCEPT Admin (role_id 2)
      prisma.users.count({
        where: { company_id: BigInt(companyId), role_id: { not: 2 } },
      }),
      // Count total assignments
      prisma.cleaner_assignments.count({
        where: { company_id: BigInt(companyId) },
      }),
      // Get the latest assignment to determine lastConfiguredAt
      prisma.cleaner_assignments.findFirst({
        where: { company_id: BigInt(companyId) },
        orderBy: { created_at: "desc" },
        select: { created_at: true },
      }),
    ]);

    // DB is the source of truth for workspace configuration
    const configured =
      hierarchyCount > 0 ||
      washroomCount > 0 ||
      workspaceUserCount > 0 ||
      assignmentCount > 0;

    res.status(200).json({
      success: true,
      data: {
        configured,
        hierarchyCount,
        washroomCount,
        workspaceUserCount,
        assignmentCount,
        lastConfiguredAt: lastAssignment?.created_at || null,
      },
    });
  } catch (error) {
    console.error("Workspace Status Error:", error);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch workspace status" });
  }
};

// ==========================================
// POST /workspace/reset
// ==========================================
export const resetWorkspace = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    // Authorization Check: Only Admin (Role 2)
    if (req.user.role_id !== 2) {
      return res
        .status(403)
        .json({ success: false, error: "Forbidden: Administrators only." });
    }

    // 🚀 ATOMIC TRANSACTION
    await prisma.$transaction(
      async (tx) => {
        // 1. Delete Dependent Review/Log Records
        await tx.cleaner_review.deleteMany({
          where: { company_id: BigInt(companyId) },
        });
        await tx.user_review.deleteMany({
          where: { company_id: BigInt(companyId) },
        });

        // activity_logs relations point to 'users'
        await tx.activity_logs.deleteMany({
          where: { users: { company_id: BigInt(companyId) } },
        });

        // 2. Delete Assignments
        await tx.cleaner_assignments.deleteMany({
          where: { company_id: BigInt(companyId) },
        });

        // shift_assignments relations point to 'user'
        await tx.shift_assignments.deleteMany({
          where: { user: { company_id: BigInt(companyId) } },
        });

        // 3. Delete Saved Locations
        // saved_locations relations point to 'users'
        await tx.saved_locations.deleteMany({
          where: { users: { company_id: BigInt(companyId) } },
        });

        // 4. Delete Hygiene Scores
        await tx.hygiene_scores.deleteMany({
          where: { company_id: BigInt(companyId) },
        });

        // 5. Cleanup User Tokens & Sessions BEFORE deleting users (due to onDelete: NoAction)
        await tx.sessions.deleteMany({
          where: {
            users: { company_id: BigInt(companyId), role_id: { not: 2 } },
          },
        });
        await tx.refresh_tokens.deleteMany({
          where: {
            users: { company_id: BigInt(companyId), role_id: { not: 2 } },
          },
        });

        // 6. Delete Workspace Users (Keep Admin: role_id 2)
        await tx.users.deleteMany({
          where: { company_id: BigInt(companyId), role_id: { not: 2 } },
        });

        // 7. Clear Foreign Keys and Delete Locations
        await tx.locations.updateMany({
          where: { company_id: BigInt(companyId) },
          data: { parent_id: null, type_id: null },
        });
        await tx.locations.deleteMany({
          where: { company_id: BigInt(companyId) },
        });

        // 8. Clear Parent Keys and Delete Location Types
        await tx.location_types.updateMany({
          where: { company_id: BigInt(companyId) },
          data: { parent_id: null },
        });
        await tx.location_types.deleteMany({
          where: { company_id: BigInt(companyId) },
        });

        // 9. Reset System Limits to 0
        await tx.system_limits.updateMany({
          where: { company_id: BigInt(companyId) },
          data: { current_value: 0 },
        });

        // 10. Finalize Company Status (Leave onboarding_metadata untouched)
        await tx.companies.update({
          where: { id: BigInt(companyId) },
          data: { is_onboarding_completed: false },
        });
      },
      {
        maxWait: 10000,
        timeout: 30000,
      },
    );

    res
      .status(200)
      .json({ success: true, message: "Workspace reset complete." });
  } catch (error) {
    console.error("Workspace Reset Error:", error);
    res.status(500).json({
      success: false,
      error: "Reset failed. Transaction rolled back.",
      details: error.message,
    });
  }
};
