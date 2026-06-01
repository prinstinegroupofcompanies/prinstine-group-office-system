/**
 * Academy utilities — re-exports permission helpers from academyPermissions.js
 */
export {
  isAcademyStaff,
  hasAcademyPermission,
  hasAnyAcademyPermission,
  canManageAcademyPermissions,
  canViewAcademyTab,
  canManageAcademySection,
  canApproveStudents,
  canApproveInstructors,
  canApproveCourseFees,
  canEndorseGrades,
  canFinalApproveGrades,
  canApproveAcademy
} from './academyPermissions';

