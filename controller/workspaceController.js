import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { serializeBigInt } from "../utils/serializer.js";

const prisma = new PrismaClient();

// Role and Type Mappings (Adjust these IDs based on your actual DB records)
const TYPE_MAPPING = { building: 1, floor: 2, zone: 3, ward: 7 };
const WASHROOM_TYPE_ID = 4;
const ROLE_MAPPING = { cleaner: 5, supervisor: 3, manager: 2 };

export const deployWorkspace = async (req, res) => {
  try {
    const { discovery, hierarchy = [], washrooms = [], users = [] } = req.body;
    const companyId = req.user.company_id;

    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: "Company ID is required for deployment.",
      });
    }

    // 🚀 START DATABASE TRANSACTION
    const result = await prisma.$transaction(async (tx) => {
      // ==========================================
      // 🚨 STEP 0: SAAS LIMITS BULK VERIFICATION
      // ==========================================
      const limits = await tx.system_limits.findMany({
        where: {
          OR: [{ company_id: BigInt(companyId) }, { company_id: null }],
          is_enabled: true,
        },
        orderBy: { company_id: "asc" }, // Prioritize company specific over global
      });

      // Helper to get limit safely
      const getLimit = (key) => limits.find((l) => l.limit_key === key);

      const washroomLimit = getLimit("MAX_WASHROOMS");
      const userLimit = getLimit("MAX_USERS");
      const cleanerLimit = getLimit("MAX_CLEANERS");

      const newCleanersCount = users.filter((u) => u.role === "cleaner").length;

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
        cleanerLimit.current_value + newCleanersCount > cleanerLimit.limit_value
      ) {
        throw new Error(`LIMIT_CLEANERS:${cleanerLimit.limit_value}`);
      }

      // ==========================================
      // 🏢 STEP 1: FACILITY PROFILE (Tenant)
      // ==========================================
      const facilityName = discovery?.facility_type
        ? `${discovery.facility_type} Facility`
        : "Main Facility";

      const facility = await tx.facility_companies.create({
        data: {
          name: facilityName,
          company_id: BigInt(companyId),
          description: `Staff: ${discovery?.staff_size} | Scope: ${discovery?.operational_scope}`,
        },
      });

      // ==========================================
      // 🗺️ STEP 2: HIERARCHY (Topological Sort & ID Mapping)
      // ==========================================
      const idMap = {}; // Maps temp_id -> real_db_id
      const nodesToProcess = [...hierarchy];

      // Keep processing until array is empty (handles nested depth dynamically)
      let safetyCounter = 0;
      while (nodesToProcess.length > 0) {
        // Find a node whose parent is either null, or already processed in idMap
        const nodeIndex = nodesToProcess.findIndex(
          (n) => !n.parent_temp_id || idMap[n.parent_temp_id],
        );

        if (nodeIndex === -1 || safetyCounter > hierarchy.length * 2) {
          throw new Error("HIERARCHY_CIRCULAR_DEPENDENCY");
        }

        const node = nodesToProcess.splice(nodeIndex, 1)[0];

        const createdNode = await tx.locations.create({
          data: {
            name: node.name,
            type_id: BigInt(TYPE_MAPPING[node.type] || 3),
            parent_id: node.parent_temp_id
              ? BigInt(idMap[node.parent_temp_id])
              : null,
            company_id: BigInt(companyId),
            facility_company_id: facility.id,
            status: true,
          },
        });

        // Map the temporary frontend ID to the real database ID
        idMap[node.temp_id] = createdNode.id;
        safetyCounter++;
      }

      // ==========================================
      // 🚻 STEP 3: WASHROOMS
      // ==========================================
      for (const w of washrooms) {
        const createdWashroom = await tx.locations.create({
          data: {
            name: w.name,
            type_id: BigInt(WASHROOM_TYPE_ID),
            parent_id: w.zone_temp_id ? BigInt(idMap[w.zone_temp_id]) : null,
            company_id: BigInt(companyId),
            facility_company_id: facility.id,
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
      // 👥 STEP 4: USERS & ASSIGNMENTS
      // ==========================================
      const defaultPassword = await bcrypt.hash("Safai@123", 10);

      for (const u of users) {
        const roleId = ROLE_MAPPING[u.role] || 5;

        // Create User
        const createdUser = await tx.users.create({
          data: {
            name: u.name,
            phone: u.phone,
            role_id: roleId,
            company_id: BigInt(companyId),
            password: defaultPassword,
            created_by: BigInt(req.user.id),
          },
        });

        // Determine Assignment Location
        const targetTempId =
          u.assigned_washroom_temp_id || u.assigned_zone_temp_id;

        if (targetTempId && idMap[targetTempId]) {
          await tx.cleaner_assignments.create({
            data: {
              name: `Assignment: ${u.name}`,
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

      // ==========================================
      // 📈 STEP 5: COMMIT BULK LIMIT UPDATES
      // ==========================================
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

      return facility;
    });

    // 🚀 SUCCESS RESPONSE
    res.status(201).json({
      success: true,
      message: "Workspace generated successfully",
      data: serializeBigInt({
        facility_id: result.id,
      }),
    });
  } catch (error) {
    console.error("Workspace Deployment Error:", error);

    // Friendly Error Translations
    if (error.code === "P2002") {
      return res.status(422).json({
        success: false,
        error: "Validation failed",
        details:
          "One or more user phone numbers are already registered in the system.",
      });
    }
    if (error.message.startsWith("LIMIT_")) {
      const parts = error.message.split(":");
      return res.status(403).json({
        success: false,
        error: "Quota Exceeded",
        details: `Your plan limits you to ${parts[1]} ${parts[0].replace("LIMIT_", "").toLowerCase()}. Please upgrade your plan or reduce the scope.`,
      });
    }
    if (error.message === "HIERARCHY_CIRCULAR_DEPENDENCY") {
      return res.status(400).json({
        success: false,
        error: "Validation failed",
        details:
          "Invalid hierarchy structure. A node cannot be its own parent.",
      });
    }

    res.status(500).json({
      success: false,
      error: "Deployment failed",
      details: error.message,
    });
  }
};
