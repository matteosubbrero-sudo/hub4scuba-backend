const { PrismaClient } = require('@prisma/client');
(async function(){
  const p = new PrismaClient();
  try {
    const b = await p.bookingRequest.findUnique({ where: { id: 12 }, include: { experience: { include: { host: true } } } });
    console.log(JSON.stringify(b, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    await p.$disconnect();
  }
})();
