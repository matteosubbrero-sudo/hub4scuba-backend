const crypto = require('crypto');
const { logAudit } = require('../utils/audit');

module.exports = function auditRequest(req, res, next) {
  req.traceId = crypto.randomUUID();
  req.audit = async (opts) => {
    try { return await logAudit(Object.assign({ req }, opts)); } catch (e) { /* swallow */ }
  };
  // non-blocking lightweight request start log
  req.audit({ action: 'request.incoming', entityType: 'Request', meta: { method: req.method, path: req.path, query: req.query } }).catch(()=>{});
  res.on('finish', () => {
    req.audit({ action: 'request.completed', entityType: 'Request', meta: { method: req.method, path: req.path, status: res.statusCode } }).catch(()=>{});
  });
  next();
};