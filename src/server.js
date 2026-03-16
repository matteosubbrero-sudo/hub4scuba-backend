const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const Handlebars = require('handlebars');
const rateLimit = require('express-rate-limit');
const Redis = require('ioredis');
const validate = require('./middleware/validate');
const { loginSchema, registerSchema } = require('./validators/auth');
const { bookingSchema } = require('./validators/booking');
const { createExperienceSchema, updateExperienceSchema } = require('./validators/experience');
const path = require('path');
const auditRequest = require('./middleware/auditRequest');

const {
  registerHost,
  loginHost,
  authMiddleware,
  loadHost,
  createRefreshToken,
  revokeRefreshToken,
  consumeRefreshToken,
  pruneRefreshTokens
} = require('./auth');

const prisma = new PrismaClient();
const app = express();

// Redis client
const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

// CORS and middlewares
const corsOptions = {
  origin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());
app.use(auditRequest);
app.use('/admin/static', express.static(path.join(__dirname, '../public/admin')));


// Rate limiter for login (Redis-backed if available, otherwise in-memory)
let RedisStore = null;
try {
  RedisStore = require('rate-limit-redis');
} catch (err) {
  RedisStore = null;
  console.warn('rate-limit-redis not available, falling back to in-memory rate limiter.');
}

let limiterStore = null;
if (RedisStore) {
  try {
    limiterStore = new RedisStore({ client: redis });
  } catch (e1) {
    try {
      limiterStore = new RedisStore({ sendCommand: (...args) => redis.call(...args) });
    } catch (e2) {
      limiterStore = null;
      console.warn('RedisStore could not be created, falling back to in-memory rate limiter.');
    }
  }
}

const loginLimiter = rateLimit({
  store: limiterStore || undefined, // undefined means express-rate-limit uses in-memory store
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' }
});
// Nodemailer (Ethereal) setup
let transporter;
async function initMailer() {
  try {
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    });
    console.log('Nodemailer initialized (Ethereal).');
  } catch (e) {
    console.error('Mailer init error', e);
  }
}
if (process.env.NODE_ENV !== 'test' && process.env.DISABLE_EMAILS !== '1') {
  initMailer().catch(err => console.error('Mailer init error', err));
}
//initMailer().catch(err => console.error('Mailer init error', err));

// Load Handlebars template
let bookingTemplate;
async function loadTemplates() {
  try {
    const tpl = await fs.readFile('./templates/email-booking.html', 'utf8');
    bookingTemplate = Handlebars.compile(tpl);
    console.log('Email template loaded.');
  } catch (e) {
    console.error('Error loading templates:', e);
  }
}
loadTemplates();

// Simple in-memory rate limit map (for other small uses)
const rateLimitMap = new Map();
function rateLimitCheck(key, limit = 5, windowMs = 60_000) {
  const now = Date.now();
  const entry = rateLimitMap.get(key) || { count: 0, start: now };
  if (now - entry.start > windowMs) {
    entry.count = 0;
    entry.start = now;
  }
  entry.count++;
  rateLimitMap.set(key, entry);
  return entry.count <= limit;
}

// GET /experiences - paginazione semplice
app.get('/experiences', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 10);
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
  prisma.experience.findMany({
    skip,
    take: limit,
    include: { host: true },
    orderBy: { createdAt: 'desc' }
  }),
  prisma.experience.count()
]);

const mapped = items.map(function(i) {
  return {
    id: i.id,
    title: i.title,
    loc: i.locationName,
    time: String(Math.round((i.durationMinutes / 60) * 10) / 10) + 'h',
    price: i.priceBase,
    type: i.type,
    level: i.level,
    img: '',
    rating: i.rating || 0,
    host_name: i.host ? i.host.name : ''
  };
});

res.json({ items: mapped, total: total, page: page, limit: limit });
 } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /experiences/:id
app.get('/experiences/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    const item = await prisma.experience.findUnique({
  where: { id: id },
  include: { host: true, requests: true }
});
if (!item) return res.status(404).json({ error: 'Not found' });

res.json({
  id: item.id,
  title: item.title,
  description: item.description,
  loc: item.locationName,
  price: item.priceBase,
  durationMinutes: item.durationMinutes,
  type: item.type,
  level: item.level,
  host_name: item.host ? item.host.name : '',
  requestsCount: item.requests ? item.requests.length : 0,
  createdAt: item.createdAt
});
} catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Host auth - register
app.post('/auth/host/register', validate(registerSchema), async (req, res) => {
  try {
   const host = await registerHost(req.body || {}, req);
    return res.status(201).json(host);
  } catch (e) {
    console.error(e);
    const status = e.code && [400, 409, 401, 403].includes(e.code) ? e.code : 400;
    return res.status(status).json({ error: e.message });
  }
});

// POST /auth/host/login with loginLimiter and account lock logic
app.post('/auth/host/login', loginLimiter, validate(loginSchema), async (req, res) => {
  const email = (req.body && req.body.email || '').toLowerCase();
  const failKey = 'fails:email:' + email;
  const lockKey = 'lock:email:' + email;
  const FAIL_THRESHOLD = parseInt(process.env.FAIL_THRESHOLD || '5', 10);
  const LOCK_TTL = parseInt(process.env.LOCK_TTL_SECONDS || '3600', 10); // default 1h

  try {
    // check account lock
    const locked = await redis.get(lockKey);
    if (locked) {
      return res.status(423).json({ error: 'Account temporarily locked due to failed login attempts. Try again later.' });
    }

// attempt login
try {
  const result = await loginHost(req.body || {}, req); // { token, refreshToken, host }

  // on successful login: reset failure counter and remove lock
  await redis.del(failKey);
  await redis.del(lockKey);

  // after successful login, reset counters done above
  if (req.audit) req.audit({
    action: 'auth.login.success',
    actorHostId: result.host && result.host.id ? result.host.id : null,
    entityType: 'Host',
    entityId: result.host && result.host.id ? result.host.id : null,
    meta: { email: result.host && result.host.email ? result.host.email : email },
    status: 200
  });

  // set refresh cookie
  const refreshCookieExpiresMs = (parseInt(process.env.REFRESH_EXPIRES_DAYS || '30', 10)) * 24 * 60 * 60 * 1000;
  res.cookie('refreshToken', result.refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: refreshCookieExpiresMs,
    path: '/'
  });

  return res.json({ token: result.token, host: result.host });

} catch (loginErr) {
  // increment fail counter in Redis
  const fails = await redis.incr(failKey);
  if (fails === 1) {
    await redis.expire(failKey, LOCK_TTL);
  }
  if (fails >= FAIL_THRESHOLD) {
    await redis.set(lockKey, '1', 'EX', LOCK_TTL);
  }
  const status = loginErr.code && [400, 401, 403].includes(loginErr.code) ? loginErr.code : 401;
  return res.status(status).json({ error: loginErr.message || 'Invalid credentials' });
}
} catch (e) {
    console.error('Login handler error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /auth/refresh - rotation
app.post('/auth/refresh', async (req, res) => {
  try {
    const rtToken = (req.body && req.body.refreshToken) || (req.cookies ? req.cookies.refreshToken : undefined);
    if (!rtToken) return res.status(400).json({ error: 'Missing refreshToken' });
    const rtRecord = await consumeRefreshToken(rtToken, req); // atomically revokes used token
if (!rtRecord) return res.status(401).json({ error: 'Invalid refresh token' });

const host = rtRecord.host;
const newAccessToken = jwt.sign({ sub: host.id, role: 'HOST' }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: process.env.JWT_EXPIRES_IN || '15m' });

// rotate refresh token
const newRefreshToken = await createRefreshToken(host.id, req);
const refreshCookieExpiresMs = (parseInt(process.env.REFRESH_EXPIRES_DAYS || '30', 10)) * 24 * 60 * 60 * 1000;

res.cookie('refreshToken', newRefreshToken, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: refreshCookieExpiresMs,
  path: '/'
});

return res.json({ token: newAccessToken });
 } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /auth/logout
app.post('/auth/logout', async (req, res) => {
  try {
    const rtToken = (req.body && req.body.refreshToken) || (req.cookies ? req.cookies.refreshToken : undefined);
    if (!rtToken) return res.status(400).json({ error: 'Missing refreshToken' });
    await revokeRefreshToken(rtToken, req);
res.clearCookie('refreshToken', { path: '/' });

return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// protected route: get host profile
app.get('/host/me', authMiddleware, loadHost, (req, res) => {
  try {
    const host = req.currentHost;
    const data = Object.assign({}, host);
    delete data.password;
    res.json(data);
  } catch (err) {
    console.error('ERROR in /host/me handler:', err);
    res.status(500).json({ error: 'handler error' });
  }
});

// host requests list (paginated)
app.get('/host/me/requests', authMiddleware, loadHost, async (req, res) => {
  try {
    const hostId = req.currentHost.id;
    const requests = await prisma.bookingRequest.findMany({
      where: { experience: { hostId: hostId } },
      include: { experience: true },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    res.json({ items: requests });
  } catch (err) {
    console.error('ERROR in /host/me/requests handler:', err);
    res.status(500).json({ error: 'handler error' });
  }
});

// PATCH /host/me/requests/:id — accept / reject (ownership + transaction + audit)
app.patch('/host/me/requests/:id', authMiddleware, loadHost, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid request id' });
    const { status, notes } = req.body || {};
if (!status || !['ACCEPTED', 'REJECTED'].includes(String(status).toUpperCase())) {
  return res.status(400).json({ error: 'status is required and must be ACCEPTED or REJECTED' });
}
const newStatus = String(status).toUpperCase();
const traceId = req && req.traceId ? req.traceId : require('crypto').randomUUID();
const ip = req ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress) : null;
const userAgent = req ? req.get('user-agent') : null;

// transaction: check ownership, prevent invalid transition, update and create audit
const result = await prisma.$transaction(async (tx) => {
  const br = await tx.bookingRequest.findUnique({
    where: { id },
    include: {
      experience: {
        include: {
          host: true
        }
      }
    }
  });
  if (!br) throw { code: 404, message: 'BookingRequest not found' };

  const hostId = req.currentHost.id;
  if (br.experience.hostId !== hostId) throw { code: 403, message: 'Forbidden' };

  if (br.status !== 'PENDING') throw { code: 409, message: 'Request already processed' };

  const u = await tx.bookingRequest.update({
    where: { id },
    data: { status: newStatus, notes: notes || br.notes || null }
  });

  // optional: create audit record if you have Audit model
  try {
    await tx.audit.create({
      data: {
        actorHostId: hostId,
        action: 'booking_update',
        entityType: 'BookingRequest',
        entityId: id,
        meta: JSON.stringify({ prev: br.status, next: newStatus }),
        traceId: traceId,
        ip: ip,
        userAgent: userAgent,
        service: process.env.SERVICE_NAME || null
      }
    });
  } catch (e) {
    // ignore if Audit model not present
  }

  const prevStatus = br.status;
  return { u, prevStatus };
});

// audit non-blocking con trace (aggiungi subito dopo la transaction)
const updated = result.u;
const prevStatus = result.prevStatus;

if (req && req.audit) {
  try {
    req.audit({
      action: 'booking_update',
      actorHostId: req.currentHost ? req.currentHost.id : null,
      entityType: 'BookingRequest',
      entityId: id,
      meta: { prev: prevStatus, next: newStatus },
      status: 200
    });
  } catch (e) { /* swallow */ }
}
// send notification email (reuse existing template/transport)
try {
  const brFull = await prisma.bookingRequest.findUnique({ where: { id }, include: { experience: { include: { host: true } } } });
  const tplData = {
    experienceTitle: brFull.experience.title,
    experienceId: brFull.experience.id,
    userName: brFull.userName,
    userEmail: brFull.userEmail,
    requestId: brFull.id,
    requestStatus: updated.status,
    requestedDate: brFull.requestedDate ? brFull.requestedDate.toISOString() : ''
  };
  const htmlBody = bookingTemplate ? bookingTemplate(tplData) : '<p>Status: ' + tplData.requestStatus + '</p>';
  if (transporter) {
    const info = await transporter.sendMail({
      from: '"Hub4Scuba" <no-reply@hub4scuba.test>',
      to: tplData.userEmail,
      subject: 'Stato richiesta: ' + tplData.requestStatus + ' — ' + tplData.experienceTitle,
      html: htmlBody
    });
    console.log('Request notif email sent. Preview:', require('nodemailer').getTestMessageUrl(info));
  }
} catch (mailErr) {
  console.error('Email send error (non blocking):', mailErr);
}

return res.json(updated);
  } catch (e) {
    console.error('Error in PATCH /host/me/requests/:id', e);
    if (e && e.code && [400,403,404,409].includes(e.code)) {
      return res.status(e.code).json({ error: e.message || 'Error' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
});
//ultimo inserimento
function parseMetaSmart(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (e) {}
  try {
    let s = String(raw).trim();
    if (s.startsWith('@{') && s.endsWith('}')) s = s.slice(2, -1);
    if (s.startsWith('{') && s.endsWith('}')) s = s.slice(1, -1);
    const obj = {};
    const parts = s.split(/[;,\n]/).map(p => p.trim()).filter(Boolean);
    for (const part of parts) {
      const m = part.match(/^\s*([^=:]+)\s*(?:=|:)\s*(.)\s$/);
      if (!m) continue;
      const key = m[1].trim();
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (/^(true|false)$/i.test(val)) {
        val = /^true$/i.test(val);
      } else if (!isNaN(val) && val !== '') {
        val = Number(val);
      } else {
        const dt = new Date(val);
        if (!isNaN(dt.getTime()) && /\d{4}-\d{2}-\d{2}/.test(val)) val = dt.toISOString();
      }
      obj[key] = val;
    }
    return Object.keys(obj).length ? obj : raw;
  } catch (e) {
    return raw;
  }
}
// ADMIN: list audits (protected)
// Usage: GET /admin/audits?limit=50&skip=0&actorHostId=3&entityType=BookingRequest
const parseIntSafe = (v) => { const n = parseInt(v, 10); return Number.isNaN(n) ? undefined : n; };

app.get('/admin/audits', authMiddleware, async (req, res) => {
  try {
    // only ADMIN allowed
    if (req.auth?.role !== 'ADMIN') return res.status(403).json({ error: 'Forbidden' });
// query params
const limit = Math.min(parseIntSafe(req.query.limit) || 50, 500);
const skip = Math.max(parseIntSafe(req.query.skip) || 0, 0);
const actorHostId = parseIntSafe(req.query.actorHostId);
const entityType = req.query.entityType ? String(req.query.entityType) : undefined;
const action = req.query.action ? String(req.query.action) : undefined;
const q = req.query.q ? String(req.query.q).trim() : undefined;
const from = req.query.from ? new Date(String(req.query.from)) : undefined;
const to = req.query.to ? new Date(String(req.query.to)) : undefined;

// build where clause
const where = {};
if (actorHostId != null) where.actorHostId = actorHostId;
if (entityType) where.entityType = entityType;
if (action) where.action = action;
if (from || to) where.createdAt = {};
if (from && !isNaN(from)) where.createdAt.gte = from;
if (to && !isNaN(to)) where.createdAt.lte = to;

// text search in meta (SQLite: use LIKE)
if (q) {
  where.AND = [
    ...(where.AND || []),
    { meta: { contains: q } }
  ];
}

const [items, total] = await Promise.all([
  prisma.audit.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip
  }),
  prisma.audit.count({ where })
]);

// parse meta string to JSON where possible ultimo aggiornameto
const parsed = items.map(i => {
  let metaRaw = i.meta;
  let metaParsed = null;
  try {
    metaParsed = parseMetaSmart(metaRaw);
  } catch (e) {
    metaParsed = metaRaw;
  }
  return Object.assign({}, i, { meta: metaParsed });
});
res.json({ items: parsed, total, limit, skip });
 } catch (e) {
    console.error('GET /admin/audits error', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /experiences/:id/requests
app.post('/experiences/:id/requests', validate(bookingSchema), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid experience id' });
    const body = req.body || {};
    const userName = body.userName;
    const userEmail = body.userEmail;
    const requestedDate = body.requestedDate;
    const requestedSlot = body.requestedSlot;
    const notes = body.notes;
    const participants = body.participants;
    // Basic validation
if (!userName || !userEmail || !requestedDate) {
  return res.status(400).json({ error: 'userName, userEmail and requestedDate are required' });
}
if (!/^\S+@\S+\.\S+$/.test(userEmail)) {
  return res.status(400).json({ error: 'Invalid email format' });
}
const date = new Date(requestedDate);
if (isNaN(date.getTime())) return res.status(400).json({ error: 'Invalid requestedDate' });

// Rate limit by IP (in-memory fallback)
const ip = req.ip || (req.connection ? req.connection.remoteAddress : 'unknown');
if (!rateLimitCheck(ip)) {
  return res.status(429).json({ error: 'Too many requests, slow down' });
}

// Check experience exists
const experience = await prisma.experience.findUnique({ where: { id: id }, include: { host: true } });
if (!experience) return res.status(404).json({ error: 'Experience not found' });

// Create booking request
const br = await prisma.bookingRequest.create({
  data: {
    experienceId: id,
    userName: userName,
    userEmail: userEmail,
    requestedDate: date,
    requestedSlot: requestedSlot || null,
    notes: notes || null,
    status: 'PENDING'
  }
});
 // audit: new booking request created
if (req.audit) req.audit({
    action: 'booking_request.create',
    actorHostId: null,
    entityType: 'BookingRequest',
    entityId: br.id,
    meta: { experienceId: id, userEmail: userEmail, userName: userName },
    status: 201
  });

// Prepare template data
const tplData = {
  experienceTitle: experience.title,
  experienceId: experience.id,
  locationName: experience.locationName,
  hostName: experience.host ? experience.host.name : '',
  experienceType: experience.type,
  experienceLevel: experience.level,
  price: 'â‚¬' + String(experience.priceBase),
  duration: String(Math.round((experience.durationMinutes || 0) / 60 * 10) / 10) + 'h',
  userName: userName,
  userEmail: userEmail,
  requestedDate: date.toISOString(),
  requestedSlot: requestedSlot || 'n/a',
  participants: participants || '',
  notes: notes || '',
  hostEmail: experience.host ? experience.host.email : '',
  hostPhone: experience.host ? experience.host.phone : '',
  hostWebsite: experience.host ? experience.host.website : '',
  hostLocation: experience.host ? experience.host.locationName : '',
  hostPanelUrl: process.env.HOST_PANEL_URL || 'http://localhost:3000/host',
  experienceUrl: (process.env.EXPERIENCE_URL_BASE ? (process.env.EXPERIENCE_URL_BASE + '/experiences/' + String(experience.id)) : ('http://localhost:3000/experiences/' + String(experience.id))),
  requestId: br.id,
  requestStatus: br.status,
  createdAt: br.createdAt ? br.createdAt.toISOString() : new Date().toISOString()
};

// Render HTML with Handlebars
var htmlBody;
if (bookingTemplate) {
  htmlBody = bookingTemplate(tplData);
} else {
  htmlBody = '<p>Nuova richiesta per ' + tplData.experienceTitle + ' (id:' + String(tplData.experienceId) + ')</p><p>Da: ' + tplData.userName + ' &lt;' + tplData.userEmail + '&gt;</p>';
}

// Send emails DA RIPRISTINARE DOPO I TEST
try {
  if (!transporter) {
    console.warn('Transporter not ready, skipping email');
  } else {
    const hostEmail = tplData.hostEmail || 'no-reply@example.com';
    const info = await transporter.sendMail({
      from: '"Hub4Scuba Demo" <no-reply@hub4scuba.test>',
      to: hostEmail,
      subject: 'Nuova richiesta prenotazione: ' + tplData.experienceTitle,
      html: htmlBody
    });

    // optional: copy to requester
    await transporter.sendMail({
      from: '"Hub4Scuba Demo" <no-reply@hub4scuba.test>',
      to: userEmail,
      subject: 'Conferma richiesta â€” ' + tplData.experienceTitle,
      html: htmlBody
    });

    console.log('Emails sent. MessageId:', info.messageId);
    console.log('Preview URL:', require('nodemailer').getTestMessageUrl(info));
  }
} catch (e) {
  console.error('Error sending emails:', e);
}

return res.status(201).json({ id: br.id, status: br.status, message: 'Request submitted' });
 } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// HOST â€” CRUD esperienze (protette)
app.post('/host/me/experiences', authMiddleware, loadHost, validate(createExperienceSchema), async (req, res) => {
  try {
    const hostId = req.currentHost.id;
    const body = req.body || {};
    const title = body.title;
    const description = body.description;
    const locationName = body.locationName;
    const priceBase = body.priceBase;
    const durationMinutes = body.durationMinutes;
    const type = body.type;
    const level = body.level;
    const profile = body.profile;
    const entryType = body.entryType;
    const environment = body.environment;
    const minDepthM = body.minDepthM;
    const maxDepthM = body.maxDepthM;
    if (!title || !locationName) return res.status(400).json({ error: 'title and locationName required' });

const exp = await prisma.experience.create({
  data: {
    title: title,
    description: description,
    locationName: locationName,
    priceBase: priceBase || 0,
    durationMinutes: durationMinutes || 120,
    type: type || 'RECREATIONAL',
    level: level || 'BEGINNER',
    profile: profile || '',
    entryType: entryType || '',
    environment: environment || '',
    minDepthM: minDepthM || null,
    maxDepthM: maxDepthM || null,
    hostId: hostId
  }
});
res.status(201).json(exp);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/host/me/experiences', authMiddleware, loadHost, async (req, res) => {
  try {
    const hostId = req.currentHost.id;
    const items = await prisma.experience.findMany({ where: { hostId: hostId }, orderBy: { createdAt: 'desc' } });
    res.json({ items: items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/host/me/experiences/:id', authMiddleware, loadHost, validate(updateExperienceSchema), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const hostId = req.currentHost.id;
    const exp = await prisma.experience.findUnique({ where: { id: id } });
    if (!exp) return res.status(404).json({ error: 'Experience not found' });
    if (exp.hostId !== hostId) return res.status(403).json({ error: 'Forbidden' });
    const updated = await prisma.experience.update({ where: { id: id }, data: req.body });
res.json(updated);
} catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/host/me/experiences/:id', authMiddleware, loadHost, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const hostId = req.currentHost.id;
    const exp = await prisma.experience.findUnique({ where: { id: id } });
    if (!exp) return res.status(404).json({ error: 'Experience not found' });
    if (exp.hostId !== hostId) return res.status(403).json({ error: 'Forbidden' });
    await prisma.experience.delete({ where: { id: id } });
res.status(204).end();
 } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const port = process.env.PORT || 4000;
if (process.env.NODE_ENV !== 'test') { app.listen(port, function() { console.log('Server listening on http://localhost:' + port); }); }
//app.listen(port, function() { console.log('Server listening on http://localhost:' + port); });  riga commentata per i test
