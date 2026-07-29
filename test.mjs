import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const types = await prisma.location_types.findMany();
  console.log('Location Types:', types.map(t => ({ id: t.id.toString(), name: t.name, is_toilet: t.is_toilet, company: t.company_id?.toString() })));
  
  const locs = await prisma.locations.findMany({ include: { location_types: true } });
  console.log('Locations:', locs.map(l => ({ name: l.name, type: l.location_types?.name, is_toilet: l.location_types?.is_toilet })));
}

main().catch(console.error).finally(() => prisma.$disconnect());
