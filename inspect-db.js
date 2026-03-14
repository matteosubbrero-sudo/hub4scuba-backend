const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

async function inspect(dbPath) {
  console.log('---', dbPath, '---');
  if (!fs.existsSync(dbPath)) { console.log('MISSING:', dbPath); return; }
  process.env.DATABASE_URL = 'file:' + dbPath.replace(/\\/g, '/');
  const prisma = new PrismaClient();
  try {
    const tables = await prisma.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table';");
    console.log('Tables:', (tables || []).map(t => (t.name || t.NAME || Object.values(t)[0])).join(', '));
    const tbls = ['Host','Experience','Audit','BookingRequest','RefreshToken'];
    for (const t of tbls) {
      try {
        const r = await prisma.$queryRawUnsafe('SELECT COUNT(*) as c FROM "' + t + '";');
        const c = Array.isArray(r) && r.length ? (r[0].c ?? Object.values(r[0])[0]) : 'N/A';
        console.log(t + ': ' + c);
      } catch (e) {
        // table missing
      }
    }
  } catch (e) {
    console.error('Error inspecting', dbPath, e.message || e);
  } finally {
    await prisma.$disconnect();
  }
}

(async () => {
  const p1 = path.join(process.cwd(),'prisma','dev.db');
  const p2 = path.join(process.cwd(),'prisma','prisma','dev.db');
  await inspect(p1);
  await inspect(p2);
})().catch(e=>{ console.error(e); process.exit(1); });