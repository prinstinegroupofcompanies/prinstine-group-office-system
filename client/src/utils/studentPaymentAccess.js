import api from '../config/api';

export const STUDENT_PAYMENT_EMAIL_ALLOWLIST = [
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
 * Whether the user can access Student Payments (mirrors server hasStudentPaymentAccess).
 */
export async function checkStudentPaymentAccess(user) {
  if (!user) return false;

  const email = normalizeEmail(user.email);
  const role = (user.role ?? '').toString();

  if (role === 'Admin') return true;
  if (STUDENT_PAYMENT_EMAIL_ALLOWLIST.includes(email)) return true;

  if (role === 'DepartmentHead') {
    try {
      const res = await api.get('/departments');
      const dept = (res.data.departments || []).find(
        (d) =>
          (d.manager_id === user.id || normalizeEmail(d.head_email) === email) &&
          departmentGrantsStudentPayment(d.name)
      );
      return !!dept;
    } catch {
      const dept = (user.department || '').toLowerCase();
      return departmentGrantsStudentPayment(dept);
    }
  }

  if (role === 'Staff') {
    if (STUDENT_PAYMENT_EMAIL_ALLOWLIST.includes(email)) return true;
    try {
      const res = await api.get('/staff');
      const me = (res.data.staff || []).find((s) => s.user_id === user.id);
      return staffRecordGrantsStudentPayment(me);
    } catch {
      return staffRecordGrantsStudentPayment({
        department: user.department,
        position: user.position
      });
    }
  }

  return false;
}
