const { PrismaClient } = require('@prisma/client');
(async function(){
  const p = new PrismaClient();
  try {
    const a = await p.audit.findMany({ take: 20, orderBy: { createdAt: 'desc' } });
    console.log(a.map(x => x.meta));
  } catch (e) {
    console.error(e);
  } finally {
    await p.$disconnect();
  }
})();