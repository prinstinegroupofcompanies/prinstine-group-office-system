/**
 * System-wide access lockdown.
 *
 * Locked by default on every deployment (including fresh repo clones).
 * Reopen by setting SYSTEM_ACCESS_ENABLED=true in production env (Render).
 */

const LOCKDOWN_CODE = 'SYSTEM_LOCKDOWN';

function isSystemAccessEnabled() {
  return String(process.env.SYSTEM_ACCESS_ENABLED || '')
    .trim()
    .toLowerCase() === 'true';
}

function isSystemLocked() {
  return !isSystemAccessEnabled();
}

function getLockdownPayload() {
  const locked = isSystemLocked();
  return {
    locked,
    enabled: !locked,
    code: locked ? LOCKDOWN_CODE : null,
    title: 'System Currently Unavailable',
    message:
      'The Prinstine Management System is currently down due to server issues affecting the backend and frontend. Please try again later.',
    detail:
      'All logins are temporarily disabled. We are working to restore service as soon as possible.'
  };
}

function lockdownErrorResponse(res, statusCode = 503) {
  const payload = getLockdownPayload();
  return res.status(statusCode).json({
    error: payload.message,
    code: LOCKDOWN_CODE,
    lockdown: payload
  });
}

/** @returns {boolean} true if request may proceed */
function assertSystemAccessEnabled(res) {
  if (!isSystemLocked()) return true;
  lockdownErrorResponse(res);
  return false;
}

/** API paths that remain available while locked (health + public certificate verify). */
const LOCKDOWN_ALLOW_PATHS = [
  /^\/api\/health\/?$/,
  /^\/api\/system\/status\/?$/,
  /^\/api\/certificates\/verify\/?$/,
  /^\/api\/certificates\/public\/[^/]+\/download\/[^/]+\/?$/,
  /^\/api\/academy\/certificates\/verify\/[^/]+\/?$/
];

function isLockdownExemptPath(path) {
  const p = (path || '').split('?')[0];
  return LOCKDOWN_ALLOW_PATHS.some((re) => re.test(p));
}

function logLockdownStateOnStartup() {
  if (isSystemLocked()) {
    console.log('');
    console.log('══════════════════════════════════════════════════════════');
    console.log('  SYSTEM ACCESS: LOCKED (all logins disabled)');
    console.log('  Reopen: set SYSTEM_ACCESS_ENABLED=true in server environment.');
    console.log('══════════════════════════════════════════════════════════');
    console.log('');
  } else {
    console.log('[system] Access ENABLED (SYSTEM_ACCESS_ENABLED=true)');
  }
}

module.exports = {
  LOCKDOWN_CODE,
  isSystemAccessEnabled,
  isSystemLocked,
  getLockdownPayload,
  lockdownErrorResponse,
  assertSystemAccessEnabled,
  isLockdownExemptPath,
  logLockdownStateOnStartup
};
