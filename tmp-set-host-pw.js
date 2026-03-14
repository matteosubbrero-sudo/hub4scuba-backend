const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
(async () => {
  const prisma = new PrismaClient();
  try {
    const email = "host@demo.local";
    const newPwd = "Password1";
    const saltRounds = 10;
    const hash = await bcrypt.hash(newPwd, saltRounds);
    const res = await prisma.host.updateMany({
      where: { email },
      data: { password: hash }
    });
    console.log("Updated rows:", res.count);
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
