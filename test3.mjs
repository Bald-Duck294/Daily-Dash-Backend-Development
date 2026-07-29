import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const companyId = 51n; // Assuming company 51
  
  const locs = await prisma.locations.findMany({ 
    where: { company_id: companyId },
  });
  console.log('Locations for 51:', locs.map(l => ({ name: l.name, type_id: l.type_id?.toString(), parent: l.parent_id?.toString() })));
}

main().catch(console.error).finally(() => prisma.$disconnect());
