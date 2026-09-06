import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const id = '37dc7c24-315e-4eb0-9d47-e2273b8469b3';
const rows = await prisma.deletedDay.findMany({ where: { itineraryId: id }, orderBy: { originalIndex: 'asc' } });
for (const r of rows) {
  const d = JSON.parse(r.day);
  console.log('originalIndex:', r.originalIndex, '| day:', d.day, '|', d.waypointCity, '|', d.theme, d.isTransitDay ? '[transit->'+d.transitTo+']' : '', '| id:', d.id);
}
console.log('total deleted rows:', rows.length);
await prisma.$disconnect();
