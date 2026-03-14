const { PrismaClient } = require('@prisma/client');
(async function(){
  const prisma = new PrismaClient();
  try {
    const n = await prisma.host.count();
    console.log('hosts:', n);
  } catch (e) {
    console.error('ERR', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();