const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async()=>{
  const h = await p.host.findUnique({ where:{ email:"host3@demo.local" }});
  console.log(h);
  await p.$disconnect();
})();
