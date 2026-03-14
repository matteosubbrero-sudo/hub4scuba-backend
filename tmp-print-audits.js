const { PrismaClient } = require('@prisma/client');
(async function(){
  const p = new PrismaClient();
  try {
    const a = await p.audit.findMany({ orderBy: { createdAt: 'desc' }, take: 10 });
    console.log(a.map(x => ({ id: x.id, action: x.action, traceId: x.traceId, meta: x.meta })));
  } catch (e) {
    console.error(e);
  } finally {
    await p.$disconnect();
  }
})();