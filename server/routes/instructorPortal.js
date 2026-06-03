const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticateToken, requireRole } = require('../utils/auth');
const { logAction } = require('../utils/audit');
const { sendNotificationToUser, sendNotificationToRole } = require('../utils/notifications');
const {
  getInstructorByUserId,
  instructorOwnsCourse,
  getInstructorCourses,
  getStudentsForCourse,
  getStudentsForInstructor,
  notifyEnrolledStudents,
  isInstructorApproved
} = require('../utils/instructorHelpers');
const { parseGradeSubmissionInput, GRADE_SELECT_COLUMNS } = require('../utils/gradeTemplate');

async function requireInstructor(req, res, next) {
  if (req.user.role !== 'Instructor') {
    return res.status(403).json({ error: 'Instructor access only' });
  }
  const instructor = await getInstructorByUserId(req.user.id);
  if (!instructor) {
    return res.status(404).json({ error: 'Instructor record not found' });
  }
  req.instructor = instructor;
  next();
}

async function requireApprovedInstructor(req, res, next) {
  if (!isInstructorApproved(req.instructor)) {
    return res.status(403).json({
      error: 'Your instructor account is pending approval. You can view your profile but cannot perform this action yet.'
    });
  }
  next();
}

async function requireCourseAccess(req, res, next) {
  const courseId = parseInt(req.params.courseId, 10);
  if (Number.isNaN(courseId)) {
    return res.status(400).json({ error: 'Invalid course id' });
  }
  const owns = await instructorOwnsCourse(req.instructor, courseId);
  if (!owns) {
    return res.status(403).json({ error: 'You are not assigned to this course' });
  }
  req.courseId = courseId;
  next();
}

// GET /instructors/me — profile + stats
router.get('/me', authenticateToken, requireRole('Instructor'), requireInstructor, async (req, res) => {
  try {
    const courses = await getInstructorCourses(req.instructor);
    const students = await getStudentsForInstructor(req.instructor);
    const gradeStats = await db.get(
      `SELECT
         SUM(CASE WHEN g.status = 'Pending' THEN 1 ELSE 0 END) as pending,
         SUM(CASE WHEN g.status = 'Approved' THEN 1 ELSE 0 END) as approved,
         SUM(CASE WHEN g.status = 'Rejected' THEN 1 ELSE 0 END) as rejected
       FROM grade_submissions g
       WHERE g.submitted_by = ?`,
      [req.user.id]
    );
    res.json({
      instructor: {
        id: req.instructor.id,
        instructor_id: req.instructor.instructor_id,
        name: req.instructor.name,
        email: req.instructor.email,
        phone: req.instructor.phone,
        profile_image: req.instructor.profile_image,
        specialization: req.instructor.specialization,
        approved: req.instructor.approved,
        is_active: req.instructor.is_active
      },
      stats: {
        coursesCount: courses.length,
        studentsCount: new Set(students.map((s) => s.id)).size,
        pendingGrades: gradeStats?.pending || 0,
        approvedGrades: gradeStats?.approved || 0,
        rejectedGrades: gradeStats?.rejected || 0
      }
    });
  } catch (e) {
    console.error('Instructor me error:', e);
    res.status(500).json({ error: 'Failed to load instructor profile' });
  }
});

router.get('/me/courses', authenticateToken, requireRole('Instructor'), requireInstructor, async (req, res) => {
  try {
    const courses = await getInstructorCourses(req.instructor);
    res.json({ courses });
  } catch (e) {
    console.error('Instructor courses error:', e);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

router.get('/me/students', authenticateToken, requireRole('Instructor'), requireInstructor, async (req, res) => {
  try {
    const students = await getStudentsForInstructor(req.instructor);
    res.json({ students });
  } catch (e) {
    console.error('Instructor students error:', e);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

router.get('/me/grade-submissions', authenticateToken, requireRole('Instructor'), requireInstructor, async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT g.id, g.student_id, g.course_id, g.proposed_grade, g.status, g.created_at,
              g.endorsed_by, g.endorsed_at, g.approved_by, g.approved_at, g.notes,
              ${GRADE_SELECT_COLUMNS},
              s.student_id as student_code, u.name as student_name,
              c.course_code, c.title as course_title,
              endr.name as endorsed_by_name,
              appr.name as approved_by_name
       FROM grade_submissions g
       JOIN students s ON g.student_id = s.id
       JOIN users u ON s.user_id = u.id
       JOIN courses c ON g.course_id = c.id
       LEFT JOIN users endr ON g.endorsed_by = endr.id
       LEFT JOIN users appr ON g.approved_by = appr.id
       WHERE g.submitted_by = ?
       ORDER BY g.created_at DESC`,
      [req.user.id]
    );
    res.json({ submissions: rows });
  } catch (e) {
    console.error('Instructor grade submissions error:', e);
    res.status(500).json({ error: 'Failed to fetch grade submissions' });
  }
});

// Class links
router.get('/me/class-links', authenticateToken, requireRole('Instructor'), requireInstructor, async (req, res) => {
  try {
    const courseIds = (await getInstructorCourses(req.instructor)).map((c) => c.id);
    if (courseIds.length === 0) return res.json({ links: [] });
    const placeholders = courseIds.map(() => '?').join(',');
    const links = await db.all(
      `SELECT l.*, c.course_code, c.title as course_title
       FROM course_class_links l
       JOIN courses c ON l.course_id = c.id
       WHERE l.course_id IN (${placeholders})
       ORDER BY l.created_at DESC`,
      courseIds
    );
    res.json({ links });
  } catch (e) {
    console.error('Instructor class links list error:', e);
    res.status(500).json({ error: 'Failed to fetch class links' });
  }
});

router.post(
  '/me/courses/:courseId/class-links',
  authenticateToken,
  requireRole('Instructor'),
  requireInstructor,
  requireApprovedInstructor,
  requireCourseAccess,
  [
    body('link_url').trim().notEmpty().withMessage('Class link URL is required'),
    body('title').optional().trim(),
    body('platform').optional().trim()
  ],
  async (req, res) => {
    try {
      const errs = validationResult(req);
      if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
      const { link_url, title, platform } = req.body;
      const run = await db.run(
        `INSERT INTO course_class_links (course_id, title, link_url, platform, instructor_id, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          req.courseId,
          title || 'Online class',
          link_url,
          platform || 'Other',
          req.instructor.id,
          req.user.id
        ]
      );
      const course = await db.get('SELECT course_code, title FROM courses WHERE id = ?', [req.courseId]);
      await logAction(req.user.id, 'create_class_link', 'academy', run.lastID, { course_id: req.courseId }, req);
      await notifyEnrolledStudents(req.courseId, {
        title: 'New online class link',
        message: `A class link was posted for ${course?.course_code || 'your course'} — ${course?.title || ''}.`,
        type: 'info',
        link: '/student/class-links',
        senderId: req.user.id
      });
      res.status(201).json({ message: 'Class link added', id: run.lastID });
    } catch (e) {
      console.error('Create class link error:', e);
      res.status(500).json({ error: 'Failed to add class link' });
    }
  }
);

router.delete(
  '/me/class-links/:id',
  authenticateToken,
  requireRole('Instructor'),
  requireInstructor,
  requireApprovedInstructor,
  async (req, res) => {
    try {
      const link = await db.get('SELECT * FROM course_class_links WHERE id = ?', [req.params.id]);
      if (!link) return res.status(404).json({ error: 'Class link not found' });
      const owns = await instructorOwnsCourse(req.instructor, link.course_id);
      if (!owns) return res.status(403).json({ error: 'Access denied' });
      await db.run('DELETE FROM course_class_links WHERE id = ?', [req.params.id]);
      res.json({ message: 'Class link removed' });
    } catch (e) {
      console.error('Delete class link error:', e);
      res.status(500).json({ error: 'Failed to delete class link' });
    }
  }
);

// Assignments / materials
router.get('/me/assignments', authenticateToken, requireRole('Instructor'), requireInstructor, async (req, res) => {
  try {
    const courseIds = (await getInstructorCourses(req.instructor)).map((c) => c.id);
    if (courseIds.length === 0) return res.json({ assignments: [] });
    const placeholders = courseIds.map(() => '?').join(',');
    const assignments = await db.all(
      `SELECT a.*, c.course_code, c.title as course_title
       FROM course_assignments a
       JOIN courses c ON a.course_id = c.id
       WHERE a.course_id IN (${placeholders})
       ORDER BY a.created_at DESC`,
      courseIds
    );
    res.json({ assignments });
  } catch (e) {
    console.error('Instructor assignments list error:', e);
    res.status(500).json({ error: 'Failed to fetch assignments' });
  }
});

router.post(
  '/me/courses/:courseId/assignments',
  authenticateToken,
  requireRole('Instructor'),
  requireInstructor,
  requireApprovedInstructor,
  requireCourseAccess,
  [
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('description').optional().trim(),
    body('due_date').optional(),
    body('link_url').optional().trim()
  ],
  async (req, res) => {
    try {
      const errs = validationResult(req);
      if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
      const { title, description, due_date, link_url } = req.body;
      const run = await db.run(
        `INSERT INTO course_assignments (course_id, title, description, due_date, link_url, instructor_id, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [req.courseId, title, description || null, due_date || null, link_url || null, req.instructor.id, req.user.id]
      );
      const course = await db.get('SELECT course_code, title FROM courses WHERE id = ?', [req.courseId]);
      await logAction(req.user.id, 'create_assignment', 'academy', run.lastID, { course_id: req.courseId }, req);
      await notifyEnrolledStudents(req.courseId, {
        title: 'New course material / assignment',
        message: `"${title}" was posted for ${course?.course_code || 'your course'}.`,
        type: 'info',
        link: '/student/materials',
        senderId: req.user.id
      });
      res.status(201).json({ message: 'Assignment posted', id: run.lastID });
    } catch (e) {
      console.error('Create assignment error:', e);
      res.status(500).json({ error: 'Failed to post assignment' });
    }
  }
);

router.delete(
  '/me/assignments/:id',
  authenticateToken,
  requireRole('Instructor'),
  requireInstructor,
  requireApprovedInstructor,
  async (req, res) => {
    try {
      const row = await db.get('SELECT * FROM course_assignments WHERE id = ?', [req.params.id]);
      if (!row) return res.status(404).json({ error: 'Assignment not found' });
      const owns = await instructorOwnsCourse(req.instructor, row.course_id);
      if (!owns) return res.status(403).json({ error: 'Access denied' });
      await db.run('DELETE FROM course_assignments WHERE id = ?', [req.params.id]);
      res.json({ message: 'Assignment removed' });
    } catch (e) {
      console.error('Delete assignment error:', e);
      res.status(500).json({ error: 'Failed to delete assignment' });
    }
  }
);

// Attendance
router.get(
  '/me/courses/:courseId/attendance',
  authenticateToken,
  requireRole('Instructor'),
  requireInstructor,
  requireCourseAccess,
  async (req, res) => {
    try {
      const sessionDate = req.query.date || new Date().toISOString().slice(0, 10);
      const students = await getStudentsForCourse(req.courseId);
      const marks = await db.all(
        `SELECT student_id, status, notes FROM student_attendance
         WHERE course_id = ? AND session_date = ?`,
        [req.courseId, sessionDate]
      );
      const markMap = {};
      (marks || []).forEach((m) => { markMap[m.student_id] = m; });
      const roster = students.map((s) => ({
        ...s,
        attendance_status: markMap[s.id]?.status || null,
        attendance_notes: markMap[s.id]?.notes || null
      }));
      res.json({ session_date: sessionDate, roster });
    } catch (e) {
      console.error('Get attendance error:', e);
      res.status(500).json({ error: 'Failed to fetch attendance' });
    }
  }
);

router.post(
  '/me/courses/:courseId/attendance',
  authenticateToken,
  requireRole('Instructor'),
  requireInstructor,
  requireApprovedInstructor,
  requireCourseAccess,
  [
    body('session_date').notEmpty().withMessage('session_date is required'),
    body('records').isArray({ min: 1 }).withMessage('records array is required')
  ],
  async (req, res) => {
    try {
      const errs = validationResult(req);
      if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
      const { session_date, records } = req.body;
      for (const rec of records) {
        const studentId = parseInt(rec.student_id, 10);
        const status = rec.status || 'Present';
        if (Number.isNaN(studentId)) continue;
        const enrolled = await db.get(
          'SELECT id FROM student_course_enrollments WHERE student_id = ? AND course_id = ? AND status != ?',
          [studentId, req.courseId, 'Dropped']
        );
        if (!enrolled) continue;
        await db.run(
          `INSERT INTO student_attendance (student_id, course_id, session_date, status, notes, marked_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT(student_id, course_id, session_date)
           DO UPDATE SET status = excluded.status, notes = excluded.notes, marked_by = excluded.marked_by, updated_at = CURRENT_TIMESTAMP`,
          [studentId, req.courseId, session_date, status, rec.notes || null, req.user.id]
        );
      }
      await logAction(req.user.id, 'mark_attendance', 'academy', req.courseId, { session_date }, req);
      res.json({ message: 'Attendance saved' });
    } catch (e) {
      console.error('Save attendance error:', e);
      res.status(500).json({ error: 'Failed to save attendance' });
    }
  }
);

// Submit grade (instructor-scoped)
router.post(
  '/me/grades/submit',
  authenticateToken,
  requireRole('Instructor'),
  requireInstructor,
  requireApprovedInstructor,
  [
    body('student_id').isInt().withMessage('student_id is required'),
    body('course_id').isInt().withMessage('course_id is required')
  ],
  async (req, res) => {
    try {
      const errs = validationResult(req);
      if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
      const { student_id, course_id } = req.body;

      let gradeFields;
      try {
        gradeFields = parseGradeSubmissionInput(req.body);
      } catch (e) {
        return res.status(e.statusCode || 400).json({ error: e.message });
      }

      const proposed_grade = gradeFields.proposed_grade;
      const owns = await instructorOwnsCourse(req.instructor, course_id);
      if (!owns) {
        return res.status(403).json({ error: 'You can only submit grades for your assigned courses' });
      }
      const enroll = await db.get(
        'SELECT id FROM student_course_enrollments WHERE student_id = ? AND course_id = ? AND status != ?',
        [student_id, course_id, 'Dropped']
      );
      if (!enroll) return res.status(400).json({ error: 'Student is not enrolled in this course' });

      const run = await db.run(
        `INSERT INTO grade_submissions (
           student_id, course_id, proposed_grade,
           score_assignment, score_attendance, score_presentation,
           score_assessment, score_project, score_final_exam, score_average,
           status, submitted_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          student_id,
          course_id,
          proposed_grade,
          gradeFields.score_assignment ?? null,
          gradeFields.score_attendance ?? null,
          gradeFields.score_presentation ?? null,
          gradeFields.score_assessment ?? null,
          gradeFields.score_project ?? null,
          gradeFields.score_final_exam ?? null,
          gradeFields.score_average ?? null,
          req.user.id
        ]
      );

      await logAction(req.user.id, 'submit_grade', 'academy', run.lastID, { student_id, course_id, proposed_grade, ...gradeFields }, req);

      const { notifyAcademyCoordinators } = require('../utils/instructorHelpers');
      await notifyAcademyCoordinators({
        title: 'Grade pending coordinator review',
        message: `Grade "${proposed_grade}" submitted and awaiting coordinator approval.`,
        type: 'info',
        link: '/academy?tab=grades',
        senderId: req.user.id
      }, req.user.id);

      res.status(201).json({
        message: 'Grade submitted for coordinator review',
        submission: { id: run.lastID, status: 'Pending' }
      });
    } catch (e) {
      console.error('Instructor grade submit error:', e);
      res.status(500).json({ error: 'Failed to submit grade' });
    }
  }
);

module.exports = router;
