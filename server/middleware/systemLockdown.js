const {
  isSystemLocked,
  isLockdownExemptPath,
  lockdownErrorResponse
} = require('../utils/systemLockdown');

/**
 * Block all /api traffic when system is locked, except public exempt routes.
 */
function systemLockdownMiddleware(req, res, next) {
  if (!isSystemLocked()) return next();
  if (isLockdownExemptPath(req.originalUrl || req.path)) return next();
  return lockdownErrorResponse(res);
}

module.exports = { systemLockdownMiddleware };
