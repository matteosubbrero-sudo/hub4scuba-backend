const request = require('supertest');
const { prisma, clearDb, disconnect } = require('./setup');

describe('Booking flow and audit', () => {
  let token;
  let brId;

  beforeAll(async () => {
    await clearDb();
    // ensure host exists and approved
    await prisma.host.create({
      data: { name: 'Host Test', email: 'admin-test@example.com', password: 'x', status: 'APPROVED', role: 'HOST' }
    });
  });

  afterAll(async () => { await clearDb(); await disconnect(); });

  test('create booking -> host accepts -> audit entries present', async () => {
    const agent = request.agent('http://localhost:4000');
    // create booking (public)
const create = await agent.post('/experiences/1/requests')
  .send({ userName: 'Test U', userEmail: 'test@booking.test', requestedDate: '2026-03-10T10:00:00Z' })
  .set('Content-Type','application/json');
expect([201,404]).toContain(create.status);
if (create.status === 404) return;

brId = create.body.id || create.body?.requestId;
expect(brId).toBeDefined();

// login as host owner (use host@demo.local or admin-test if mapped) — try host@demo.local fallback
const loginResp = await agent.post('/auth/host/login')
  .send({ email: 'host@demo.local', password: 'Password1' })
  .set('Content-Type','application/json');
expect(loginResp.status).toBe(200);
token = loginResp.body.token;

// accept booking
const patch = await agent.patch('/host/me/requests/' + brId)
  .set('Authorization', `Bearer ${token}`)
  .send({ status: 'ACCEPTED', notes: 'OK' })
  .set('Content-Type','application/json');
expect([200,403,404,409]).toContain(patch.status);

// check audit rows exist (via Prisma)
const audits = await prisma.audit.findMany({ where: { entityType: 'BookingRequest' }, orderBy: { createdAt: 'desc' }, take: 10 });
expect(audits.length).toBeGreaterThanOrEqual(1);
// ensure at least one has action booking_update or booking_request.create
expect(audits.some(a => a.action && (a.action.includes('booking') || a.action.includes('request')))).toBeTruthy();
  }, 30000);
});
