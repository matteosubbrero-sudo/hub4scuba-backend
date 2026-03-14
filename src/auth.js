const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
require('dotenv').config();
 const { logAudit } = require('./utils/audit');


const SALT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_EXPIRES_DAYS = parseInt(process.env.REFRESH_EXPIRES_DAYS || '30', 10);

function makeRefreshToken() {
  return crypto.randomBytes(48).toString('hex');
}
async function pruneRefreshTokens(hostId, maxTokens = 5) {
  // elimina i token piÃ¹ vecchi lasciando al massimo maxTokens attivi (non revoked)
  const tokensToDelete = await prisma.refreshToken.findMany({
    where: { hostId, revoked: false },
    orderBy: { createdAt: 'desc' },
    skip: maxTokens
  });
  if (tokensToDelete.length) {
    const ids = tokensToDelete.map(t => t.id);
    await prisma.refreshToken.deleteMany({ where: { id: { in: ids } } });
  }
}

async function createRefreshToken(hostId, req = null) {
  const token = makeRefreshToken();
  const expiresAt = new Date(Date.now() + (REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000));
  const rt = await prisma.refreshToken.create({
    data: { token, hostId, expiresAt }
  });
  // prune older tokens keeping last 5
 await pruneRefreshTokens(hostId, 5);
  try {
    if (req && req.audit) await req.audit({ action: 'refresh.create', actorHostId: hostId, entityType: 'RefreshToken', entityId: rt.id, meta: { expiresAt: expiresAt.toISOString() } });
    else await logAudit(Object.assign({ req }, { action: 'refresh.create', actorHostId: hostId, entityType: 'RefreshToken', entityId: rt.id, meta: { expiresAt: expiresAt.toISOString() } }));
  } catch (e) { /* ignore */ }
  return rt.token;
}

async function revokeRefreshToken(token, req = null) {
  await prisma.refreshToken.updateMany({ where: { token }, data: { revoked: true } });
  try {
    if (req && req.audit) await req.audit({ action: 'refresh.revoke', actorHostId: null, entityType: 'RefreshToken', entityId: null, meta: { token: '[REDACTED]' } });
    else await logAudit(Object.assign({ req }, { action: 'refresh.revoke', actorHostId: null, entityType: 'RefreshToken', entityId: null, meta: { token: '[REDACTED]' } }));
  } catch (e) {}
}

async function consumeRefreshToken(token, req = null) {
  if (!token) return null;
  const existing = await prisma.refreshToken.findUnique({ where: { token } });
  if (!existing || existing.revoked) {
    try { if (req && req.audit) await req.audit({ action: 'refresh.consume.failure', actorHostId: null, entityType: 'RefreshToken', entityId: existing ? existing.id : null, meta: { token: '[REDACTED]' } }); else await logAudit(Object.assign({ req }, { action: 'refresh.consume.failure', actorHostId: null, entityType: 'RefreshToken', entityId: existing ? existing.id : null, meta: { token: '[REDACTED]' } })); } catch (e) {}
    return null;
  }
  if (existing.expiresAt && existing.expiresAt < new Date()) {
    try { if (req && req.audit) await req.audit({ action: 'refresh.consume.expired', actorHostId: null, entityType: 'RefreshToken', entityId: existing.id, meta: { expiresAt: existing.expiresAt } }); else await logAudit(Object.assign({ req }, { action: 'refresh.consume.expired', actorHostId: null, entityType: 'RefreshToken', entityId: existing.id, meta: { expiresAt: existing.expiresAt } })); } catch (e) {}
    return null;
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.refreshToken.updateMany({
      where: { token, revoked: false },
      data: { revoked: true }
    });
    const loaded = await tx.refreshToken.findUnique({ where: { token }, include: { host: true } });
    return loaded;
  });

  try {
    if (req && req.audit) await req.audit({ action: 'refresh.consume', actorHostId: result && result.host ? result.host.id : null, entityType: 'RefreshToken', entityId: result ? result.id : null, meta: { consumedAt: new Date().toISOString() } });
    else await logAudit(Object.assign({ req }, { action: 'refresh.consume', actorHostId: result && result.host ? result.host.id : null, entityType: 'RefreshToken', entityId: result ? result.id : null, meta: { consumedAt: new Date().toISOString() } }));
  } catch (e) {}

  return result;
}

async function registerHost({ name, email, password, phone, website, locationName, region, country }, req = null) {
  if (!name || !email || !password) { const err = new Error('Missing required fields'); err.code = 400; throw err; }
  const exists = await prisma.host.findUnique({ where: { email } });
  if (exists) { const err = new Error('Host with this email already exists'); err.code = 409; throw err; }
  const hashed = await bcrypt.hash(password, SALT_ROUNDS);
  const host = await prisma.host.create({
    data: { name, email, password: hashed, phone, website, locationName, region, country, status: 'PENDING' }
  });
  try {
    if (req && req.audit) await req.audit({ action: 'auth.register', actorHostId: host.id, entityType: 'Host', entityId: host.id, meta: { email } });
    else await logAudit(Object.assign({ req }, { action: 'auth.register', actorHostId: host.id, entityType: 'Host', entityId: host.id, meta: { email } }));
  } catch (e) {}
  return { id: host.id, email: host.email, name: host.name, status: host.status };
}

async function loginHost({ email, password }, req = null) {
  if (!email || !password) { const err = new Error('Missing email or password'); err.code = 400; throw err; }
  const host = await prisma.host.findUnique({ where: { email } });
  if (!host) {
    try { if (req && req.audit) await req.audit({ action: 'auth.login.failure', actorHostId: null, entityType: 'Host', entityId: null, meta: { identifier: email } }); else await logAudit(Object.assign({ req }, { action: 'auth.login.failure', actorHostId: null, entityType: 'Host', entityId: null, meta: { identifier: email } })); } catch (e) {}
    const err = new Error('Invalid credentials'); err.code = 401; throw err;
  }
  const ok = await bcrypt.compare(password, host.password);
  if (!ok) {
    try { if (req && req.audit) await req.audit({ action: 'auth.login.failure', actorHostId: host.id, entityType: 'Host', entityId: host.id, meta: { identifier: email } }); else await logAudit(Object.assign({ req }, { action: 'auth.login.failure', actorHostId: host.id, entityType: 'Host', entityId: host.id, meta: { identifier: email } })); } catch (e) {}
    const err = new Error('Invalid credentials'); err.code = 401; throw err;
  }
  if (host.status !== 'APPROVED') {
    try { if (req && req.audit) await req.audit({ action: 'auth.login.blocked', actorHostId: host.id, entityType: 'Host', entityId: host.id, meta: { status: host.status } }); else await logAudit(Object.assign({ req }, { action: 'auth.login.blocked', actorHostId: host.id, entityType: 'Host', entityId: host.id, meta: { status: host.status } })); } catch (e) {}
    const err = new Error('Host not approved'); err.code = 403; throw err;
  }

  const token = jwt.sign({ sub: host.id, role: host.role || 'HOST' }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  const refreshToken = await createRefreshToken(host.id, req);
  try {
    if (req && req.audit) await req.audit({ action: 'auth.login.success', actorHostId: host.id, entityType: 'Host', entityId: host.id, meta: { email } });
    else await logAudit(Object.assign({ req }, { action: 'auth.login.success', actorHostId: host.id, entityType: 'Host', entityId: host.id, meta: { email } }));
  } catch (e) {}
  return { token, refreshToken, host: { id: host.id, name: host.name, email: host.email, role: host.role || 'HOST' } };
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer (.+)$/);
  if (!m) return res.status(401).json({ error: 'Missing token' });
  const token = m[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.auth = payload;
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

async function loadHost(req, res, next) {
  const hostId = req.auth?.sub;
  if (!hostId) return res.status(401).json({ error: 'Unauthorized' });
  const host = await prisma.host.findUnique({ where: { id: hostId } });
  if (!host) return res.status(401).json({ error: 'Host not found' });
  req.currentHost = host;
  next();
}

module.exports = { registerHost, loginHost, authMiddleware, loadHost, createRefreshToken, revokeRefreshToken, consumeRefreshToken, pruneRefreshTokens };

