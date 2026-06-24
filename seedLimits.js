import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding System Limits with Test Data...");

  const defaultLimits = [
    { limit_key: "MAX_WASHROOMS", limit_value: 100, current_value: 45 },
    { limit_key: "MAX_USERS", limit_value: 500, current_value: 120 },
    { limit_key: "MAX_CLEANERS", limit_value: 50, current_value: 22 },
    { limit_key: "MAX_SUPERVISORS", limit_value: 10, current_value: 4 },
  ];

  for (const limit of defaultLimits) {
    // Upsert ensures that if we run the script twice, it doesn't create duplicate rows
    await prisma.systemLimits
      .upsert({
        where: {
          company_id_limit_key: {
            company_id: 0, // Using 0 or bypassing if your schema allows null. If null, Prisma requires a specific workaround or you just use findFirst.
            // Assuming your schema unique constraint handles null properly, or just use create/update manually.
          },
        },
        // Safe generic upsert logic without relying on composite null keys
        create: {
          limit_key: limit.limit_key,
          limit_value: limit.limit_value,
          current_value: limit.current_value,
          is_enabled: true,
        },
        update: {
          limit_value: limit.limit_value,
          current_value: limit.current_value,
        },
      })
      .catch(async (e) => {
        // Fallback if upsert fails due to composite key with nulls
        const existing = await prisma.systemLimits.findFirst({
          where: { limit_key: limit.limit_key, company_id: null },
        });
        if (existing) {
          await prisma.systemLimits.update({
            where: { id: existing.id },
            data: {
              limit_value: limit.limit_value,
              current_value: limit.current_value,
            },
          });
        } else {
          await prisma.systemLimits.create({
            data: { ...limit, is_enabled: true },
          });
        }
      });
  }

  console.log("✅ Seeding Complete! Test data is now in your database.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
