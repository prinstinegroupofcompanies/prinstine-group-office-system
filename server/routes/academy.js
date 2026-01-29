const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticateToken, requireRole, getFinanceAccessUserIds } = require('../utils/auth');
const { logAction } = require('../utils/audit');
const { sendBulkNotifications, sendNotificationToUser, sendNotificationToRole } = require('../utils/notifications');
const crypto = require('crypto');

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

// Helper function to check if user is Academy staff (Academy, eLearning, or Marketing department)
// Includes: Admin, Academy Department Head, Marketing Department Head, and Assistant Academy Coordinator (Staff in Academy department)
async function isAcademyStaff(user) {
  if (!user) return false;
  
  // Admin always has access
  if (user.role === 'Admin') {
    return true;
  }
  
  // Explicit email check for Assistant Academy Coordinator (cvulue@prinstinegroup.org)
  // This ensures the user has full academy rights regardless of department field
  const userEmail = (user.email || '').toLowerCase().trim();
  const academyCoordinatorEmails = ['cvulue@prinstinegroup.org'];
  if (academyCoordinatorEmails.includes(userEmail)) {
    console.log(`[isAcademyStaff] User ${userEmail} identified as Assistant Academy Coordinator via email`);
    return true;
  }
  
  // Check if DepartmentHead manages Academy department (Academy Department Head)
  if (user.role === 'DepartmentHead') {
    try {
      const deptTableInfo = await db.all("PRAGMA table_info(departments)");
      const deptColumnNames = deptTableInfo.map(col => col.name);
      const hasHeadEmail = deptColumnNames.includes('head_email');
      
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
        const deptName = dept.name.toLowerCase();
        if (deptName.includes('academy') || deptName.includes('elearning') || deptName.includes('e-learning') || deptName.includes('marketing')) {
          return true;
        }
      }
    } catch (error) {
      console.error('Error checking department head department:', error);
    }
  }
  
  // Check if Staff belongs to Academy department (Assistant Academy Coordinator)
  // Assistant Academy Coordinator = Staff member in Academy/eLearning department
  // They have the same managing rights as Academy Department Head
  if (user.role === 'Staff') {
    try {
      const staff = await db.get('SELECT department, position FROM staff WHERE user_id = ?', [user.id]);
      if (staff) {
        const deptName = (staff.department || '').toLowerCase();
        const positionName = (staff.position || '').toLowerCase();
        
        // Check if staff is in Academy department
        if (deptName.includes('academy') || deptName.includes('elearning') || deptName.includes('e-learning')) {
          console.log(`[isAcademyStaff] User ${userEmail} identified as Academy staff via department: ${staff.department}`);
          return true;
        }
        
        // Also check if position title indicates Academy Coordinator (additional check)
        if (positionName.includes('academy') && positionName.includes('coordinator')) {
          console.log(`[isAcademyStaff] User ${userEmail} identified as Academy Coordinator via position: ${staff.position}`);
          return true;
        }
      }
    } catch (error) {
      console.error('Error checking staff department:', error);
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
              c.course_code, c.title
       FROM grade_submissions g
       JOIN courses c ON g.course_id = c.id
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

// GET /api/academy/students/me/certificates — certificates with safe download URLs
router.get('/students/me/certificates', authenticateToken, requireRole('Student'), async (req, res) => {
  try {
    const student = await getCurrentStudent(req);
    if (!student) return res.status(404).json({ error: 'Student record not found or not approved' });
    const certs = await db.all(
      `SELECT c.id, c.certificate_id, c.course_id, c.issue_date, c.grade, c.verification_code, c.pdf_path,
              co.course_code, co.title as course_title
       FROM certificates c
       JOIN courses co ON c.course_id = co.id
       WHERE c.student_id = ?
       ORDER BY c.issue_date DESC`,
      [student.id]
    );
    const withUrls = certs.map((cert) => ({
      ...cert,
      download_url: cert.pdf_path
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
    const cert = await db.get(
      'SELECT id, pdf_path, student_id FROM certificates WHERE id = ? AND student_id = ?',
      [req.params.id, student.id]
    );
    if (!cert) return res.status(404).json({ error: 'Certificate not found' });
    if (!cert.pdf_path) return res.status(404).json({ error: 'Certificate file not available' });
    const path = require('path');
    const fs = require('fs');
    const fullPath = path.isAbsolute(cert.pdf_path) ? cert.pdf_path : path.join(process.cwd(), cert.pdf_path);
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'Certificate file not found' });
    res.sendFile(fullPath, { headers: { 'Content-Disposition': 'attachment; filename=certificate.pdf' } });
  } catch (e) {
    console.error('Certificate download error:', e);
    res.status(500).json({ error: 'Download failed' });
  }
});

// Get all students
router.get('/students', authenticateToken, async (req, res) => {
  try {
    const { status, search, pending_approval, cohort_id, period, start_date, end_date } = req.query;
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

    query += ' ORDER BY s.created_at DESC';

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

    const normEmail = (email || '').toString().toLowerCase().trim();
    const existingUser = await db.get('SELECT id FROM users WHERE LOWER(TRIM(email)) = ?', [normEmail]);
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // Check if user is Academy staff
    const academyStaff = await isAcademyStaff(req.user);
    
    // Only Admin and Academy staff can create students
    if (!academyStaff && req.user.role !== 'Admin') {
      return res.status(403).json({ error: 'Only Academy staff and Admins can create students' });
    }

    // If created by Academy staff (not admin), require admin approval
    // 0 = Pending, 1 = Approved, 2 = Rejected
    const approved = req.user.role === 'Admin' ? 1 : 0;

    const { hashPassword } = require('../utils/auth');
    const passwordHash = await hashPassword(password || 'Student@123');
    const emailToStore = normEmail || (email || '').toString().trim() || null;

    // Create user - if pending approval, set is_active to 0
    const userResult = await db.run(
      `INSERT INTO users (email, username, password_hash, role, name, phone, profile_image, is_active, email_verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [emailToStore, username || emailToStore.split('@')[0], passwordHash, 'Student', name, phone || null, profile_image || null, approved]
    );

    const studentId = generateStudentId();

    const result = await db.run(
      `INSERT INTO students (user_id, student_id, enrollment_date, courses_enrolled, status, approved, cohort_id, period, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        userResult.lastID, studentId,
        enrollment_date || new Date().toISOString().split('T')[0],
        courses_enrolled ? JSON.stringify(courses_enrolled) : null,
        status || 'Active',
        approved,
        cohort_id || null,
        period || null,
        req.user.id
      ]
    );

    // Only create course enrollments and payment records if approved (Admin created)
    // If pending approval, these will be created when approved
    if (approved === 1 && courses_enrolled && Array.isArray(courses_enrolled) && courses_enrolled.length > 0) {
      for (const courseId of courses_enrolled) {
        // Get course fee
        const course = await db.get('SELECT id, course_fee FROM courses WHERE id = ?', [courseId]);
        if (course) {
          // Create enrollment record
          try {
            await db.run(
              `INSERT INTO student_course_enrollments (student_id, user_id, course_id, enrollment_date, status)
               VALUES (?, ?, ?, ?, 'Enrolled')`,
              [result.lastID, userResult.lastID, courseId, enrollment_date || new Date().toISOString().split('T')[0]]
            );
          } catch (enrollError) {
            // Ignore duplicate enrollment errors
            if (!enrollError.message.includes('UNIQUE constraint')) {
              console.error('Error creating enrollment:', enrollError);
            }
          }

          // Create payment record
          const courseFee = course.course_fee || 0;
          await db.run(
            `INSERT INTO student_payments (student_id, user_id, course_id, course_fee, amount_paid, balance)
             VALUES (?, ?, ?, ?, 0, ?)`,
            [result.lastID, userResult.lastID, courseId, courseFee, courseFee]
          );
        }
      }
    }

    await logAction(req.user.id, 'create_student', 'academy', result.lastID, { studentId, approved }, req);

    res.status(201).json({
      message: req.user.role === 'Admin' 
        ? 'Student created successfully' 
        : 'Student created successfully and is pending admin approval',
      student: { id: result.lastID, student_id: studentId, approved }
    });
  } catch (error) {
    console.error('Create student error:', error);
    res.status(500).json({ error: 'Failed to create student: ' + error.message });
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
        userParams.push(updates.profile_image);
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
      studentParams.push(updates.cohort_id || null);
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

    const existingUser = await db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    const { hashPassword } = require('../utils/auth');
    const passwordHash = await hashPassword(password || 'Instructor@123');

    const userResult = await db.run(
      `INSERT INTO users (email, username, password_hash, role, name, phone, profile_image, is_active, email_verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`,
      [email, username || email.split('@')[0], passwordHash, 'Instructor', name, phone || null, profile_image || null]
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
        userParams.push(updates.profile_image);
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

// GET /api/academy/grades/pending (Admin)
router.get('/grades/pending', authenticateToken, requireRole('Admin'), async (req, res) => {
  try {
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
    const enrollExists = await db.get('SELECT 1 FROM enrollments WHERE student_id = ? AND course_id = ?', [g.student_id, g.course_id]);
    if (!enrollExists) {
      await db.run(
        `INSERT INTO enrollments (student_id, course_id, enrollment_date, status, grade, completion_date) VALUES (?, ?, CURRENT_DATE, 'Completed', ?, CURRENT_DATE)`,
        [g.student_id, g.course_id, gradeVal]
      );
    } else {
      await db.run(
        `UPDATE enrollments SET grade = ?, status = 'Completed', completion_date = CURRENT_DATE WHERE student_id = ? AND course_id = ?`,
        [gradeVal, g.student_id, g.course_id]
      );
    }

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

    const { name, start_date, end_date, period, description, status } = req.body;

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
      `INSERT INTO cohorts (name, code, start_date, end_date, period, description, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [name, finalCode, start_date || null, end_date || null, period || null, description || null, status || 'Active', req.user.id]
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

    const allowedUpdates = ['name', 'start_date', 'end_date', 'period', 'description', 'status'];
    const updateFields = [];
    const updateParams = [];

    for (const field of allowedUpdates) {
      if (updates[field] !== undefined) {
        updateFields.push(`${field} = ?`);
        updateParams.push(updates[field]);
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

