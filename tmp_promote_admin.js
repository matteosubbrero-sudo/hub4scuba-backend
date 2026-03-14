const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async()=>{
  const email = "host3@demo.local";
  const h = await p.host.findUnique({ where: { email } });
  if (!h) { console.log("Host not found:", email); await p.$disconnect(); process.exit(1); }
  console.log("Before:", h);
  await p.host.update({ where:{ email }, data:{ role: "ADMIN" }});
  const h2 = await p.host.findUnique({ where:{ email }});
  console.log("After:", h2);
  await p.$disconnect();
})();
