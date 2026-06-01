const crypto = require('crypto');

/** Format: STU-12345678-AB12 (8 digits + 4 hex) */
const STUDENT_ID_REGEX = /^STU-\d{8}-[A-F0-9]{4}$/;

function generateStudentId() {
  return 'STU-' + Date.now().toString().slice(-8) + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
}

function generateInstructorId() {
  return 'INS-' + Date.now().toString().slice(-8) + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
}

function normalizeStudentId(raw) {
  return (raw || '').toString().trim().toUpperCase();
}

function isValidStudentIdFormat(id) {
  return STUDENT_ID_REGEX.test(normalizeStudentId(id));
}

/**
 * @param {object} db
 * @param {string} studentId
 * @param {number|null} excludeStudentRowId - students.id to exclude (for updates)
 */
async function assertStudentIdAvailable(db, studentId, excludeStudentRowId = null) {
  let row;
  if (excludeStudentRowId != null) {
    row = await db.get(
      'SELECT id FROM students WHERE student_id = ? AND id != ?',
      [studentId, excludeStudentRowId]
    );
  } else {
    row = await db.get('SELECT id FROM students WHERE student_id = ?', [studentId]);
  }
  if (row) {
    const err = new Error('This student ID is already assigned to another student.');
    err.statusCode = 400;
    throw err;
  }
}

/**
 * @param {object} options
 * @param {object} options.db
 * @param {'auto'|'manual'} options.mode
 * @param {string} [options.manualId]
 * @param {number} [options.excludeStudentRowId]
 */
async function resolveStudentId({ db, mode, manualId, excludeStudentRowId = null }) {
  if (mode === 'manual') {
    const studentId = normalizeStudentId(manualId);
    if (!studentId) {
      const err = new Error('Student ID is required when using manual entry.');
      err.statusCode = 400;
      throw err;
    }
    if (!isValidStudentIdFormat(studentId)) {
      const err = new Error('Student ID must match format STU-XXXXXXXX-XXXX (e.g. STU-12345678-AB12).');
      err.statusCode = 400;
      throw err;
    }
    await assertStudentIdAvailable(db, studentId, excludeStudentRowId);
    return studentId;
  }

  let attempts = 0;
  while (attempts < 5) {
    const candidate = generateStudentId();
    const existing = await db.get('SELECT id FROM students WHERE student_id = ?', [candidate]);
    if (!existing) return candidate;
    attempts += 1;
  }
  const err = new Error('Could not generate a unique student ID. Please try again.');
  err.statusCode = 500;
  throw err;
}

module.exports = {
  STUDENT_ID_REGEX,
  generateStudentId,
  generateInstructorId,
  normalizeStudentId,
  isValidStudentIdFormat,
  assertStudentIdAvailable,
  resolveStudentId
};
