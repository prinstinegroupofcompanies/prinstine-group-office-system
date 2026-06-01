/** Must match server/utils/academyIds.js */
export const STUDENT_ID_REGEX = /^STU-\d{8}-[A-F0-9]{4}$/;

export const STUDENT_ID_FORMAT_HINT = 'STU-XXXXXXXX-XXXX (example: STU-12345678-AB12)';

export function normalizeStudentIdInput(raw) {
  return (raw || '').toString().trim().toUpperCase();
}

export function isValidStudentIdFormat(id) {
  return STUDENT_ID_REGEX.test(normalizeStudentIdInput(id));
}
