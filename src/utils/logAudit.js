const crypto = require('crypto');
const prisma = require('../prismaClient');

// semplice mask ricorsivo
function maskSensitive(obj) {
  if (!obj) return null;
  const copy = JSON.parse(JSON.stringify(obj));
  const sensitive = ['password','pwd','cardnumber','cvv','token','authorization','refreshToken'];
  function walk(o) {
    if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) {
        try {
          if (sensitive.includes(k.toLowerCase())) o[k] = '[REDACTED]';
          else walk(o[k]);
        } catch (e) { /* ignore */ }
      }
    }
  }
  walk(copy);
  return copy;
}

function metaToString(meta) {
  if (meta == null) return null;
  if (typeof meta === 'string') {
    try { JSON.parse(meta); return meta; } catch (e) { return JSON.stringify({ raw: String(meta) }); }
  }
  try {
    return JSON.stringify(maskSensitive(meta));
  } catch (e) {
    return JSON.stringify({ raw: String(meta) });
  }
}

async function logAudit({ action, actorHostId = null, entityType = null, entityId = null, meta = null, req = null, status = null, service = null }) {
  try {
    const metaStr = metaToString(meta);
    const traceId = (req && req.traceId) || crypto.randomUUID();
    const ip = req ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress) : null;
    const userAgent = req ? req.get('user-agent') : null;
    await prisma.audit.create({
  data: {
    actorHostId: actorHostId || null,
    action,
    entityType: entityType || '',
    entityId: entityId != null ? String(entityId) : null,
    meta: metaStr,
    traceId: traceId || null,
    ip: ip || null,
    userAgent: userAgent || null,
    service: service || null
  }
});
    return traceId;
  } catch (e) {
    console.error('logAudit error', e);
  }
}

module.exports = { logAudit, maskSensitive, metaToString };