const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function maskSensitive(obj) {
  if (!obj) return null;
  const copy = JSON.parse(JSON.stringify(obj));
  const sensitive = ['password','pwd','cardnumber','cvv','token','authorization','refreshToken'];
  function walk(o){
    if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) {
        if (sensitive.includes(k.toLowerCase())) o[k] = '[REDACTED]';
        else walk(o[k]);
      }
    }
  }
  walk(copy);
  return copy;
}

// ensure meta is serialized as JSON string (or null)
function metaToString(meta) {
  if (meta == null) return null;
  // if already string, try to parse — if it's JSON keep as-is, otherwise attempt to convert PS-style to object then stringify
  if (typeof meta === 'string') {
    try { JSON.parse(meta); return meta; } catch (e) { /* not JSON string */ }
    // fallback: leave as string but wrap safely
    return JSON.stringify({ raw: String(meta) });
  }
  // meta is object -> mask sensitive and stringify
  try {
    const masked = maskSensitive(meta);
    return JSON.stringify(masked);
  } catch (e) {
    return JSON.stringify({ raw: String(meta) });
  }
}

async function logAudit({ action, actorHostId = null, entityType = '', entityId = null, meta = null }) {
  try {
    const metaStr = metaToString(meta);
    await prisma.audit.create({
      data: {
        actorHostId: actorHostId || null,
        action,
        entityType,
        entityId: entityId != null ? Number(entityId) : null,
        meta: metaStr
      }
    });
  } catch (e) {
    console.error('audit.log error', e);
  }
}

module.exports = { logAudit, maskSensitive, metaToString };