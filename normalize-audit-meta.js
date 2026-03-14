const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function tryParsePowerShellMeta(s) {
  if (s == null) return null;
  // if already JSON
  if (typeof s !== 'string') return s;
  s = s.trim();
  try { return JSON.parse(s); } catch (e) {}
  // PowerShell style "@{k=v; k2=v2}"
  if (s.startsWith('@{') && s.endsWith('}')) s = s.slice(2, -1);
  if (s.startsWith('{') && s.endsWith('}')) {
    try { return JSON.parse(s); } catch (e) {}
  }
  const parts = s.split(/[;,\n]/).map(p => p.trim()).filter(Boolean);
  const obj = {};
  for (const part of parts) {
    const m = part.match(/^\s*([^=:]+)\s*(?:=|:)\s*(.)\s$/);
    if (!m) continue;
    const key = m[1].trim();
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (/^(true|false)$/i.test(val)) val = /^true$/i.test(val);
    else if (!isNaN(val) && val !== '') val = Number(val);
    else {
      const dt = new Date(val);
      if (!isNaN(dt.getTime()) && /\d{4}-\d{2}-\d{2}/.test(val)) val = dt.toISOString();
    }
    obj[key] = val;
  }
  return Object.keys(obj).length ? obj : { raw: s };
}

(async () => {
  try {
    console.log('Starting normalization of Audit.meta...');
    const batchSize = 100;
    let skip = 0;
    while (true) {
      const items = await prisma.audit.findMany({ orderBy: { createdAt: 'asc' }, take: batchSize, skip });
      if (!items || items.length === 0) break;
      for (const it of items) {
        const current = it.meta;
        // if null or already valid JSON string?
        let parsed = null;
        if (current == null) continue;
        // if looks like JSON string -> keep as is
        if (typeof current === 'string') {
          try {
            parsed = JSON.parse(current);
            // already JSON object stored as string -> skip update
            continue;
          } catch (e) {
            // not JSON: try parse PS style
            const obj = tryParsePowerShellMeta(current);
            const metaStr = JSON.stringify(obj);
            await prisma.audit.update({ where: { id: it.id }, data: { meta: metaStr } });
            console.log('Updated id', it.id);
          }
        } else {
          // non-string meta? stringify masked fallback
          await prisma.audit.update({ where: { id: it.id }, data: { meta: JSON.stringify(current) } });
          console.log('Stringified id', it.id);
        }
      }
      if (items.length < batchSize) break;
      skip += batchSize;
    }
    console.log('Normalization complete.');
  } catch (e) {
    console.error('Error normalizing:', e);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
})();