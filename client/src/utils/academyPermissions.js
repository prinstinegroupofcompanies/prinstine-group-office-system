/**
 * Client-side academy permission helpers (mirrors server/utils/academyPermissions.js).
 */

export const ACADEMY_TABS = {
  courses: 'courses:view',
  students: 'students:view',
  instructors: 'instructors:view',
  cohorts: 'cohorts:view',
  grades: 'grades:view',
  'student-grades': 'grades:view',
  certificates: 'certificates:view',
  permissions: 'permissions:manage'
};

export function getUserAcademyPermissions(user) {
  if (!user) return [];
  if (Array.isArray(user.academyPermissions) && user.academyPermissions.length > 0) {
    return user.academyPermissions;
  }
  if (user.role === 'Admin') return Object.values(ACADEMY_TABS);
  return [];
}

export function hasAcademyPermission(user, key) {
  if (!user || !key) return false;
  if (user.role === 'Admin') return true;
  if (user.isAcademyDepartmentHead === true && key !== 'grades:final_approve') return true;
  return getUserAcademyPermissions(user).includes(key);
}

export function hasAnyAcademyPermission(user) {
  if (!user) return false;
  if (user.role === 'Admin') return true;
  if (user.isAcademyDepartmentHead === true) return true;
  if (user.role === 'Instructor') return true;
  if (user.isAcademyStaff === true && getUserAcademyPermissions(user).length > 0) return true;
  return getUserAcademyPermissions(user).length > 0;
}

export function canManageAcademyPermissions(user) {
  return hasAcademyPermission(user, 'permissions:manage') || user?.isAcademyDepartmentHead === true;
}

export function canViewAcademyTab(user, tabKey) {
  const perm = ACADEMY_TABS[tabKey];
  if (!perm) return false;
  return hasAcademyPermission(user, perm);
}

export function canManageAcademySection(user, section) {
  if (!user || !section) return false;
  if (user.role === 'Admin') return true;
  if (user.isAcademyDepartmentHead === true) return true;
  const map = {
    courses: 'courses:manage',
    students: 'students:manage',
    instructors: 'instructors:manage',
    cohorts: 'cohorts:manage',
    grades: 'grades:manage',
    certificates: 'certificates:manage'
  };
  return hasAcademyPermission(user, map[section]);
}

export function canApproveStudents(user) {
  return hasAcademyPermission(user, 'approve:students');
}

export function canApproveInstructors(user) {
  return hasAcademyPermission(user, 'approve:instructors');
}

export function canApproveCourseFees(user) {
  return hasAcademyPermission(user, 'approve:course_fees');
}

export function canEndorseGrades(user) {
  return hasAcademyPermission(user, 'grades:endorse');
}

export function canFinalApproveGrades(user) {
  return hasAcademyPermission(user, 'grades:final_approve');
}

/** @deprecated use canFinalApproveGrades for grade final approval */
export function canApproveAcademy(user) {
  return canFinalApproveGrades(user);
}

export function isAcademyStaff(user) {
  if (!user) return false;
  if (user.role === 'Admin' || user.role === 'Instructor') return true;
  return hasAnyAcademyPermission(user);
}
