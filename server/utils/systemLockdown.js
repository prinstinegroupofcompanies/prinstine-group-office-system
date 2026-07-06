/**
 * System-wide access lockdown.
 *
 * Locked by default on every deployment (including fresh repo clones).
 * Reopen ONLY by setting SYSTEM_ACCESS_ENABLED=true in production env
 * (Render/Vercel dashboard — primary developer access required).
 */

const PRIMARY_DEVELOPER_NAME =
  process.env.SYSTEM_PRIMARY_DEVELOPER_NAME || 'Samson Bryant';
const PRIMARY_DEVELOPER_EMAIL =
  process.env.SYSTEM_PRIMARY_DEVELOPER_EMAIL || 'samsonbryant89@gmail.com';

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
    title: 'System Temporarily Offline',
    message:
      'The Prinstine Management System is temporarily closed. All logins are disabled for administrators, department heads, staff, students, and instructors.',
    developer: {
      name: PRIMARY_DEVELOPER_NAME,
      email: PRIMARY_DEVELOPER_EMAIL,
      role: 'Primary System Developer'
    },
    reopen:
      'Access can only be restored by the primary developer. If you deployed this codebase, do not enable logins without authorization — contact the developer below.',
    contact_instruction: `Contact ${PRIMARY_DEVELOPER_NAME} at ${PRIMARY_DEVELOPER_EMAIL} to request system reopening.`
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
    console.log(`  Primary developer: ${PRIMARY_DEVELOPER_NAME} <${PRIMARY_DEVELOPER_EMAIL}>`);
    console.log('  Reopen: set SYSTEM_ACCESS_ENABLED=true in server environment only.');
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
