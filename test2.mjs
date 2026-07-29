import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const companyId = 51n; // Assuming company 51
  
  const types = await prisma.location_types.findMany({ where: { company_id: companyId } });
  console.log('Location Types for 51:', types.map(t => ({ id: t.id.toString(), name: t.name, is_toilet: t.is_toilet })));
  
  const locs = await prisma.locations.findMany({ 
    where: { company_id: companyId },
    include: { location_types: true } 
  });
  console.log('Locations for 51:', locs.map(l => ({ name: l.name, type: l.location_types?.name, is_toilet: l.location_types?.is_toilet, parent: l.parent_id?.toString() })));
}

main().catch(console.error).finally(() => prisma.$disconnect());
