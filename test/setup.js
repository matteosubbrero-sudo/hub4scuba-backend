const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

module.exports = {
  prisma,
  async clearDb() {
    // pulizia minimal: rimuove host di test e booking requests creati da test
    await prisma.bookingRequest.deleteMany({ where: { userEmail: { contains: 'test@' } } }).catch(()=>{});
    await prisma.refreshToken.deleteMany({}).catch(()=>{});
    await prisma.host.deleteMany({ where: { email: { in: ['test-auth@example.com','admin-test@example.com'] } } }).catch(()=>{});
  },
  async disconnect() {
    await prisma.$disconnect();
  }
};