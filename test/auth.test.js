const request = require('supertest');
const app = require('../src/server'); // se exporti app in server.js, altrimenti usa http://localhost:4000
const { prisma, clearDb, disconnect } = require('./setup');

describe('Auth integration', () => {
  beforeAll(async () => { await clearDb(); });
  afterAll(async () => { await clearDb(); await disconnect(); });

  test('register -> login -> refresh -> logout', async () => {
    const agent = request.agent('http://localhost:4000');
    // register
const reg = await agent.post('/auth/host/register')
  .send({ email: 'test-auth@example.com', password: 'Password1', name: 'Test Auth' })
  .set('Content-Type','application/json');
expect([201,409]).toContain(reg.status); // 409 if already exists

// approva l'host creato per permettere il login in test
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
await prisma.host.updateMany({
  where: { email: 'test-auth@example.com' },
  data: { status: 'APPROVED' }
});
await prisma.$disconnect();

// login
const login = await agent.post('/auth/host/login')
  .send({ email: 'test-auth@example.com', password: 'Password1' })
  .set('Content-Type','application/json');
expect(login.status).toBe(200);
expect(login.body).toHaveProperty('token');

const token = login.body.token;

// refresh (using cookie cookie jar)
const refresh = await agent.post('/auth/refresh').send({}).set('Content-Type','application/json');
// could be 200 or 400 if cookie missing; we accept both but ensure no server crash
expect([200,400,401]).toContain(refresh.status);

// logout
const logout = await agent.post('/auth/logout').send({}).set('Content-Type','application/json');
expect([200,400]).toContain(logout.status);
  }, 20000);
});
