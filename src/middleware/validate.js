const { ZodError } = require('zod');

module.exports = function validate(schema) {
  return (req, res, next) => {
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      // parseResult.error may exist; normalize safely
      const zodErr = parseResult.error;
      const formatted = (zodErr && Array.isArray(zodErr.errors))
        ? zodErr.errors.map(e => ({
            path: Array.isArray(e.path) ? e.path.join('.') : String(e.path),
            message: e.message
          }))
        : [{ path: '', message: 'Invalid request' }];
          return res.status(400).json({ error: 'Validation error', details: formatted });
}
// valid: replace body with parsed data and continue
req.body = parseResult.data;
next();
  };
};