/**
 * Academy granular permissions for staff, department heads, and admins.
 */
const db = require('../config/database');

const PERMISSION_DEFINITIONS = [
  { key: 'courses:view', label: 'View courses', group: 'Courses' },
  { key: 'courses:manage', label: 'Add & edit courses', group: 'Courses' },
  { key: 'students:view', label: 'View students', group: 'Students' },
  { key: 'students:manage', label: 'Add & edit students', group: 'Students' },
  { key: 'instructors:view', label: 'View instructors', group: 'Instructors' },
  { key: 'instructors:manage', label: 'Add & edit instructors', group: 'Instructors' },
  { key: 'cohorts:view', label: 'View cohorts', group: 'Cohorts' },
  { key: 'cohorts:manage', label: 'Add & edit cohorts', group: 'Cohorts' },
  { key: 'grades:view', label: 'View grades & queue', group: 'Grades' },
  { key: 'grades:manage', label: 'Submit & edit grades', group: 'Grades' },
  { key: 'grades:endorse', label: 'Endorse grades (dept review)', group: 'Grades' },
  { key: 'grades:final_approve', label: 'Final approve grades (takes effect)', group: 'Grades', adminOnly: true },
  { key: 'certificates:view', label: 'View certificates', group: 'Certificates' },
  { key: 'certificates:manage', label: 'Manage certificates', group: 'Certificates' },
  { key: 'approve:students', label: 'Approve / reject students', group: 'Approvals' },
  { key: 'approve:instructors', label: 'Approve / reject instructors', group: 'Approvals' },
  { key: 'approve:course_fees', label: 'Approve / reject course fees', group: 'Approvals' },
  { key: 'permissions:manage', label: 'Assign academy permissions to staff', group: 'Administration' }
];

const ALL_PERMISSION_KEYS = PERMISSION_DEFINITIONS.map((p) => p.key);
const DEPT_HEAD_PERMISSION_KEYS = ALL_PERMISSION_KEYS.filter((k) => k !== 'grades:final_approve');
const ASSIGNABLE_TO_STAFF_KEYS = ALL_PERMISSION_KEYS.filter((k) => k !== 'grades:final_approve' && k !== 'permissions:manage');

const ACADEMY_COORDINATOR_EMAILS = [
  'samsonbryant89@gmail.com',
  'cvulu@prinstinegroup.org',
  'cvulue@prinstinegroup.org',
  'marjorie@prinstinegroup.org'
];
const ACADEMY_HEAD_EMAILS = ['fwallace@prinstinegroup.org'];

/** Department names that qualify as Academy (Marketing is separate — not included). */
const ACADEMY_DEPARTMENT_PATTERN = /academy|elearning|e-learning/i;

function normalizeEmail(email) {
  return (email || '').toLowerCase().trim();
}

async function getManagedAcademyDepartments(user) {
  if (!user || user.role !== 'DepartmentHead') return [];
  const userEmail = normalizeEmail(user.email);
  if (ACADEMY_HEAD_EMAILS.includes(userEmail)) {
    return [{ name: 'Academy' }];
  }
  try {
    const deptTableInfo = await db.all("PRAGMA table_info(departments)").catch(() => []);
    const cols = (deptTableInfo || []).map((c) => c.name);
    const hasHeadEmail = cols.includes('head_email');
    const rows = hasHeadEmail
      ? await db.all(
          'SELECT name FROM departments WHERE manager_id = ? OR LOWER(TRIM(head_email)) = ?',
          [user.id, userEmail]
        )
      : await db.all('SELECT name FROM departments WHERE manager_id = ?', [user.id]);
    const academyMatch = ACADEMY_DEPARTMENT_PATTERN;
    return (rows || []).filter((d) => d?.name && academyMatch.test(d.name));
  } catch (_e) {
    return [];
  }
}

async function isAcademyDepartmentHead(user) {
  if (!user) return false;
  if (user.role === 'Admin') return false;
  if (user.role !== 'DepartmentHead') return false;
  if (ACADEMY_HEAD_EMAILS.includes(normalizeEmail(user.email))) return true;
  const depts = await getManagedAcademyDepartments(user);
  return depts.length > 0;
}

async function getStaffRecord(user) {
  if (!user?.id) return null;
  try {
    return await db.get('SELECT department, position FROM staff WHERE user_id = ?', [user.id]);
  } catch (_e) {
    return null;
  }
}

async function isLegacyAcademyStaffByDept(user) {
  if (!user) return false;
  const email = normalizeEmail(user.email);
  if (ACADEMY_COORDINATOR_EMAILS.includes(email) || ACADEMY_HEAD_EMAILS.includes(email)) {
    return true;
  }
  if (user.role === 'Instructor') return true;
  if (await isAcademyDepartmentHead(user)) return true;
  if (user.role === 'Staff') {
    const staff = await getStaffRecord(user);
    if (!staff) return false;
    const dept = (staff.department || '').toLowerCase();
    const pos = (staff.position || '').toLowerCase();
    if (dept.includes('academy') || dept.includes('elearning') || dept.includes('e-learning')) return true;
    if (pos.includes('academy') && pos.includes('coordinator')) return true;
  }
  return false;
}

async function getStoredPermissionsForUser(userId) {
  try {
    const rows = await db.all(
      'SELECT permission_key FROM staff_academy_permissions WHERE user_id = ?',
      [userId]
    );
    return (rows || []).map((r) => r.permission_key).filter(Boolean);
  } catch (_e) {
    return [];
  }
}

async function resolveAcademyPermissions(user) {
  if (!user) return [];
  if (user.role === 'Admin') return [...ALL_PERMISSION_KEYS];
  if (await isAcademyDepartmentHead(user)) return [...DEPT_HEAD_PERMISSION_KEYS];
  if (user.role === 'Instructor') {
    return ['courses:view', 'grades:view', 'grades:manage'];
  }
  if (user.role === 'Staff' || user.role === 'DepartmentHead') {
    return getStoredPermissionsForUser(user.id);
  }
  return [];
}

async function hasAcademyPermission(user, permissionKey) {
  if (!user || !permissionKey) return false;
  const perms = user.academyPermissions || (await resolveAcademyPermissions(user));
  return perms.includes(permissionKey);
}

async function hasAnyAcademyPermission(user) {
  const perms = user.academyPermissions || (await resolveAcademyPermissions(user));
  return perms.length > 0;
}

async function canManageAcademyPermissions(user) {
  if (!user) return false;
  if (user.role === 'Admin') return true;
  return hasAcademyPermission(user, 'permissions:manage') || (await isAcademyDepartmentHead(user));
}

async function attachAcademyContext(user) {
  if (!user) return user;
  const isAcademyDeptHead = await isAcademyDepartmentHead(user);
  const academyPermissions = await resolveAcademyPermissions(user);
  const isAcademyStaff =
    user.role === 'Admin' ||
    isAcademyDeptHead ||
    academyPermissions.length > 0 ||
    user.role === 'Instructor';
  return {
    ...user,
    isAcademyDepartmentHead: isAcademyDeptHead,
    academyPermissions,
    isAcademyStaff
  };
}

async function assertAcademyPermission(user, permissionKey) {
  const ok = await hasAcademyPermission(user, permissionKey);
  if (!ok) {
    const err = new Error('Insufficient permissions for this academy action');
    err.statusCode = 403;
    throw err;
  }
}

const MANAGE_RESOURCE_KEYS = {
  students: 'students:manage',
  courses: 'courses:manage',
  instructors: 'instructors:manage',
  cohorts: 'cohorts:manage',
  grades: 'grades:manage',
  certificates: 'certificates:manage'
};

/** Admin, academy department head, or explicit *:manage permission */
async function canAcademyManageResource(user, resource) {
  if (!user || !resource) return false;
  if (user.role === 'Admin') return true;
  if (await isAcademyDepartmentHead(user)) return true;
  const permKey = MANAGE_RESOURCE_KEYS[resource];
  if (!permKey) return false;
  return hasAcademyPermission(user, permKey);
}

function requireAcademyManage(resource) {
  return async (req, res, next) => {
    try {
      if (!(await canAcademyManageResource(req.user, resource))) {
        return res.status(403).json({
          error: `You do not have permission to manage academy ${resource}`
        });
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

async function listAcademyStaffForPermissions() {
  const rows = await db.all(
    `SELECT u.id AS user_id, u.name, u.email, u.role, u.is_active,
            s.staff_id, s.department, s.position
     FROM users u
     LEFT JOIN staff s ON s.user_id = u.id
     WHERE u.role IN ('Staff', 'DepartmentHead')
     ORDER BY u.role ASC, u.name ASC`
  );
  const result = [];
  for (const row of rows || []) {
    let department = row.department || null;
    if (row.role === 'DepartmentHead' && !department) {
      try {
        const depts = await db.all('SELECT name FROM departments WHERE manager_id = ?', [row.user_id]);
        if (depts?.length) department = depts.map((d) => d.name).join(', ');
      } catch (_e) {
        /* ignore */
      }
    }
    const permissions = await getStoredPermissionsForUser(row.user_id);
    result.push({
      ...row,
      department: department || (row.role === 'DepartmentHead' ? 'Department Head' : '—'),
      permissions
    });
  }
  return result;
}

async function setStaffAcademyPermissions(targetUserId, permissionKeys, grantedByUserId) {
  const target = await db.get('SELECT id, role FROM users WHERE id = ?', [targetUserId]);
  if (!target || !['Staff', 'DepartmentHead'].includes(target.role)) {
    const err = new Error('Permissions can only be assigned to Staff or Department Head users');
    err.statusCode = 400;
    throw err;
  }

  const allowed = new Set(ASSIGNABLE_TO_STAFF_KEYS);
  const cleaned = [...new Set((permissionKeys || []).filter((k) => allowed.has(k)))];
  await db.run('DELETE FROM staff_academy_permissions WHERE user_id = ?', [targetUserId]);
  for (const key of cleaned) {
    await db.run(
      `INSERT INTO staff_academy_permissions (user_id, permission_key, granted_by, created_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      [targetUserId, key, grantedByUserId]
    );
  }
  return cleaned;
}

module.exports = {
  PERMISSION_DEFINITIONS,
  ALL_PERMISSION_KEYS,
  DEPT_HEAD_PERMISSION_KEYS,
  ASSIGNABLE_TO_STAFF_KEYS,
  ACADEMY_DEPARTMENT_PATTERN,
  ACADEMY_HEAD_EMAILS,
  isAcademyDepartmentHead,
  getStoredPermissionsForUser,
  resolveAcademyPermissions,
  hasAcademyPermission,
  hasAnyAcademyPermission,
  canManageAcademyPermissions,
  attachAcademyContext,
  assertAcademyPermission,
  listAcademyStaffForPermissions,
  setStaffAcademyPermissions,
  isLegacyAcademyStaffByDept,
  MANAGE_RESOURCE_KEYS,
  canAcademyManageResource,
  requireAcademyManage
};
