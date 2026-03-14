const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
 const res = await prisma.host.updateMany({
   where: { email: 'audit1@example.com' },
   data: { status: 'APPROVED', role: 'ADMIN' }
 });
 console.log('Updated rows:', res.count);
  } catch (e) { console.error(e); process.exit(1); } finally { await prisma.$disconnect(); }
})();