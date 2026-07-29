import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const locs = await prisma.locations.findMany({ 
    orderBy: { created_at: 'desc' },
    take: 20
  });
  console.log('Recent Locations:', locs.map(l => ({ 
    id: l.id.toString(),
    name: l.name, 
    type_id: l.type_id?.toString(), 
    parent: l.parent_id?.toString(),
    company_id: l.company_id?.toString(),
    created_at: l.created_at
  })));
}

main().catch(console.error).finally(() => prisma.$disconnect());
