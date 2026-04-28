const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticateToken, requireRole, getFinanceAccessUserIds } = require('../utils/auth');
const { logAction } = require('../utils/audit');
const { sendBulkNotifications, sendNotificationToUser, sendNotificationToRole } = require('../utils/notifications');
const { normalizeProfileImage } = require('../utils/normalizeProfileImage');
const { resolveUploadsDiskPath } = require('../utils/uploadsRoot');
const crypto = require('crypto');
const path = require('path');

// Generate unique student ID
function generateStudentId() {
  return 'STU-' + Date.now().toString().slice(-8) + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
}

// Generate unique instructor ID
function generateInstructorId() {
  return 'INS-' + Date.now().toString().slice(-8) + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
}

// Generate unique certificate ID
function generateCertificateId() {
  return 'CERT-' + Date.now().toString().slice(-8) + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function isCertificateWindowOpenForCohort(row) {
  const enabled = Number(row?.cert_access_enabled || 0) === 1;
  if (!enabled) return false;
  const now = new Date();
  if (row?.cert_access_start) {
    const start = new Date(row.cert_access_start);
    if (now < start) return false;
  }
  if (row?.cert_access_end) {
    const end = new Date(row.cert_access_end);
    if (now > end) return false;
  }
  return true;
}

// Helper function to check if user is Academy staff (Academy, eLearning, or Marketing department)
// Includes: Admin, Academy Department Head, Marketing Department Head, and Assistant Academy Coordinator (Staff in Academy department)
async function isAcademyStaff(user) {
  if (!user) return false;
  
  // Admin always has access
  if (user.role === 'Admin') {
    return true;
  }

  // Instructors manage academy resources
  if (user.role === 'Instructor') {
    return true;
  }
  
  // Explicit email allowlist: Academy coordinators and Academy Head (full academy rights regardless of department)
  const userEmail = (user.email || '').toLowerCase().trim();
  const academyCoordinatorEmails = ['samsonbryant89@gmail.com', 'cvulue@prinstinegroup.org'];
  const academyHeadEmails = ['fwallace@prinstinegroup.org'];
  if (academyCoordinatorEmails.includes(userEmail) || academyHeadEmails.includes(userEmail)) {
    console.log(`[isAcademyStaff] User ${userEmail} identified as Academy staff via email allowlist`);
    return true;
  }
  
  // Check if DepartmentHead manages Academy department (Academy Department Head)
  if (user.role === 'DepartmentHead') {
    try {
      const USE_POSTGRESQL = !!process.env.DATABASE_URL;
      let hasHeadEmail = false;
      if (USE_POSTGRESQL) {
        const col = await db.get(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'departments' AND column_name = 'head_email'"
        );
        hasHeadEmail = !!col;
      } else {
        const deptTableInfo = await db.all("PRAGMA table_info(departments)");
        const deptColumnNames = (deptTableInfo || []).map(col => col.name);
        hasHeadEmail = deptColumnNames.includes('head_email');
      }
      
      let dept;
      if (hasHeadEmail) {
        dept = await db.get(
          'SELECT name FROM departments WHERE manager_id = ? OR LOWER(TRIM(head_email)) = ?',
          [user.id, userEmail]
        );
      } else {
        dept = await db.get(
          'SELECT name FROM departments WHERE manager_id = ?',
          [user.id]
        );
      }
      
      if (dept && dept.name) {
        const deptName = (dept.name || '').toLowerCase();
        if (deptName.includes('academy') || deptName.includes('elearning') || deptName.includes('e-learning') || deptName.includes('marketing')) {
          return true;
        }
      }
    } catch (error) {
      console.error('Error checking department head department:', error);
    }
  }
  
  // Check if Staff belongs to Academy department (Assistant Academy Coordinator)
  if (user.role === 'Staff') {
    try {
      const staff = await db.get('SELECT department, position FROM staff WHERE user_id = ?', [user.id]);
      if (staff) {
        const deptName = (staff.department || '').toLowerCase();
        const positionName = (staff.position || '').toLowerCase();
        
        if (deptName.includes('academy') || deptName.includes('elearning') || deptName.includes('e-learning')) {
          console.log(`[isAcademyStaff] User ${userEmail} identified as Academy staff via department: ${staff.department}`);
          return true;
        }
        if (positionName.includes('academy') && positionName.includes('coordinator')) {
          console.log(`[isAcademyStaff] User ${userEmail} identified as Academy Coordinator via position: ${staff.position}`);
          return true;
        }
      }
    } catch (error) {
      console.error('Error checking staff department (non-fatal):', error);
    }
  }
  
  return false;
}

// ========== STUDENTS ==========

// Resolve current student record (students row) for req.user; requires role Student.
// Returns student even when approved = 0 (pending) so they can log in and see "pending approval".
async function getCurrentStudent(req) {
  if (req.user.role !== 'Student') return null;
  return db.get(
    'SELECT s.*, u.name, u.email, u.phone, u.profile_image FROM students s JOIN users u ON s.user_id = u.id WHERE s.user_id = ?',
    [req.user.id]
  );
}

/** Official gradesheet payload for Prinstine Academy (PDF / print) */
async function buildGradesheetPayload(studentDbId) {
  const student = await db.get(
    `SELECT s.*, u.name as display_name, u.email,
            ch.name as cohort_name, ch.code as cohort_code
     FROM students s
     JOIN users u ON s.user_id = u.id
     LEFT JOIN cohorts ch ON s.cohort_id = ch.id
     WHERE s.id = ?`,
    [studentDbId]
  );
  if (!student) return null;
  const gradeRows = await db.all(
    `SELECT g.proposed_grade as grade, g.approved_at,
            c.course_code, c.title as course_title
     FROM grade_submissions g
     JOIN courses c ON g.course_id = c.id
     WHERE g.student_id = ? AND g.status = 'Approved'
     ORDER BY c.course_code ASC`,
    [studentDbId]
  );
  return {
    academyName: 'Prinstine Academy',
    studentName: student.display_name || student.name || student.email,
    studentCode: student.student_id,
    cohortName: student.cohort_name || null,
    cohortCode: student.cohort_code || null,
    grades: gradeRows.map((r) => ({
      grade: r.grade,
      course_code: r.course_code,
      course_title: r.course_title,
      approved_at: r.approved_at
    })),
    issuedDate: new Date().toISOString(),
    ceoName: 'Prince S. Cooper',
    ceoTitle: 'Chief Executive Officer, Prinstine Academy'
  };
}

// ----- Student self-service: /students/me (must be before /students/:id) -----

// GET /api/academy/students/me — current student profile
router.get('/students/me', authenticateToken, requireRole('Student'), async (req, res) => {
  try {
    const student = await getCurrentStudent(req);
    if (!student) return res.status(404).json({ error: 'Student record not found' });
    res.json({ student });
  } catch (e) {
    console.error('Get students/me error:', e);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// GET /api/academy/students/me/courses — enrolled courses
router.get('/students/me/courses', authenticateToken, requireRole('Student'), async (req, res) => {
  try {
    const student = await getCurrentStudent(req);
    if (!student) return res.status(404).json({ error: 'Student record not found or not approved' });
    const courses = await db.all(
      `SELECT e.id, e.course_id, e.enrollment_date, e.status as enrollment_status,
              c.course_code, c.title, c.mode, c.status as course_status
       FROM student_course_enrollments e
       JOIN courses c ON e.course_id = c.id
       WHERE e.student_id = ? AND e.status != 'Dropped'
       ORDER BY e.enrollment_date DESC`,
      [student.id]
    );
    res.json({ courses });
  } catch (e) {
    console.error('Get students/me/courses error:', e);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

// GET /api/academy/students/me/billing — per-course balances + pending transactions
router.get('/students/me/billing', authenticateToken, requireRole('Student'), async (req, res) => {
  try {
    const student = await getCurrentStudent(req);
    if (!student) return res.status(404).json({ error: 'Student record not found or not approved' });
    const balances = await db.all(
      `SELECT sp.id, sp.course_id, sp.course_fee, sp.amount_paid, sp.balance,
              c.course_code, c.title
       FROM student_payments sp
       JOIN courses c ON sp.course_id = c.id
       WHERE sp.student_id = ?
       ORDER BY c.course_code`,
      [student.id]
    );
    const pending = await db.all(
      `SELECT t.id, t.course_id, t.amount, t.payment_date, t.payment_method, t.payment_reference, t.status, t.created_at,
              c.course_code, c.title
       FROM student_payment_transactions t
       JOIN courses c ON t.course_id = c.id
       WHERE t.student_id = ? AND t.status = 'Pending'
       ORDER BY t.created_at DESC`,
      [student.id]
    );
    const transactions = await db.all(
      `SELECT t.id, t.course_id, t.amount, t.payment_date, t.payment_method, t.payment_reference, t.status, t.created_at, t.admin_notes,
              c.course_code, c.title
       FROM student_payment_transactions t
       JOIN courses c ON t.course_id = c.id
       WHERE t.student_id = ?
       ORDER BY t.created_at DESC`,
      [student.id]
    );
    res.json({ balances, pending, transactions });
  } catch (e) {
    console.error('Get students/me/billing error:', e);
    res.status(500).json({ error: 'Failed to fetch billing' });
  }
});

// POST /api/academy/students/me/billing/generate-invoice — create invoice snapshot, notify finance
router.post('/students/me/billing/generate-invoice', authenticateToken, requireRole('Student'), [
  body('period').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const student = await getCurrentStudent(req);
    if (!student) return res.status(404).json({ error: 'Student record not found or not approved' });

    const payments = await db.all(
      `SELECT sp.id, sp.course_id, sp.course_fee, sp.amount_paid, sp.balance
       FROM student_payments sp WHERE sp.student_id = ?`,
      [student.id]
    );
    if (payments.length === 0) return res.status(400).json({ error: 'No billing records to invoice' });

    const totalFee = payments.reduce((s, p) => s + (parseFloat(p.course_fee) || 0), 0);
    const totalPaid = payments.reduce((s, p) => s + (parseFloat(p.amount_paid) || 0), 0);
    const totalBalance = payments.reduce((s, p) => s + (parseFloat(p.balance) || 0), 0);

    const invoiceNumber = 'INV-' + student.student_id + '-' + Date.now();
    const period = req.body.period || null;

    const invResult = await db.run(
      `INSERT INTO student_invoices (student_id, invoice_number, period, status, total_fee, total_paid, total_balance, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'Sent_to_finance', ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [student.id, invoiceNumber, period, totalFee, totalPaid, totalBalance, req.user.id]
    );
    const invoiceId = invResult.lastID;

    for (const p of payments) {
      await db.run(
        `INSERT INTO student_invoice_items (invoice_id, course_id, course_fee, amount_paid_at_generation, balance_at_generation, created_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [invoiceId, p.course_id, p.course_fee, p.amount_paid, p.balance]
      );
    }

    await logAction(req.user.id, 'generate_student_invoice', 'academy', invoiceId, { invoice_number: invoiceNumber, student_id: student.id }, req);

    const financeIds = await getFinanceAccessUserIds();
    if (financeIds.length) {
      try {
        await sendBulkNotifications(
          financeIds,
          'New student invoice',
          `Invoice ${invoiceNumber} generated for ${student.name || student.email}. Total balance: ${totalBalance}.`,
          'info',
          '/student-payments',
          req.user.id
        );
      } catch (notifErr) {
        console.error('Invoice finance notification error:', notifErr);
      }
    }

    res.status(201).json({ message: 'Invoice generated', invoice: { id: invoiceId, invoice_number: invoiceNumber } });
  } catch (e) {
    console.error('Generate invoice error:', e);
    res.status(500).json({ error: 'Failed to generate invoice' });
  }
});

// GET /api/academy/students/me/grades — approved grades only
router.get('/students/me/grades', authenticateToken, requireRole('Student'), async (req, res) => {
  try {
    const student = await getCurrentStudent(req);
    if (!student) return res.status(404).json({ error: 'Student record not found or not approved' });
    const grades = await db.all(
      `SELECT g.id, g.course_id, g.proposed_grade as grade, g.approved_at,
              c.course_code, c.title,
              ch.name as cohort_name, ch.code as cohort_code
       FROM grade_submissions g
       JOIN courses c ON g.course_id = c.id
       JOIN students s2 ON g.student_id = s2.id
       LEFT JOIN cohorts ch ON s2.cohort_id = ch.id
       WHERE g.student_id = ? AND g.status = 'Approved'
       ORDER BY g.approved_at DESC`,
      [student.id]
    );
    res.json({ grades });
  } catch (e) {
    console.error('Get students/me/grades error:', e);
    res.status(500).json({ error: 'Failed to fetch grades' });
  }
});

// GET /api/academy/students/me/gradesheet — JSON for PDF/print (current student)
router.get('/students/me/gradesheet', authenticateToken, requireRole('Student'), async (req, res) => {
  try {
    const student = await getCurrentStudent(req);
    if (!student) return res.status(404).json({ error: 'Student record not found' });
    const payload = await buildGradesheetPayload(student.id);
    if (!payload) return res.status(404).json({ error: 'Student record not found' });
    res.json(payload);
  } catch (e) {
    console.error('Get students/me/gradesheet error:', e);
    res.status(500).json({ error: 'Failed to build gradesheet' });
  }
});

// GET /api/academy/students/me/certificates — certificates with safe download URLs
router.get('/students/me/certificates', authenticateToken, requireRole('Student'), async (req, res) => {
  try {
    const student = await getCurrentStudent(req);
    if (!student) return res.status(404).json({ error: 'Student record not found or not approved' });
    const cohort = await db.get(
      'SELECT cert_access_enabled, cert_access_start, cert_access_end FROM cohorts WHERE id = ?',
      [student.cohort_id || null]
    );
    if (!cohort || !isCertificateWindowOpenForCohort(cohort)) {
      return res.status(403).json({
        error: 'Certificate access for your cohort is currently closed. Please contact Academy administration.'
      });
    }
    const certs = await db.all(
      `SELECT c.id, c.certificate_id, c.course_id, c.issue_date, c.grade, c.verification_code,
              COALESCE(c.file_path, c.pdf_path) as file_path,
              co.course_code, co.title as course_title
       FROM certificates c
       JOIN courses co ON c.course_id = co.id
       WHERE c.student_id = ?
       ORDER BY c.issue_date DESC`,
      [student.id]
    );
    const withUrls = certs.map((cert) => ({
      ...cert,
      download_url: cert.file_path
        ? `/academy/students/me/certificates/${cert.id}/download`
        : null
    }));
    res.json({ certificates: withUrls });
  } catch (e) {
    console.error('Get students/me/certificates error:', e);
    res.status(500).json({ error: 'Failed to fetch certificates' });
  }
});

// GET /api/academy/students/me/certificates/:id/download — safe certificate download (own only)
router.get('/students/me/certificates/:id/download', authenticateToken, requireRole('Student'), async (req, res) => {
  try {
    const student = await getCurrentStudent(req);
    if (!student) return res.status(404).json({ error: 'Student record not found or not approved' });
    const cohort = await db.get(
      'SELECT cert_access_enabled, cert_access_start, cert_access_end FROM cohorts WHERE id = ?',
      [student.cohort_id || null]
    );
    if (!cohort || !isCertificateWindowOpenForCohort(cohort)) {
      return res.status(403).json({
        error: 'Certificate access for your cohort is currently closed. Please contact Academy administration.'
      });
    }
    const cert = await db.get(
      'SELECT id, COALESCE(file_path, pdf_path) as file_path, student_id FROM certificates WHERE id = ? AND student_id = ?',
      [req.params.id, student.id]
    );
    if (!cert) return res.status(404).json({ error: 'Certificate not found' });
    if (!cert.file_path) return res.status(404).json({ error: 'Certificate file not available' });
    const fs = require('fs');
    const fullPath = resolveUploadsDiskPath(cert.file_path);
    if (!fullPath || !fs.existsSync(fullPath)) return res.status(404).json({ error: 'Certificate file not found' });
    const ext = (path.extname(fullPath) || '.pdf').toLowerCase();
    const fileName = `certificate-${cert.id}${ext}`;
    const contentType = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : 'image/jpeg';
    res.sendFile(fullPath, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${fileName}"`
      }
    });
  } catch (e) {
    console.error('Certificate download error:', e);
    res.status(500).json({ error: 'Download failed' });
  }
});

// Get all students
router.get('/students', authenticateToken, async (req, res) => {
  try {
    const { status, search, pending_approval, cohort_id, period, start_date, end_date, course_id } = req.query;
    let query = `
      SELECT s.*, u.name, u.email, u.phone, u.profile_image, c.name as cohort_name, c.code as cohort_code
      FROM students s
      JOIN users u ON s.user_id = u.id
      LEFT JOIN cohorts c ON s.cohort_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (req.user.role === 'Student') {
      query += ' AND s.user_id = ? AND s.approved = 1';
      params.push(req.user.id);
    } else {
      const academyStaff = await isAcademyStaff(req.user);
      // Admin and Academy staff can see all students (including pending)
      if (req.user.role === 'Admin' || academyStaff) {
        if (pending_approval === 'true') {
          query += ' AND s.approved = 0';
        }
        // Otherwise show all (no filter)
      } else {
        // Non-admin, non-academy users only see approved students
        query += ' AND s.approved = 1';
      }
    }

    if (status) {
      query += ' AND s.status = ?';
      params.push(status);
    }
    if (cohort_id) {
      query += ' AND s.cohort_id = ?';
      params.push(cohort_id);
    }
    if (period) {
      query += ' AND s.period = ?';
      params.push(period);
    }
    if (start_date) {
      query += ' AND s.enrollment_date >= ?';
      params.push(start_date);
    }
    if (end_date) {
      query += ' AND s.enrollment_date <= ?';
      params.push(end_date);
    }
    if (search) {
      query += ' AND (u.name LIKE ? OR u.email LIKE ? OR s.student_id LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    if (course_id) {
      const cid = parseInt(course_id, 10);
      if (!isNaN(cid)) {
        query += ` AND EXISTS (
          SELECT 1 FROM student_course_enrollments sce
          WHERE sce.student_id = s.id AND sce.course_id = ?
        )`;
        params.push(cid);
      }
    }

    query += ' ORDER BY LOWER(TRIM(u.name)) ASC, s.student_id ASC';

    const students = await db.all(query, params);
    res.json({ students });
  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

// Get single student
router.get('/students/:id', authenticateToken, async (req, res) => {
  try {
    const studentId = req.params.id;

    const student = await db.get(
      `SELECT s.*, u.name, u.email, u.phone, u.profile_image
       FROM students s
       JOIN users u ON s.user_id = u.id
       WHERE s.id = ? OR s.student_id = ?`,
      [studentId, studentId]
    );

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    if (req.user.role === 'Student' && student.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    res.json({ student });
  } catch (error) {
    console.error('Get student error:', error);
    res.status(500).json({ error: 'Failed to fetch student' });
  }
});

// GET /api/academy/students/:id/gradesheet — Admin & Academy staff (for print/download)
router.get('/students/:id/gradesheet', authenticateToken, async (req, res) => {
  try {
    const academyStaff = await isAcademyStaff(req.user);
    if (req.user.role !== 'Admin' && !academyStaff) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const sid = req.params.id;
    const row = await db.get('SELECT id FROM students WHERE id = ? OR student_id = ?', [sid, sid]);
    if (!row) return res.status(404).json({ error: 'Student not found' });
    const payload = await buildGradesheetPayload(row.id);
    if (!payload) return res.status(404).json({ error: 'Student not found' });
    res.json(payload);
  } catch (e) {
    console.error('Get student gradesheet error:', e);
    res.status(500).json({ error: 'Failed to build gradesheet' });
  }
});

// Create student
router.post('/students', authenticateToken, requireRole('Admin', 'Instructor', 'DepartmentHead', 'Staff'), [
  body('email').isEmail().normalizeEmail(),
  body('name').trim().notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, name, username, phone, enrollment_date, courses_enrolled, password, status, profile_image, cohort_id, period } = req.body;

    const normProfileImage = normalizeProfileImage(profile_image) ?? null;
    const normEmail = (email || '').toString().toLowerCase().trim();
    if (!normEmail) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }

    const academyStaff = await isAcademyStaff(req.user);
    if (!academyStaff && req.user.role !== 'Admin') {
      return res.status(403).json({ error: 'Only Academy staff and Admins can create students' });
    }

    const approved = req.user.role === 'Admin' ? 1 : 0;
    const createdById = parseInt(req.user.id, 10) || req.user.id;
    if (createdById == null || createdById === '') {
      return res.status(400).json({ error: 'Invalid session. Please log in again.' });
    }
    const cohortIdVal = (cohort_id !== undefined && cohort_id !== null && String(cohort_id).trim() !== '') ? parseInt(cohort_id, 10) : null;
    const periodVal = (period !== undefined && period !== null && String(period).trim() !== '') ? String(period).trim() : null;
    const enrollmentDateVal = enrollment_date && String(enrollment_date).trim() ? String(enrollment_date).trim().split('T')[0] : new Date().toISOString().split('T')[0];
    const statusVal = status && ['Active', 'Graduated', 'Suspended', 'Dropped'].includes(String(status)) ? String(status) : 'Active';
    const coursesArray = Array.isArray(courses_enrolled) ? courses_enrolled.map(c => parseInt(c, 10)).filter(n => !isNaN(n)) : [];
    const coursesEnrolledJson = coursesArray.length > 0 ? JSON.stringify(coursesArray) : null;

    // Get or create user by email: reuse existing user so student can always be created regardless of email
    let newUserId;
    const existingUser = await db.get(
      'SELECT id, role FROM users WHERE email = ? OR LOWER(TRIM(email)) = ?',
      [normEmail, normEmail]
    );

    if (existingUser) {
      newUserId = existingUser.id;
      // If they already have a student record, do not create a duplicate
      const existingStudent = await db.get('SELECT id, student_id FROM students WHERE user_id = ?', [newUserId]);
      if (existingStudent) {
        return res.status(400).json({
          error: 'This email is already registered as a student. You can edit the existing student from the students list.'
        });
      }
      // Optionally update user name/phone/profile if provided
      const updates = [];
      const params = [];
      if (name) { updates.push('name = ?'); params.push(name); }
      if (phone !== undefined) { updates.push('phone = ?'); params.push(phone || null); }
      if (normProfileImage !== undefined && normProfileImage !== null) { updates.push('profile_image = ?'); params.push(normProfileImage); }
      if (updates.length > 0) {
        params.push(newUserId);
        await db.run(`UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params);
      }
    } else {
      const { hashPassword } = require('../utils/auth');
      const passwordHash = await hashPassword(password || 'Student@123');
      const usernameToStore = ('stu_' + normEmail.replace(/[^a-z0-9]/gi, '_')).slice(0, 255);
      const isUniqueError = (err) => {
        const msg = (err.message || '').toLowerCase();
        const code = err.code || err.errno;
        return code === 'SQLITE_CONSTRAINT' || code === '23505' || msg.includes('unique') || msg.includes('duplicate');
      };
      const isPkeyDuplicate = (err) => (err.message || '').includes('pkey') && (err.message || '').includes('duplicate');
      let userResult;
      try {
        userResult = await db.run(
          `INSERT INTO users (email, username, password_hash, role, name, phone, profile_image, is_active, email_verified)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [normEmail, usernameToStore, passwordHash, 'Student', name, phone || null, normProfileImage, approved]
        );
      } catch (userErr) {
        if (isUniqueError(userErr)) {
          if (isPkeyDuplicate(userErr)) {
            for (const tableName of ['users', 'users_new']) {
              try {
                await db.run(`SELECT setval(pg_get_serial_sequence('${tableName}', 'id'), (SELECT COALESCE(MAX(id), 1) FROM ${tableName}))`);
                break;
              } catch (e) {
                if (tableName === 'users_new') console.error('Create student – sequence sync error:', e.message);
              }
            }
            try {
              userResult = await db.run(
                `INSERT INTO users (email, username, password_hash, role, name, phone, profile_image, is_active, email_verified)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
                [normEmail, usernameToStore, passwordHash, 'Student', name, phone || null, normProfileImage, approved]
              );
            } catch (retryErr) {
              if (!isUniqueError(retryErr)) throw retryErr;
              userErr = retryErr;
            }
          }
          if (userResult == null) {
            const again = await db.get('SELECT id, role FROM users WHERE LOWER(TRIM(email)) = ? OR email = ?', [normEmail, normEmail]);
            if (again) {
              newUserId = again.id;
              const existingStudent = await db.get('SELECT id, student_id FROM students WHERE user_id = ?', [newUserId]);
              if (existingStudent) {
                return res.status(400).json({
                  error: 'This email is already registered as a student. You can edit the existing student from the students list.'
                });
              }
              const updates = [];
              const params = [];
              if (name) { updates.push('name = ?'); params.push(name); }
              if (phone !== undefined) { updates.push('phone = ?'); params.push(phone || null); }
              if (normProfileImage !== undefined && normProfileImage !== null) { updates.push('profile_image = ?'); params.push(normProfileImage); }
              if (updates.length > 0) {
                params.push(newUserId);
                await db.run(`UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params);
              }
            } else {
              console.error('Create student – user insert unique error but no user found by email:', userErr.message);
              throw userErr;
            }
          }
        } else {
          console.error('Create student – user insert error:', userErr.code, userErr.message);
          throw userErr;
        }
      }
      if (newUserId == null) {
        newUserId = userResult && (userResult.lastID ?? (userResult.rows && userResult.rows[0] && (userResult.rows[0].id ?? userResult.rows[0].ID)));
        if (newUserId == null) {
          return res.status(500).json({ error: 'Failed to create user account' });
        }
      }
    }

    const studentId = generateStudentId();
    let result;
    try {
      result = await db.run(
        `INSERT INTO students (user_id, student_id, enrollment_date, courses_enrolled, status, approved, cohort_id, period, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          newUserId,
          studentId,
          enrollmentDateVal,
          coursesEnrolledJson,
          statusVal,
          approved,
          cohortIdVal,
          periodVal,
          createdById
        ]
      );
    } catch (studentErr) {
      const msg = (studentErr.message || '').toLowerCase();
      if (msg.includes('no such column') || msg.includes('column') && msg.includes('does not exist')) {
        console.error('Create student: students table may be missing columns (approved, created_by, cohort_id, period). Run migrations.', studentErr);
        return res.status(500).json({ error: 'Server configuration error. Please contact admin.' });
      }
      throw studentErr;
    }

    const newStudentId = result.lastID ?? (result.rows && result.rows[0] && (result.rows[0].id ?? result.rows[0].ID));
    if (newStudentId == null) {
      return res.status(500).json({ error: 'Failed to create student record' });
    }

    if (approved === 1 && coursesArray.length > 0) {
      for (const courseId of coursesArray) {
        const cid = parseInt(courseId, 10);
        if (isNaN(cid)) continue;
        const course = await db.get('SELECT id, course_fee FROM courses WHERE id = ?', [cid]);
        if (course) {
          try {
            await db.run(
              `INSERT INTO student_course_enrollments (student_id, user_id, course_id, enrollment_date, status)
               VALUES (?, ?, ?, ?, 'Enrolled')`,
              [newStudentId, newUserId, cid, enrollmentDateVal]
            );
          } catch (enrollError) {
            if (!(enrollError.message || '').includes('UNIQUE') && !(enrollError.code === '23505')) {
              console.error('Error creating enrollment:', enrollError);
            }
          }
          const courseFee = parseFloat(course.course_fee) || 0;
          try {
            await db.run(
              `INSERT INTO student_payments (student_id, user_id, course_id, course_fee, amount_paid, balance)
               VALUES (?, ?, ?, ?, 0, ?)`,
              [newStudentId, newUserId, cid, courseFee, courseFee]
            );
          } catch (paymentError) {
            if (!(paymentError.message || '').includes('UNIQUE') && paymentError.code !== '23505') {
              console.error('Error creating payment record:', paymentError);
            }
          }
        }
      }
    }

    await logAction(req.user.id, 'create_student', 'academy', newStudentId, { studentId, approved }, req);

    res.status(201).json({
      message: req.user.role === 'Admin'
        ? 'Student created successfully'
        : 'Student created successfully and is pending admin approval',
      student: { id: newStudentId, student_id: studentId, approved }
    });
  } catch (error) {
    const errMsg = error.message || String(error);
    console.error('Create student error:', errMsg);
    const isDev = process.env.NODE_ENV === 'development';
    res.status(500).json({
      error: isDev ? `Failed to create student: ${errMsg}` : 'Failed to create student. Please try again. If the problem continues, contact support.',
      details: isDev ? errMsg : undefined
    });
  }
});

// Approve/reject student (Admin only) - MUST be before /students/:id
router.put('/students/:id/approve', authenticateToken, requireRole('Admin'), [
  body('approved').isBoolean().withMessage('Approved status is required'),
  body('admin_notes').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { approved, admin_notes } = req.body;

    const student = await db.get(
      `SELECT s.id, s.user_id, s.approved, s.courses_enrolled 
       FROM students s 
       WHERE s.id = ?`,
      [req.params.id]
    );
    
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const approvedStatus = approved ? 1 : 2; // 1 = Approved, 2 = Rejected
    
    await db.run(
      `UPDATE students 
       SET approved = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP, admin_notes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [approvedStatus, req.user.id, admin_notes || null, req.params.id]
    );

    // Update user account to active if approved, inactive if rejected
    await db.run(
      `UPDATE users SET is_active = ? WHERE id = ?`,
      [approved ? 1 : 0, student.user_id]
    );

    // If approved and has courses_enrolled, create enrollments and payment records
    if (approved && student.courses_enrolled) {
      try {
        let courseIds = [];
        try {
          courseIds = JSON.parse(student.courses_enrolled);
        } catch (e) {
          courseIds = student.courses_enrolled.replace(/[\[\]]/g, '').split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
        }

        const enrollmentDate = new Date().toISOString().split('T')[0];
        
        for (const courseId of courseIds) {
          const course = await db.get('SELECT id, course_fee FROM courses WHERE id = ?', [courseId]);
          if (course) {
            // Create enrollment record
            try {
              await db.run(
                `INSERT INTO student_course_enrollments (student_id, user_id, course_id, enrollment_date, status)
                 VALUES (?, ?, ?, ?, 'Enrolled')`,
                [student.id, student.user_id, courseId, enrollmentDate]
              );
            } catch (enrollError) {
              if (!enrollError.message.includes('UNIQUE constraint')) {
                console.error('Error creating enrollment:', enrollError);
              }
            }

            // Create payment record
            const courseFee = course.course_fee || 0;
            try {
              await db.run(
                `INSERT INTO student_payments (student_id, user_id, course_id, course_fee, amount_paid, balance)
                 VALUES (?, ?, ?, ?, 0, ?)`,
                [student.id, student.user_id, courseId, courseFee, courseFee]
              );
            } catch (paymentError) {
              if (!paymentError.message.includes('UNIQUE constraint')) {
                console.error('Error creating payment record:', paymentError);
              }
            }
          }
        }
      } catch (error) {
        console.error('Error processing course enrollments on approval:', error);
        // Don't fail the approval if enrollment creation fails
      }
    }

    await logAction(req.user.id, approved ? 'approve_student' : 'reject_student', 'academy', req.params.id, { approved }, req);

    res.json({ message: `Student ${approved ? 'approved' : 'rejected'} successfully` });
  } catch (error) {
    console.error('Approve student error:', error);
    res.status(500).json({ error: 'Failed to process approval' });
  }
});

// Update student
router.put('/students/:id', authenticateToken, requireRole('Admin', 'Instructor', 'DepartmentHead', 'Staff'), async (req, res) => {
  try {
    const studentId = req.params.id;
    const updates = req.body;

    const student = await db.get('SELECT user_id FROM students WHERE id = ?', [studentId]);
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Check if user is Academy staff or Admin
    const academyStaff = await isAcademyStaff(req.user);
    if (!academyStaff && req.user.role !== 'Admin') {
      return res.status(403).json({ error: 'Only Academy staff and Admins can edit students' });
    }
    
    // Only Admin can change approved status
    if (updates.approved !== undefined && req.user.role !== 'Admin') {
      return res.status(403).json({ error: 'Only Admin can approve/reject students' });
    }

    // Update user info if provided (profile_image stored permanently in users table)
    const normProfileImage = normalizeProfileImage(updates.profile_image);
    if (updates.name || updates.phone || updates.profile_image !== undefined) {
      const userUpdates = [];
      const userParams = [];
      if (updates.name) {
        userUpdates.push('name = ?');
        userParams.push(updates.name);
      }
      if (updates.phone) {
        userUpdates.push('phone = ?');
        userParams.push(updates.phone);
      }
      if (updates.profile_image !== undefined) {
        userUpdates.push('profile_image = ?');
        userParams.push(normProfileImage);
      }
      if (userUpdates.length > 0) {
        userParams.push(student.user_id);
        await db.run(`UPDATE users SET ${userUpdates.join(', ')} WHERE id = ?`, userParams);
      }
    }

    // Update student info
    const studentUpdates = [];
    const studentParams = [];
    if (updates.enrollment_date !== undefined) {
      studentUpdates.push('enrollment_date = ?');
      studentParams.push(updates.enrollment_date);
    }
    if (updates.status !== undefined) {
      studentUpdates.push('status = ?');
      studentParams.push(updates.status);
    }
    if (updates.cohort_id !== undefined) {
      studentUpdates.push('cohort_id = ?');
      const cohortId = (updates.cohort_id !== null && updates.cohort_id !== '') ? parseInt(updates.cohort_id, 10) : null;
      studentParams.push(!isNaN(cohortId) ? cohortId : null);
    }
    if (updates.period !== undefined) {
      studentUpdates.push('period = ?');
      studentParams.push(updates.period || null);
    }
    if (updates.courses_enrolled !== undefined) {
      studentUpdates.push('courses_enrolled = ?');
      studentParams.push(JSON.stringify(updates.courses_enrolled));
    }

    if (studentUpdates.length > 0) {
      studentParams.push(studentId);
      await db.run(`UPDATE students SET ${studentUpdates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, studentParams);
    }

    if (updates.courses_enrolled !== undefined) {
      let desiredCourseIds = [];
      if (Array.isArray(updates.courses_enrolled)) {
        desiredCourseIds = updates.courses_enrolled.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
      } else if (updates.courses_enrolled) {
        try {
          desiredCourseIds = JSON.parse(updates.courses_enrolled)
            .map(id => parseInt(id, 10))
            .filter(id => !isNaN(id));
        } catch (e) {
          desiredCourseIds = String(updates.courses_enrolled)
            .replace(/[\[\]]/g, '')
            .split(',')
            .map(id => parseInt(id.trim(), 10))
            .filter(id => !isNaN(id));
        }
      }

      const uniqueDesiredIds = Array.from(new Set(desiredCourseIds));

      const existingEnrollments = await db.all(
        'SELECT course_id, status FROM student_course_enrollments WHERE student_id = ?',
        [studentId]
      );
      const existingCourseIds = new Set(existingEnrollments.map(row => row.course_id));

      const enrollmentDate = updates.enrollment_date || new Date().toISOString().split('T')[0];

      for (const courseId of uniqueDesiredIds) {
        if (existingCourseIds.has(courseId)) {
          await db.run(
            `UPDATE student_course_enrollments
             SET status = 'Enrolled', updated_at = CURRENT_TIMESTAMP
             WHERE student_id = ? AND course_id = ?`,
            [studentId, courseId]
          );
        } else {
          await db.run(
            `INSERT INTO student_course_enrollments (student_id, user_id, course_id, enrollment_date, status)
             VALUES (?, ?, ?, ?, 'Enrolled')`,
            [studentId, student.user_id, courseId, enrollmentDate]
          );
        }

        const existingPayment = await db.get(
          'SELECT id FROM student_payments WHERE student_id = ? AND course_id = ?',
          [studentId, courseId]
        );
        if (!existingPayment) {
          const course = await db.get('SELECT course_fee FROM courses WHERE id = ?', [courseId]);
          const courseFee = course ? course.course_fee || 0 : 0;
          await db.run(
            `INSERT INTO student_payments (student_id, user_id, course_id, course_fee, amount_paid, balance)
             VALUES (?, ?, ?, ?, 0, ?)`,
            [studentId, student.user_id, courseId, courseFee, courseFee]
          );
        }
      }

      for (const enrollment of existingEnrollments) {
        if (!uniqueDesiredIds.includes(enrollment.course_id) && enrollment.status !== 'Dropped') {
          await db.run(
            `UPDATE student_course_enrollments
             SET status = 'Dropped', updated_at = CURRENT_TIMESTAMP
             WHERE student_id = ? AND course_id = ?`,
            [studentId, enrollment.course_id]
          );
        }
      }
    }

    await logAction(req.user.id, 'update_student', 'academy', studentId, updates, req);

    res.json({ message: 'Student updated successfully' });
  } catch (error) {
    console.error('Update student error:', error);
    res.status(500).json({ error: 'Failed to update student' });
  }
});

// Delete student
router.delete('/students/:id', authenticateToken, requireRole('Admin'), async (req, res) => {
  try {
    const studentId = req.params.id;

    const student = await db.get('SELECT user_id FROM students WHERE id = ?', [studentId]);
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Delete student (cascade will delete user)
    await db.run('DELETE FROM students WHERE id = ?', [studentId]);

    await logAction(req.user.id, 'delete_student', 'academy', studentId, {}, req);

    res.json({ message: 'Student deleted successfully' });
  } catch (error) {
    console.error('Delete student error:', error);
    res.status(500).json({ error: 'Failed to delete student' });
  }
});

// ========== INSTRUCTORS ==========

// Get all instructors
router.get('/instructors', authenticateToken, async (req, res) => {
  try {
    const { search, pending_approval } = req.query;
    let query = `
      SELECT i.*, u.name, u.email, u.phone, u.profile_image
      FROM instructors i
      JOIN users u ON i.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    const academyStaff = await isAcademyStaff(req.user);
    // Admin and Academy staff can see all instructors (including pending)
    if (req.user.role === 'Admin' || academyStaff) {
      if (pending_approval === 'true') {
        query += ' AND i.approved = 0';
      }
      // Otherwise show all (no filter)
    } else {
      // Non-admin, non-academy users only see approved instructors
      query += ' AND i.approved = 1';
    }

    if (search) {
      query += ' AND (u.name LIKE ? OR u.email LIKE ? OR i.instructor_id LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    query += ' ORDER BY i.created_at DESC';

    const instructors = await db.all(query, params);
    res.json({ instructors });
  } catch (error) {
    console.error('Get instructors error:', error);
    res.status(500).json({ error: 'Failed to fetch instructors' });
  }
});

// Create instructor (Admin and Academy Heads can create, but Academy Heads need approval)
router.post('/instructors', authenticateToken, requireRole('Admin', 'DepartmentHead', 'Staff'), [
  body('email').isEmail().normalizeEmail(),
  body('name').trim().notEmpty()
], async (req, res) => {
  try {
    const { email, name, username, phone, specialization, courses_assigned, password, profile_image } = req.body;
    const normalizedProfileImage = normalizeProfileImage(profile_image) ?? null;

    const existingUser = await db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    const { hashPassword } = require('../utils/auth');
    const passwordHash = await hashPassword(password || 'Instructor@123');

    const userResult = await db.run(
      `INSERT INTO users (email, username, password_hash, role, name, phone, profile_image, is_active, email_verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`,
      [email, username || email.split('@')[0], passwordHash, 'Instructor', name, phone || null, normalizedProfileImage]
    );

    const instructorId = generateInstructorId();

    // Check if user is Academy staff
    const academyStaff = await isAcademyStaff(req.user);
    
    // Only Admin and Academy staff can create instructors
    if (!academyStaff && req.user.role !== 'Admin') {
      return res.status(403).json({ error: 'Only Academy staff and Admins can create instructors' });
    }

    // If created by Academy staff (not admin), require admin approval
    // 0 = Pending, 1 = Approved, 2 = Rejected
    const approved = req.user.role === 'Admin' ? 1 : 0;

    const result = await db.run(
      `INSERT INTO instructors (user_id, instructor_id, specialization, courses_assigned, approved, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        userResult.lastID, instructorId,
        specialization || null,
        courses_assigned ? JSON.stringify(courses_assigned) : null,
        approved
      ]
    );

    await logAction(req.user.id, 'create_instructor', 'academy', result.lastID, { instructorId, approved }, req);

    res.status(201).json({
      message: req.user.role === 'Admin' 
        ? 'Instructor created successfully' 
        : 'Instructor created successfully and is pending admin approval',
      instructor: { id: result.lastID, instructor_id: instructorId, approved }
    });
  } catch (error) {
    console.error('Create instructor error:', error);
    res.status(500).json({ error: 'Failed to create instructor: ' + error.message });
  }
});

// Update instructor
router.put('/instructors/:id', authenticateToken, requireRole('Admin', 'DepartmentHead', 'Staff'), async (req, res) => {
  try {
    const instructorId = req.params.id;
    const updates = req.body;

    const instructor = await db.get('SELECT user_id FROM instructors WHERE id = ?', [instructorId]);
    if (!instructor) {
      return res.status(404).json({ error: 'Instructor not found' });
    }

    // Check if user is Academy staff or Admin
    const academyStaff = await isAcademyStaff(req.user);
    if (!academyStaff && req.user.role !== 'Admin') {
      return res.status(403).json({ error: 'Only Academy staff and Admins can edit instructors' });
    }
    
    // Only Admin can change approved status
    if (updates.approved !== undefined && req.user.role !== 'Admin') {
      return res.status(403).json({ error: 'Only Admin can approve/reject instructors' });
    }

    // Update user info if provided
    if (updates.name || updates.phone || updates.profile_image !== undefined) {
      const userUpdates = [];
      const userParams = [];
      if (updates.name) {
        userUpdates.push('name = ?');
        userParams.push(updates.name);
      }
      if (updates.phone) {
        userUpdates.push('phone = ?');
        userParams.push(updates.phone);
      }
      if (updates.profile_image !== undefined) {
        userUpdates.push('profile_image = ?');
        userParams.push(normalizeProfileImage(updates.profile_image));
      }
      if (userUpdates.length > 0) {
        userParams.push(instructor.user_id);
        await db.run(`UPDATE users SET ${userUpdates.join(', ')} WHERE id = ?`, userParams);
      }
    }

    // Update instructor info
    const instructorUpdates = [];
    const instructorParams = [];
    if (updates.specialization !== undefined) {
      instructorUpdates.push('specialization = ?');
      instructorParams.push(updates.specialization);
    }
    if (updates.courses_assigned !== undefined) {
      instructorUpdates.push('courses_assigned = ?');
      instructorParams.push(JSON.stringify(updates.courses_assigned));
    }

    if (instructorUpdates.length > 0) {
      instructorParams.push(instructorId);
      await db.run(`UPDATE instructors SET ${instructorUpdates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, instructorParams);
    }

    await logAction(req.user.id, 'update_instructor', 'academy', instructorId, updates, req);

    res.json({ message: 'Instructor updated successfully' });
  } catch (error) {
    console.error('Update instructor error:', error);
    res.status(500).json({ error: 'Failed to update instructor' });
  }
});

// Get single instructor
router.get('/instructors/:id', authenticateToken, async (req, res) => {
  try {
    const instructorId = req.params.id;

    const instructor = await db.get(
      `SELECT i.*, u.name, u.email, u.phone, u.profile_image, u.username
       FROM instructors i
       JOIN users u ON i.user_id = u.id
       WHERE i.id = ? OR i.instructor_id = ?`,
      [instructorId, instructorId]
    );

    if (!instructor) {
      return res.status(404).json({ error: 'Instructor not found' });
    }

    res.json({ instructor });
  } catch (error) {
    console.error('Get instructor error:', error);
    res.status(500).json({ error: 'Failed to fetch instructor' });
  }
});

// Delete instructor
router.delete('/instructors/:id', authenticateToken, requireRole('Admin'), async (req, res) => {
  try {
    const instructorId = req.params.id;

    const instructor = await db.get('SELECT user_id FROM instructors WHERE id = ?', [instructorId]);
    if (!instructor) {
      return res.status(404).json({ error: 'Instructor not found' });
    }

    // Check if instructor has assigned courses
    const courses = await db.get('SELECT COUNT(*) as count FROM courses WHERE instructor_id = ?', [instructorId]);
    if (courses.count > 0) {
      return res.status(400).json({ error: 'Cannot delete instructor with assigned courses' });
    }

    await db.run('DELETE FROM instructors WHERE id = ?', [instructorId]);

    await logAction(req.user.id, 'delete_instructor', 'academy', instructorId, {}, req);

    res.json({ message: 'Instructor deleted successfully' });
  } catch (error) {
    console.error('Delete instructor error:', error);
    res.status(500).json({ error: 'Failed to delete instructor' });
  }
});

// ========== COURSES ==========

// Get all courses
router.get('/courses', authenticateToken, async (req, res) => {
  try {
    const { mode, status, instructor_id } = req.query;
    let query = `
      SELECT c.*, u.name as instructor_name
      FROM courses c
      LEFT JOIN instructors i ON c.instructor_id = i.id
      LEFT JOIN users u ON i.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (mode) {
      query += ' AND c.mode = ?';
      params.push(mode);
    }
    if (status) {
      query += ' AND c.status = ?';
      params.push(status);
    }
    if (instructor_id) {
      query += ' AND c.instructor_id = ?';
      params.push(instructor_id);
    }

    query += ' ORDER BY c.created_at DESC';

    const courses = await db.all(query, params);
    res.json({ courses });
  } catch (error) {
    console.error('Get courses error:', error);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

// Get single course
router.get('/courses/:id', authenticateToken, async (req, res) => {
  try {
    const courseId = req.params.id;

    const course = await db.get(
      `SELECT c.*, u.name as instructor_name
       FROM courses c
       LEFT JOIN instructors i ON c.instructor_id = i.id
       LEFT JOIN users u ON i.user_id = u.id
       WHERE c.id = ? OR c.course_code = ?`,
      [courseId, courseId]
    );

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    res.json({ course });
  } catch (error) {
    console.error('Get course error:', error);
    res.status(500).json({ error: 'Failed to fetch course' });
  }
});

// Create course
router.post('/courses', authenticateToken, requireRole('Admin', 'Instructor', 'DepartmentHead', 'Staff'), [
  body('course_code').trim().notEmpty(),
  body('title').trim().notEmpty(),
  body('mode').isIn(['Online', 'In-person', 'Hybrid'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      course_code, title, description, instructor_id, mode,
      materials, start_date, end_date, max_students, status,
      course_fee
    } = req.body;

    // Check if course code exists
    const existing = await db.get('SELECT id FROM courses WHERE course_code = ?', [course_code]);
    if (existing) {
      return res.status(400).json({ error: 'Course code already exists' });
    }

    // Check if user is Academy staff
    const academyStaff = await isAcademyStaff(req.user);
    
    // Only Admin and Academy staff can create courses
    if (!academyStaff && req.user.role !== 'Admin') {
      return res.status(403).json({ error: 'Only Academy staff and Admins can create courses' });
    }

    // If course_fee is provided and user is not admin, require admin approval
    const feeApproved = req.user.role === 'Admin' ? 1 : (course_fee ? 0 : null);
    const createdBy = academyStaff ? req.user.id : null;

    const result = await db.run(
      `INSERT INTO courses (course_code, title, description, instructor_id, mode, materials,
        start_date, end_date, max_students, status, course_fee, fee_approved, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        course_code, title, description || null, instructor_id || null,
        mode, materials ? JSON.stringify(materials) : null,
        start_date || null, end_date || null, max_students || null,
        status || 'Active', course_fee || 0, feeApproved, createdBy
      ]
    );

    await logAction(req.user.id, 'create_course', 'academy', result.lastID, { course_code }, req);

    res.status(201).json({
      message: 'Course created successfully',
      course: { id: result.lastID, course_code }
    });
  } catch (error) {
    console.error('Create course error:', error);
    res.status(500).json({ error: 'Failed to create course' });
  }
});

// Update course
router.put('/courses/:id', authenticateToken, requireRole('Admin', 'Instructor', 'DepartmentHead', 'Staff'), async (req, res) => {
  try {
    const courseId = req.params.id;
    const updates = req.body;

    const course = await db.get('SELECT id FROM courses WHERE id = ?', [courseId]);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Check if user is Academy staff or Admin
    const academyStaff = await isAcademyStaff(req.user);
    if (!academyStaff && req.user.role !== 'Admin' && req.user.role !== 'Instructor') {
      return res.status(403).json({ error: 'Only Academy staff, Instructors, and Admins can edit courses' });
    }
    
    // Only Admin can change fee_approved status
    if (updates.fee_approved !== undefined && req.user.role !== 'Admin') {
      return res.status(403).json({ error: 'Only Admin can approve/reject course fees' });
    }

    // Check if course code is being changed and conflicts
    if (updates.course_code) {
      const existing = await db.get('SELECT id FROM courses WHERE course_code = ? AND id != ?', [updates.course_code, courseId]);
      if (existing) {
        return res.status(400).json({ error: 'Course code already exists' });
      }
    }

    const allowedFields = ['course_code', 'title', 'description', 'instructor_id', 'mode',
      'materials', 'start_date', 'end_date', 'max_students', 'status'];
    const updateFields = [];
    const params = [];

    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        updateFields.push(`${field} = ?`);
        if (field === 'materials') {
          params.push(JSON.stringify(updates[field]));
        } else {
          params.push(updates[field]);
        }
      }
    });

    if (updateFields.length > 0) {
      params.push(courseId);
      await db.run(`UPDATE courses SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params);
    }

    await logAction(req.user.id, 'update_course', 'academy', courseId, updates, req);

    res.json({ message: 'Course updated successfully' });
  } catch (error) {
    console.error('Update course error:', error);
    res.status(500).json({ error: 'Failed to update course' });
  }
});

// Delete course
router.delete('/courses/:id', authenticateToken, requireRole('Admin'), async (req, res) => {
  try {
    const courseId = req.params.id;

    const course = await db.get('SELECT id FROM courses WHERE id = ?', [courseId]);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Check if course has enrollments
    const enrollments = await db.get('SELECT COUNT(*) as count FROM enrollments WHERE course_id = ?', [courseId]);
    if (enrollments.count > 0) {
      return res.status(400).json({ error: 'Cannot delete course with enrolled students' });
    }

    await db.run('DELETE FROM courses WHERE id = ?', [courseId]);

    await logAction(req.user.id, 'delete_course', 'academy', courseId, {}, req);

    res.json({ message: 'Course deleted successfully' });
  } catch (error) {
    console.error('Delete course error:', error);
    res.status(500).json({ error: 'Failed to delete course' });
  }
});

// ========== ENROLLMENTS ==========

// Enroll student in course
router.post('/enrollments', authenticateToken, requireRole('Admin', 'Instructor'), [
  body('student_id').isInt(),
  body('course_id').isInt()
], async (req, res) => {
  try {
    const { student_id, course_id } = req.body;

    // Check if already enrolled
    const existing = await db.get(
      'SELECT id FROM enrollments WHERE student_id = ? AND course_id = ?',
      [student_id, course_id]
    );
    if (existing) {
      return res.status(400).json({ error: 'Student already enrolled in this course' });
    }

    const result = await db.run(
      `INSERT INTO enrollments (student_id, course_id, enrollment_date, status)
       VALUES (?, ?, CURRENT_DATE, 'Enrolled')`,
      [student_id, course_id]
    );

    await logAction(req.user.id, 'enroll_student', 'academy', result.lastID, { student_id, course_id }, req);

    res.status(201).json({ message: 'Student enrolled successfully', enrollmentId: result.lastID });
  } catch (error) {
    console.error('Enroll error:', error);
    res.status(500).json({ error: 'Failed to enroll student' });
  }
});

// Get enrollments for a student
router.get('/students/:id/enrollments', authenticateToken, async (req, res) => {
  try {
    const studentId = req.params.id;

    const enrollments = await db.all(
      `SELECT e.*, c.course_code, c.title, c.mode
       FROM enrollments e
       JOIN courses c ON e.course_id = c.id
       WHERE e.student_id = ?
       ORDER BY e.enrollment_date DESC`,
      [studentId]
    );

    res.json({ enrollments });
  } catch (error) {
    console.error('Get enrollments error:', error);
    res.status(500).json({ error: 'Failed to fetch enrollments' });
  }
});

// Get enrolled courses (student_course_enrollments) for a student — for grade submission
router.get('/students/:id/enrolled-courses', authenticateToken, async (req, res) => {
  try {
    const studentId = req.params.id;
    const rows = await db.all(
      `SELECT e.course_id, c.course_code, c.title, e.status as enrollment_status
       FROM student_course_enrollments e
       JOIN courses c ON e.course_id = c.id
       WHERE e.student_id = ? AND e.status != 'Dropped'
       ORDER BY c.course_code`,
      [studentId]
    );
    res.json({ courses: rows });
  } catch (e) {
    console.error('Get enrolled-courses error:', e);
    res.status(500).json({ error: 'Failed to fetch enrolled courses' });
  }
});

// ========== CERTIFICATES ==========

// Create certificate
router.post('/certificates', authenticateToken, requireRole('Admin', 'Instructor'), [
  body('student_id').isInt(),
  body('course_id').isInt(),
  body('grade').trim().notEmpty()
], async (req, res) => {
  try {
    const { student_id, course_id, grade, issue_date } = req.body;

    // Check if enrollment exists and is completed
    const enrollment = await db.get(
      'SELECT id FROM enrollments WHERE student_id = ? AND course_id = ?',
      [student_id, course_id]
    );
    if (!enrollment) {
      return res.status(400).json({ error: 'Student not enrolled in this course' });
    }

    const certificateId = generateCertificateId();
    const verificationCode = crypto.randomBytes(16).toString('hex').toUpperCase();

    const result = await db.run(
      `INSERT INTO certificates (certificate_id, student_id, course_id, issue_date, grade, verification_code)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        certificateId, student_id, course_id,
        issue_date || new Date().toISOString().split('T')[0],
        grade, verificationCode
      ]
    );

    // Update enrollment status
    await db.run(
      'UPDATE enrollments SET status = ?, completion_date = CURRENT_DATE WHERE student_id = ? AND course_id = ?',
      ['Completed', student_id, course_id]
    );

    await logAction(req.user.id, 'create_certificate', 'academy', result.lastID, { certificateId }, req);

    const stu = await db.get('SELECT user_id FROM students WHERE id = ?', [student_id]);
    if (stu) {
      try {
        const crs = await db.get('SELECT course_code, title FROM courses WHERE id = ?', [course_id]);
        await sendNotificationToUser(stu.user_id, {
          title: 'Certificate issued',
          message: `A certificate has been issued for ${crs ? crs.title || crs.course_code : 'your course'}.`,
          type: 'info',
          link: '/student/certificates',
          senderId: req.user.id
        });
      } catch (e) { console.error('Certificate notify student error:', e); }
    }

    res.status(201).json({
      message: 'Certificate created successfully',
      certificate: { id: result.lastID, certificate_id: certificateId, verification_code: verificationCode }
    });
  } catch (error) {
    console.error('Create certificate error:', error);
    res.status(500).json({ error: 'Failed to create certificate' });
  }
});

// Verify certificate (public endpoint - no auth required)
router.get('/certificates/verify/:code', async (req, res) => {
  try {
    const code = req.params.code;

    const certificate = await db.get(
      `SELECT c.*, s.student_id, u.name as student_name, co.course_code, co.title
       FROM certificates c
       JOIN students s ON c.student_id = s.id
       JOIN users u ON s.user_id = u.id
       JOIN courses co ON c.course_id = co.id
       WHERE c.verification_code = ?`,
      [code]
    );

    if (!certificate) {
      return res.status(404).json({ error: 'Certificate not found or invalid verification code' });
    }

    res.json({
      valid: true,
      certificate: {
        certificate_id: certificate.certificate_id,
        student_name: certificate.student_name,
        student_id: certificate.student_id,
        course_code: certificate.course_code,
        course_title: certificate.title,
        issue_date: certificate.issue_date,
        grade: certificate.grade
      }
    });
  } catch (error) {
    console.error('Verify certificate error:', error);
    res.status(500).json({ error: 'Failed to verify certificate' });
  }
});

// ========== GRADES (submit + admin approval) ==========

/** Keep enrollments in sync when an approved grade value or student/course changes */
async function applyEnrollmentGradeFromSubmission(studentId, courseId, gradeVal) {
  const enrollExists = await db.get(
    'SELECT 1 FROM enrollments WHERE student_id = ? AND course_id = ?',
    [studentId, courseId]
  );
  if (!enrollExists) {
    await db.run(
      `INSERT INTO enrollments (student_id, course_id, enrollment_date, status, grade, completion_date) VALUES (?, ?, CURRENT_DATE, 'Completed', ?, CURRENT_DATE)`,
      [studentId, courseId, gradeVal]
    );
  } else {
    await db.run(
      `UPDATE enrollments SET grade = ?, status = 'Completed', completion_date = CURRENT_DATE WHERE student_id = ? AND course_id = ?`,
      [gradeVal, studentId, courseId]
    );
  }
}

/** Revert enrollment when an approved grade submission is deleted or moved away from this pair */
async function clearEnrollmentAfterApprovedGradeRemoved(studentId, courseId) {
  await db.run(
    `UPDATE enrollments SET grade = NULL, status = 'Enrolled', completion_date = NULL WHERE student_id = ? AND course_id = ?`,
    [studentId, courseId]
  );
}

// POST /api/academy/grades/submit (Instructor + Academy staff)
router.post('/grades/submit', authenticateToken, [
  body('student_id').isInt().withMessage('student_id is required'),
  body('course_id').isInt().withMessage('course_id is required'),
  body('proposed_grade').trim().notEmpty().withMessage('proposed_grade is required')
], async (req, res) => {
  try {
    const academyStaff = await isAcademyStaff(req.user);
    if (req.user.role !== 'Instructor' && !academyStaff) {
      return res.status(403).json({ error: 'Only Instructors and Academy staff can submit grades' });
    }
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    const { student_id, course_id, proposed_grade } = req.body;

    const enroll = await db.get(
      'SELECT id FROM student_course_enrollments WHERE student_id = ? AND course_id = ? AND status != ?',
      [student_id, course_id, 'Dropped']
    );
    if (!enroll) return res.status(400).json({ error: 'Student is not enrolled in this course' });

    const run = await db.run(
      `INSERT INTO grade_submissions (student_id, course_id, proposed_grade, status, submitted_by, created_at, updated_at)
       VALUES (?, ?, ?, 'Pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [student_id, course_id, String(proposed_grade).trim(), req.user.id]
    );

    await logAction(req.user.id, 'submit_grade', 'academy', run.lastID, { student_id, course_id, proposed_grade }, req);

    try {
      await sendNotificationToRole('Admin', {
        title: 'New grade submission',
        message: `Grade "${proposed_grade}" submitted for student/course.`,
        type: 'info',
        link: '/academy?grades=pending',
        senderId: req.user.id
      });
    } catch (e) { console.error('Grade submit notify Admin error:', e); }

    res.status(201).json({ message: 'Grade submitted for approval', submission: { id: run.lastID, status: 'Pending' } });
  } catch (e) {
    console.error('Grade submit error:', e);
    res.status(500).json({ error: 'Failed to submit grade' });
  }
});

// GET /api/academy/grades/pending (Admin + Academy staff — view queue; approve/reject remains Admin-only)
router.get('/grades/pending', authenticateToken, async (req, res) => {
  try {
    const academyStaff = await isAcademyStaff(req.user);
    if (req.user.role !== 'Admin' && !academyStaff) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const rows = await db.all(
      `SELECT g.id, g.student_id, g.course_id, g.proposed_grade, g.status, g.submitted_by, g.created_at,
              s.student_id as student_code, u.name as student_name, u.email as student_email,
              c.course_code, c.title as course_title,
              sub.name as submitted_by_name
       FROM grade_submissions g
       JOIN students s ON g.student_id = s.id
       JOIN users u ON s.user_id = u.id
       JOIN courses c ON g.course_id = c.id
       LEFT JOIN users sub ON g.submitted_by = sub.id
       WHERE g.status = 'Pending'
       ORDER BY g.created_at ASC`
    );
    res.json({ pending: rows });
  } catch (e) {
    console.error('Grades pending error:', e);
    res.status(500).json({ error: 'Failed to fetch pending grades' });
  }
});

// GET /api/academy/grades/approved — all admin-approved grades (Admin + Academy staff)
router.get('/grades/approved', authenticateToken, async (req, res) => {
  try {
    const academyStaff = await isAcademyStaff(req.user);
    if (req.user.role !== 'Admin' && !academyStaff) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const { cohort_id, course_id, student_id, search } = req.query;
    let query = `
      SELECT g.id, g.student_id, g.course_id, g.proposed_grade as grade, g.approved_at,
             s.student_id as student_code, u.name as student_name, u.email as student_email,
             ch.id as cohort_id, ch.name as cohort_name, ch.code as cohort_code,
             c.course_code, c.title as course_title
      FROM grade_submissions g
      JOIN students s ON g.student_id = s.id
      JOIN users u ON s.user_id = u.id
      LEFT JOIN cohorts ch ON s.cohort_id = ch.id
      JOIN courses c ON g.course_id = c.id
      WHERE g.status = 'Approved'
    `;
    const params = [];
    if (cohort_id) {
      query += ' AND s.cohort_id = ?';
      params.push(cohort_id);
    }
    if (course_id) {
      query += ' AND g.course_id = ?';
      params.push(course_id);
    }
    if (student_id) {
      query += ' AND g.student_id = ?';
      params.push(student_id);
    }
    if (search && String(search).trim()) {
      const term = `%${String(search).trim()}%`;
      query += ' AND (u.name LIKE ? OR s.student_id LIKE ? OR u.email LIKE ?)';
      params.push(term, term, term);
    }
    query += ' ORDER BY u.name ASC, c.course_code ASC';
    const rows = await db.all(query, params);
    res.json({ grades: rows });
  } catch (e) {
    console.error('Grades approved list error:', e);
    res.status(500).json({ error: 'Failed to fetch approved grades' });
  }
});

// PUT /api/academy/grades/:id/approve (Admin)
router.put('/grades/:id/approve', authenticateToken, requireRole('Admin'), [
  body('notes').optional().trim()
], async (req, res) => {
  try {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    const id = req.params.id;
    const notes = req.body.notes || null;

    const g = await db.get('SELECT id, student_id, course_id, proposed_grade, status, submitted_by FROM grade_submissions WHERE id = ?', [id]);
    if (!g) return res.status(404).json({ error: 'Grade submission not found' });
    if (g.status !== 'Pending') return res.status(400).json({ error: 'Submission is not pending' });

    await db.run(
      `UPDATE grade_submissions SET status = 'Approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [req.user.id, notes, id]
    );

    const gradeVal = g.proposed_grade;
    await applyEnrollmentGradeFromSubmission(g.student_id, g.course_id, gradeVal);

    const student = await db.get('SELECT user_id FROM students WHERE id = ?', [g.student_id]);
    if (student) {
      try {
        const c = await db.get('SELECT course_code, title FROM courses WHERE id = ?', [g.course_id]);
        await sendNotificationToUser(student.user_id, {
          title: 'Grade approved',
          message: `Your grade ${gradeVal} for ${c ? c.title || c.course_code : 'course'} has been approved.`,
          type: 'info',
          link: '/student/grades',
          senderId: req.user.id
        });
      } catch (e) { console.error('Grade approve notify student error:', e); }
    }

    await logAction(req.user.id, 'approve_grade', 'academy', id, { proposed_grade: gradeVal }, req);
    res.json({ message: 'Grade approved', submission: { id: parseInt(id, 10), status: 'Approved' } });
  } catch (e) {
    console.error('Grade approve error:', e);
    res.status(500).json({ error: 'Failed to approve grade' });
  }
});

// PUT /api/academy/grades/:id/reject (Admin)
router.put('/grades/:id/reject', authenticateToken, requireRole('Admin'), [
  body('notes').optional().trim()
], async (req, res) => {
  try {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    const id = req.params.id;
    const notes = req.body.notes || null;

    const g = await db.get('SELECT id, student_id, course_id, proposed_grade, status, submitted_by FROM grade_submissions WHERE id = ?', [id]);
    if (!g) return res.status(404).json({ error: 'Grade submission not found' });
    if (g.status !== 'Pending') return res.status(400).json({ error: 'Submission is not pending' });

    await db.run(
      `UPDATE grade_submissions SET status = 'Rejected', approved_by = ?, approved_at = CURRENT_TIMESTAMP, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [req.user.id, notes, id]
    );

    const student = await db.get('SELECT user_id FROM students WHERE id = ?', [g.student_id]);
    if (student) {
      try {
        await sendNotificationToUser(student.user_id, {
          title: 'Grade rejected',
          message: `Your grade submission was rejected. ${notes ? `Reason: ${notes}` : ''}`,
          type: 'warning',
          link: '/student/grades',
          senderId: req.user.id
        });
      } catch (e) { console.error('Grade reject notify student error:', e); }
    }
    if (g.submitted_by) {
      try {
        await sendNotificationToUser(g.submitted_by, {
          title: 'Grade submission rejected',
          message: `Your grade submission was rejected. ${notes ? `Reason: ${notes}` : ''}`,
          type: 'warning',
          link: '/academy',
          senderId: req.user.id
        });
      } catch (e) { console.error('Grade reject notify submitter error:', e); }
    }

    await logAction(req.user.id, 'reject_grade', 'academy', id, {}, req);
    res.json({ message: 'Grade rejected', submission: { id: parseInt(id, 10), status: 'Rejected' } });
  } catch (e) {
    console.error('Grade reject error:', e);
    res.status(500).json({ error: 'Failed to reject grade' });
  }
});

// PUT /api/academy/grades/:id (Admin — edit pending or approved submission)
router.put('/grades/:id', authenticateToken, requireRole('Admin'), [
  body('proposed_grade').trim().notEmpty().withMessage('proposed_grade is required'),
  body('student_id').optional().isInt(),
  body('course_id').optional().isInt()
], async (req, res) => {
  try {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const g = await db.get(
      'SELECT id, student_id, course_id, proposed_grade, status FROM grade_submissions WHERE id = ?',
      [id]
    );
    if (!g) return res.status(404).json({ error: 'Grade submission not found' });
    if (g.status === 'Rejected') {
      return res.status(400).json({ error: 'Cannot edit a rejected submission' });
    }

    const proposed_grade = String(req.body.proposed_grade).trim();
    const student_id = req.body.student_id !== undefined ? parseInt(req.body.student_id, 10) : g.student_id;
    const course_id = req.body.course_id !== undefined ? parseInt(req.body.course_id, 10) : g.course_id;

    if (Number.isNaN(student_id) || Number.isNaN(course_id)) {
      return res.status(400).json({ error: 'Invalid student_id or course_id' });
    }

    const enroll = await db.get(
      'SELECT id FROM student_course_enrollments WHERE student_id = ? AND course_id = ? AND status != ?',
      [student_id, course_id, 'Dropped']
    );
    if (!enroll) {
      return res.status(400).json({ error: 'Student is not enrolled in this course' });
    }

    const conflict = await db.get(
      `SELECT id FROM grade_submissions WHERE student_id = ? AND course_id = ? AND id != ? AND status != 'Rejected'`,
      [student_id, course_id, id]
    );
    if (conflict) {
      return res.status(400).json({ error: 'Another grade submission already exists for this student and course' });
    }

    const oldStudent = g.student_id;
    const oldCourse = g.course_id;
    const wasApproved = g.status === 'Approved';

    if (wasApproved && (oldStudent !== student_id || oldCourse !== course_id)) {
      await clearEnrollmentAfterApprovedGradeRemoved(oldStudent, oldCourse);
    }

    await db.run(
      `UPDATE grade_submissions SET student_id = ?, course_id = ?, proposed_grade = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [student_id, course_id, proposed_grade, id]
    );

    if (g.status === 'Approved') {
      await applyEnrollmentGradeFromSubmission(student_id, course_id, proposed_grade);
    }

    await logAction(
      req.user.id,
      'update_grade_submission',
      'academy',
      id,
      { proposed_grade, student_id, course_id, previous: { student_id: oldStudent, course_id: oldCourse } },
      req
    );
    res.json({
      message: 'Grade submission updated',
      submission: { id, status: g.status, proposed_grade, student_id, course_id }
    });
  } catch (e) {
    console.error('Grade update error:', e);
    res.status(500).json({ error: 'Failed to update grade submission' });
  }
});

// DELETE /api/academy/grades/:id (Admin — delete pending or approved submission)
router.delete('/grades/:id', authenticateToken, requireRole('Admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const g = await db.get(
      'SELECT id, student_id, course_id, status FROM grade_submissions WHERE id = ?',
      [id]
    );
    if (!g) return res.status(404).json({ error: 'Grade submission not found' });

    if (g.status === 'Approved') {
      await clearEnrollmentAfterApprovedGradeRemoved(g.student_id, g.course_id);
    }

    await db.run('DELETE FROM grade_submissions WHERE id = ?', [id]);
    await logAction(req.user.id, 'delete_grade_submission', 'academy', id, { status: g.status }, req);
    res.json({ message: 'Grade submission deleted' });
  } catch (e) {
    console.error('Grade delete error:', e);
    res.status(500).json({ error: 'Failed to delete grade submission' });
  }
});

// ========== ADMIN APPROVAL ENDPOINTS ==========

// Approve/reject course fee (Admin only)
router.put('/courses/:id/approve-fee', authenticateToken, requireRole('Admin'), [
  body('approved').isBoolean().withMessage('Approved status is required'),
  body('admin_notes').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { approved, admin_notes } = req.body;

    const course = await db.get('SELECT id, fee_approved FROM courses WHERE id = ?', [req.params.id]);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const feeApproved = approved ? 1 : 2; // 1 = Approved, 2 = Rejected
    
    await db.run(
      `UPDATE courses 
       SET fee_approved = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP, admin_notes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [feeApproved, req.user.id, admin_notes || null, req.params.id]
    );

    await logAction(req.user.id, approved ? 'approve_course_fee' : 'reject_course_fee', 'academy', req.params.id, { approved }, req);

    res.json({ message: `Course fee ${approved ? 'approved' : 'rejected'} successfully` });
  } catch (error) {
    console.error('Approve course fee error:', error);
    res.status(500).json({ error: 'Failed to process approval' });
  }
});

// Approve/reject instructor (Admin only)
router.put('/instructors/:id/approve', authenticateToken, requireRole('Admin'), [
  body('approved').isBoolean().withMessage('Approved status is required'),
  body('admin_notes').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { approved, admin_notes } = req.body;

    const instructor = await db.get('SELECT id, user_id, approved FROM instructors WHERE id = ?', [req.params.id]);
    if (!instructor) {
      return res.status(404).json({ error: 'Instructor not found' });
    }

    const approvedStatus = approved ? 1 : 2; // 1 = Approved, 2 = Rejected
    
    await db.run(
      `UPDATE instructors 
       SET approved = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP, admin_notes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [approvedStatus, req.user.id, admin_notes || null, req.params.id]
    );

    // Update user account to active if approved, inactive if rejected
    await db.run(
      `UPDATE users SET is_active = ? WHERE id = ?`,
      [approved ? 1 : 0, instructor.user_id]
    );

    await logAction(req.user.id, approved ? 'approve_instructor' : 'reject_instructor', 'academy', req.params.id, { approved }, req);

    res.json({ message: `Instructor ${approved ? 'approved' : 'rejected'} successfully` });
  } catch (error) {
    console.error('Approve instructor error:', error);
    res.status(500).json({ error: 'Failed to process approval' });
  }
});

// ========== COHORTS ==========

// Generate unique cohort code
function generateCohortCode(name, startDate) {
  const year = startDate ? new Date(startDate).getFullYear() : new Date().getFullYear();
  const month = startDate ? new Date(startDate).getMonth() + 1 : new Date().getMonth() + 1;
  const nameAbbr = name.substring(0, 3).toUpperCase();
  return `${nameAbbr}-${year}-${String(month).padStart(2, '0')}`;
}

// Get all cohorts
router.get('/cohorts', authenticateToken, async (req, res) => {
  try {
    const { status, search } = req.query;
    let query = 'SELECT c.*, u.name as created_by_name FROM cohorts c LEFT JOIN users u ON c.created_by = u.id WHERE 1=1';
    const params = [];

    if (status) {
      query += ' AND c.status = ?';
      params.push(status);
    }
    if (search) {
      query += ' AND (c.name LIKE ? OR c.code LIKE ? OR c.period LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    query += ' ORDER BY c.start_date DESC, c.created_at DESC';

    const cohorts = await db.all(query, params);
    res.json({ cohorts });
  } catch (error) {
    console.error('Get cohorts error:', error);
    res.status(500).json({ error: 'Failed to fetch cohorts' });
  }
});

// Get single cohort
router.get('/cohorts/:id', authenticateToken, async (req, res) => {
  try {
    const cohort = await db.get(
      'SELECT c.*, u.name as created_by_name FROM cohorts c LEFT JOIN users u ON c.created_by = u.id WHERE c.id = ?',
      [req.params.id]
    );

    if (!cohort) {
      return res.status(404).json({ error: 'Cohort not found' });
    }

    res.json({ cohort });
  } catch (error) {
    console.error('Get cohort error:', error);
    res.status(500).json({ error: 'Failed to fetch cohort' });
  }
});

// Create cohort
router.post('/cohorts', authenticateToken, requireRole('Admin', 'Instructor', 'DepartmentHead', 'Staff'), [
  body('name').trim().notEmpty().withMessage('Cohort name is required'),
  body('start_date').optional().isISO8601().withMessage('Invalid start date format'),
  body('end_date').optional().isISO8601().withMessage('Invalid end date format'),
  body('period').optional().trim(),
  body('status').optional().isIn(['Active', 'Completed', 'Cancelled']).withMessage('Invalid status')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      name,
      start_date,
      end_date,
      period,
      description,
      status,
      cert_access_enabled,
      cert_access_start,
      cert_access_end
    } = req.body;

    // Check if user is Academy staff
    const academyStaff = await isAcademyStaff(req.user);
    if (!academyStaff && req.user.role !== 'Admin') {
      return res.status(403).json({ error: 'Only Academy staff and Admins can create cohorts' });
    }

    // Generate unique code
    const code = generateCohortCode(name, start_date);

    // Check if code already exists, append number if needed
    let finalCode = code;
    let counter = 1;
    while (true) {
      const existing = await db.get('SELECT id FROM cohorts WHERE code = ?', [finalCode]);
      if (!existing) break;
      finalCode = `${code}-${counter}`;
      counter++;
    }

    const result = await db.run(
      `INSERT INTO cohorts (
        name, code, start_date, end_date, period, description, status,
        cert_access_enabled, cert_access_start, cert_access_end,
        created_by, created_at, updated_at
      )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        name,
        finalCode,
        start_date || null,
        end_date || null,
        period || null,
        description || null,
        status || 'Active',
        cert_access_enabled ? 1 : 0,
        cert_access_start || null,
        cert_access_end || null,
        req.user.id
      ]
    );

    const cohort = await db.get(
      'SELECT c.*, u.name as created_by_name FROM cohorts c LEFT JOIN users u ON c.created_by = u.id WHERE c.id = ?',
      [result.lastID]
    );

    await logAction(req.user.id, 'create_cohort', 'academy', result.lastID, { name, code: finalCode }, req);

    res.status(201).json({ cohort, message: 'Cohort created successfully' });
  } catch (error) {
    console.error('Create cohort error:', error);
    res.status(500).json({ error: 'Failed to create cohort' });
  }
});

// Update cohort
router.put('/cohorts/:id', authenticateToken, requireRole('Admin', 'Instructor', 'DepartmentHead', 'Staff'), async (req, res) => {
  try {
    const cohortId = req.params.id;
    const updates = req.body;

    const cohort = await db.get('SELECT id FROM cohorts WHERE id = ?', [cohortId]);
    if (!cohort) {
      return res.status(404).json({ error: 'Cohort not found' });
    }

    // Check if user is Academy staff or Admin
    const academyStaff = await isAcademyStaff(req.user);
    if (!academyStaff && req.user.role !== 'Admin') {
      return res.status(403).json({ error: 'Only Academy staff and Admins can edit cohorts' });
    }

    const allowedUpdates = [
      'name',
      'start_date',
      'end_date',
      'period',
      'description',
      'status',
      'cert_access_enabled',
      'cert_access_start',
      'cert_access_end'
    ];
    const updateFields = [];
    const updateParams = [];

    for (const field of allowedUpdates) {
      if (updates[field] !== undefined) {
        updateFields.push(`${field} = ?`);
        if (field === 'cert_access_enabled') {
          updateParams.push(updates[field] ? 1 : 0);
        } else {
          updateParams.push(updates[field]);
        }
      }
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateParams.push(cohortId);

    await db.run(
      `UPDATE cohorts SET ${updateFields.join(', ')} WHERE id = ?`,
      updateParams
    );

    await logAction(req.user.id, 'update_cohort', 'academy', cohortId, updates, req);

    const updatedCohort = await db.get(
      'SELECT c.*, u.name as created_by_name FROM cohorts c LEFT JOIN users u ON c.created_by = u.id WHERE c.id = ?',
      [cohortId]
    );

    res.json({ cohort: updatedCohort, message: 'Cohort updated successfully' });
  } catch (error) {
    console.error('Update cohort error:', error);
    res.status(500).json({ error: 'Failed to update cohort' });
  }
});

// Delete cohort
router.delete('/cohorts/:id', authenticateToken, requireRole('Admin', 'Instructor', 'DepartmentHead', 'Staff'), async (req, res) => {
  try {
    const cohortId = req.params.id;

    const cohort = await db.get('SELECT id FROM cohorts WHERE id = ?', [cohortId]);
    if (!cohort) {
      return res.status(404).json({ error: 'Cohort not found' });
    }

    // Check if user is Academy staff or Admin
    const academyStaff = await isAcademyStaff(req.user);
    if (!academyStaff && req.user.role !== 'Admin') {
      return res.status(403).json({ error: 'Only Academy staff and Admins can delete cohorts' });
    }

    // Check if cohort has students
    const studentsCount = await db.get('SELECT COUNT(*) as count FROM students WHERE cohort_id = ?', [cohortId]);
    if (studentsCount && studentsCount.count > 0) {
      return res.status(400).json({ error: `Cannot delete cohort. ${studentsCount.count} student(s) are assigned to this cohort.` });
    }

    await db.run('DELETE FROM cohorts WHERE id = ?', [cohortId]);

    await logAction(req.user.id, 'delete_cohort', 'academy', cohortId, { name: cohort.name }, req);

    res.json({ message: 'Cohort deleted successfully' });
  } catch (error) {
    console.error('Delete cohort error:', error);
    res.status(500).json({ error: 'Failed to delete cohort' });
  }
});

module.exports = router;

