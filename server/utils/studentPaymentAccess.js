const db = require('../config/database');

/** Finance + Academy team emails with explicit student payment access */
const STUDENT_PAYMENT_EMAIL_ALLOWLIST = [
  'sean@prinstinegroup.org',
  'cvulu@prinstinegroup.org',
  'cvulue@prinstinegroup.org',
  'marjorie@prinstinegroup.org',
  'samsonbryant89@gmail.com'
];

function normalizeEmail(email) {
  return ((email ?? '') + '').toLowerCase().trim();
}

function departmentGrantsStudentPayment(deptName) {
  const n = (deptName || '').toLowerCase();
  return (
    n.includes('finance') ||
    n.includes('academy') ||
    n.includes('elearning') ||
    n.includes('e-learning')
  );
}

function staffRecordGrantsStudentPayment(staff) {
  if (!staff) return false;
  const deptName = (staff.department || '').toLowerCase();
  const positionName = (staff.position || '').toLowerCase();
  if (departmentGrantsStudentPayment(deptName)) return true;
  return positionName.includes('academy') && positionName.includes('coordinator');
}

/**
 * Same access as Finance for processing student payments (Admin, Finance staff/head, Academy team).
 */
async function hasStudentPaymentAccess(user) {
  if (!user) return false;

  const email = normalizeEmail(user.email);
  if (user.role === 'Admin') return true;
  if (STUDENT_PAYMENT_EMAIL_ALLOWLIST.includes(email)) return true;

  if (user.role === 'DepartmentHead') {
    const dept = await db.get(
      'SELECT name FROM departments WHERE manager_id = ? OR LOWER(TRIM(head_email)) = ?',
      [user.id, email]
    );
    return !!(dept && departmentGrantsStudentPayment(dept.name));
  }

  if (user.role === 'Staff') {
    const staff = await db.get('SELECT department, position FROM staff WHERE user_id = ?', [user.id]);
    return staffRecordGrantsStudentPayment(staff);
  }

  return false;
}

/**
 * User IDs to notify for pending student payments / invoices (Finance + Academy team).
 */
async function getStudentPaymentAccessUserIds() {
  const ids = new Set();

  const admins = await db.all('SELECT id FROM users WHERE role = ? AND is_active = 1', ['Admin']);
  admins.forEach((r) => ids.add(r.id));

  for (const allowEmail of STUDENT_PAYMENT_EMAIL_ALLOWLIST) {
    const row = await db.get(
      'SELECT id FROM users WHERE LOWER(TRIM(email)) = ? AND is_active = 1',
      [allowEmail]
    );
    if (row) ids.add(row.id);
  }

  const deptHeads = await db.all(
    `SELECT u.id FROM users u
     JOIN departments d ON d.manager_id = u.id OR LOWER(TRIM(d.head_email)) = LOWER(TRIM(u.email))
     WHERE u.role = 'DepartmentHead' AND u.is_active = 1
       AND (
         LOWER(d.name) LIKE '%finance%'
         OR LOWER(d.name) LIKE '%academy%'
         OR LOWER(d.name) LIKE '%elearning%'
         OR LOWER(d.name) LIKE '%e-learning%'
       )`
  );
  deptHeads.forEach((r) => ids.add(r.id));

  const staffUsers = await db.all(
    `SELECT u.id FROM users u
     INNER JOIN staff s ON s.user_id = u.id
     WHERE u.role = 'Staff' AND u.is_active = 1
       AND (
         LOWER(COALESCE(s.department, '')) LIKE '%finance%'
         OR LOWER(COALESCE(s.department, '')) LIKE '%academy%'
         OR LOWER(COALESCE(s.department, '')) LIKE '%elearning%'
         OR LOWER(COALESCE(s.department, '')) LIKE '%e-learning%'
         OR (
           LOWER(COALESCE(s.position, '')) LIKE '%academy%'
           AND LOWER(COALESCE(s.position, '')) LIKE '%coordinator%'
         )
       )`
  );
  staffUsers.forEach((r) => ids.add(r.id));

  return [...ids];
}

module.exports = {
  STUDENT_PAYMENT_EMAIL_ALLOWLIST,
  hasStudentPaymentAccess,
  getStudentPaymentAccessUserIds
};
