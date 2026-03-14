const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const items = await p.audit.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
  console.log(JSON.stringify(items, null, 2));
  await p.$disconnect();
})();
