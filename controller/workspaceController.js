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

    if (!companyId) {
      return res.status(400).json({
        success: false,
        code: "MISSING_COMPANY",
        message: "Company ID is required for deployment.",
      });
    }

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
        // 🏗️ STEP 2: DYNAMIC LOCATION TYPES
        // ==========================================
        const uniqueTypes = new Set(hierarchy.map((n) => n.type.toLowerCase()));
        uniqueTypes.add("washroom");

        const existingTypes = await tx.location_types.findMany({
          where: { company_id: BigInt(companyId) },
        });

        const typeMap = {};

        for (const typeName of uniqueTypes) {
          const existing = existingTypes.find(
            (t) => t.name.toLowerCase() === typeName,
          );
          if (existing) {
            typeMap[typeName] = existing.id;
          } else {
            const isToilet = typeName === "washroom";
            const newType = await tx.location_types.create({
              data: {
                name: typeName.charAt(0).toUpperCase() + typeName.slice(1),
                company_id: BigInt(companyId),
                is_toilet: isToilet,
              },
            });
            typeMap[typeName] = newType.id;
          }
        }

        // ==========================================
        // 🗺️ STEP 3: HIERARCHY (Topological Sort)
        // ==========================================
        const idMap = {};
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
          const resolvedTypeId = typeMap[node.type.toLowerCase()];

          const createdNode = await tx.locations.create({
            data: {
              name: node.name,
              type_id: resolvedTypeId,
              parent_id: node.parent_temp_id
                ? BigInt(idMap[node.parent_temp_id])
                : null,
              company_id: BigInt(companyId),
              status: true,
            },
          });

          idMap[node.temp_id] = createdNode.id;
          safetyCounter++;
        }

        // ==========================================
        // 🚻 STEP 4: WASHROOMS
        // ==========================================
        const washroomTypeId = typeMap["washroom"];

        for (const w of washrooms) {
          const createdWashroom = await tx.locations.create({
            data: {
              name: w.name,
              type_id: washroomTypeId,
              // Assigns to ANY node (zone, floor, building), not just zones!
              parent_id: w.zone_temp_id ? BigInt(idMap[w.zone_temp_id]) : null,
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

          const targetTempId =
            u.assigned_washroom_temp_id || u.assigned_zone_temp_id;

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
      return res.status(422).json({
        success: false,
        code: "PHONE_ALREADY_EXISTS",
        step: "users",
        message: "One or more user phone numbers are already registered.",
      });
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
