const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticateToken, requireRole, requireStudentPaymentAccess, getFinanceAccessUserIds } = require('../utils/auth');
const { logAction } = require('../utils/audit');
const { sendBulkNotifications, sendNotificationToUser } = require('../utils/notifications');

function pickRowNumber(row, ...keys) {
  if (!row) return 0;
  for (const key of keys) {
    if (row[key] != null && row[key] !== '') return parseFloat(row[key]) || 0;
  }
  return 0;
}

function pickRowInt(row, ...keys) {
  if (!row) return 0;
  for (const key of keys) {
    if (row[key] != null && row[key] !== '') return parseInt(row[key], 10) || 0;
  }
  return 0;
}

async function getStudentPaymentSummary(studentId) {
  const row = await db.get(
    `SELECT
       COALESCE(SUM(COALESCE(course_fee, 0)), 0) as total_fees,
       COALESCE(SUM(COALESCE(amount_paid, 0)), 0) as total_paid,
       COALESCE(SUM(COALESCE(balance, 0)), 0) as total_balance,
       COUNT(*) as payment_count
     FROM student_payments WHERE student_id = ?`,
    [studentId]
  );
  return {
    totalFees: pickRowNumber(row, 'total_fees', 'totalFees', 'totalfees'),
    totalPaid: pickRowNumber(row, 'total_paid', 'totalPaid', 'totalpaid'),
    totalBalance: pickRowNumber(row, 'total_balance', 'totalBalance', 'totalbalance'),
    paymentCount: pickRowInt(row, 'payment_count', 'paymentCount', 'paymentcount')
  };
}

// Filter options — register before /:id to avoid route conflicts
router.get('/filters', authenticateToken, requireStudentPaymentAccess(), async (req, res) => {
  try {
    const [cohorts, courses] = await Promise.all([
      db.all(
        `SELECT DISTINCT ch.id, ch.name, ch.code
         FROM cohorts ch
         INNER JOIN students s ON s.cohort_id = ch.id
         ORDER BY ch.name ASC`
      ),
      db.all(
        `SELECT DISTINCT c.id, c.course_code, c.title
         FROM courses c
         WHERE EXISTS (
           SELECT 1 FROM student_course_enrollments e
           WHERE e.course_id = c.id AND e.status != 'Dropped'
         ) OR EXISTS (
           SELECT 1 FROM student_payments sp WHERE sp.course_id = c.id
         )
         ORDER BY c.course_code ASC`
      )
    ]);
    res.json({ cohorts, courses });
  } catch (error) {
    console.error('Get student payment filters error:', error);
    res.status(500).json({ error: 'Failed to fetch filter options' });
  }
});

// Students list with search/filter/sort — single aggregated query (no N+1)
router.get('/students', authenticateToken, requireStudentPaymentAccess(), async (req, res) => {
  try {
    const { search, cohort_id, course_id, sort = 'name', sort_dir = 'asc' } = req.query;
    const params = [];
    let query = `
      SELECT s.*, u.name, u.email, u.phone, u.profile_image,
             ch.name as cohort_name, ch.code as cohort_code,
             COALESCE(ps.total_fees, 0) as total_fees,
             COALESCE(ps.total_paid, 0) as total_paid,
             COALESCE(ps.total_balance, 0) as total_balance,
             COALESCE(ps.payment_count, 0) as payment_count
      FROM students s
      JOIN users u ON s.user_id = u.id
      LEFT JOIN cohorts ch ON s.cohort_id = ch.id
      LEFT JOIN (
        SELECT student_id,
               SUM(COALESCE(course_fee, 0)) as total_fees,
               SUM(COALESCE(amount_paid, 0)) as total_paid,
               SUM(COALESCE(balance, 0)) as total_balance,
               COUNT(*) as payment_count
        FROM student_payments
        GROUP BY student_id
      ) ps ON ps.student_id = s.id
      WHERE 1=1
    `;

    if (cohort_id) {
      query += ' AND s.cohort_id = ?';
      params.push(parseInt(cohort_id, 10));
    }

    if (course_id) {
      const cid = parseInt(course_id, 10);
      query += ` AND (
        EXISTS (SELECT 1 FROM student_course_enrollments e WHERE e.student_id = s.id AND e.course_id = ? AND e.status != 'Dropped')
        OR EXISTS (SELECT 1 FROM student_payments sp2 WHERE sp2.student_id = s.id AND sp2.course_id = ?)
      )`;
      params.push(cid, cid);
    }

    if (search && String(search).trim()) {
      const term = `%${String(search).trim()}%`;
      query += ` AND (
        u.name LIKE ? OR s.student_id LIKE ? OR u.email LIKE ?
        OR EXISTS (
          SELECT 1 FROM student_course_enrollments e
          JOIN courses c ON e.course_id = c.id
          WHERE e.student_id = s.id AND (c.title LIKE ? OR c.course_code LIKE ?)
        )
        OR EXISTS (
          SELECT 1 FROM student_payments sp3
          JOIN courses c ON sp3.course_id = c.id
          WHERE sp3.student_id = s.id AND (c.title LIKE ? OR c.course_code LIKE ?)
        )
      )`;
      params.push(term, term, term, term, term, term, term);
    }

    const sortMap = {
      name: 'u.name',
      student_id: 's.student_id',
      balance: 'total_balance',
      fees: 'total_fees',
      paid: 'total_paid',
      cohort: 'ch.name',
      created: 's.created_at'
    };
    const sortCol = sortMap[String(sort).toLowerCase()] || 'u.name';
    const sortDir = String(sort_dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    query += ` ORDER BY ${sortCol} ${sortDir}, u.name ASC`;

    const rows = await db.all(query, params);
    const students = rows.map((row) => ({
      ...row,
      paymentSummary: {
        totalFees: pickRowNumber(row, 'total_fees', 'totalFees', 'totalfees'),
        totalPaid: pickRowNumber(row, 'total_paid', 'totalPaid', 'totalpaid'),
        totalBalance: pickRowNumber(row, 'total_balance', 'totalBalance', 'totalbalance'),
        paymentCount: pickRowInt(row, 'payment_count', 'paymentCount', 'paymentcount')
      }
    }));

    res.json({ students, total: students.length });
  } catch (error) {
    console.error('Get students with payments error:', error);
    res.status(500).json({ error: 'Failed to fetch students with payments: ' + (error.message || 'unknown') });
  }
});

// Combined student detail — register before /student/:studentId and /:id
router.get('/student/:studentId/detail', authenticateToken, requireStudentPaymentAccess(), async (req, res) => {
  try {
    const { studentId } = req.params;

    const student = await db.get(
      `SELECT s.*, u.name, u.email, u.phone, u.profile_image,
              ch.name as cohort_name, ch.code as cohort_code
       FROM students s
       JOIN users u ON s.user_id = u.id
       LEFT JOIN cohorts ch ON s.cohort_id = ch.id
       WHERE s.id = ? OR s.student_id = ?`,
      [studentId, studentId]
    );
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const sid = student.id;

    const [payments, enrolledCourses, transactions] = await Promise.all([
      db.all(
        `SELECT sp.*, s.student_id, u.name as student_name, u.email as student_email,
                c.course_code, c.title as course_title, c.course_fee
         FROM student_payments sp
         JOIN students s ON sp.student_id = s.id
         JOIN users u ON sp.user_id = u.id
         JOIN courses c ON sp.course_id = c.id
         WHERE sp.student_id = ?
         ORDER BY sp.created_at DESC`,
        [sid]
      ),
      db.all(
        `SELECT e.course_id, e.status as enrollment_status, c.course_code, c.title,
                c.course_fee, sp.id as payment_id, sp.amount_paid, sp.balance
         FROM student_course_enrollments e
         JOIN courses c ON e.course_id = c.id
         LEFT JOIN student_payments sp ON e.student_id = sp.student_id AND e.course_id = sp.course_id
         WHERE e.student_id = ? AND e.status != 'Dropped'
         ORDER BY c.course_code`,
        [sid]
      ),
      db.all(
        `SELECT t.id, t.student_payment_id, t.student_id, t.course_id, t.amount,
                t.payment_date, t.payment_method, t.payment_reference, t.notes,
                t.status, t.created_at, t.admin_notes, c.course_code, c.title as course_title
         FROM student_payment_transactions t
         JOIN courses c ON t.course_id = c.id
         WHERE t.student_id = ?
         ORDER BY t.created_at DESC`,
        [sid]
      )
    ]);

    const totalFees = payments.reduce((sum, p) => sum + (parseFloat(p.course_fee) || 0), 0);
    const totalPaid = payments.reduce((sum, p) => sum + (parseFloat(p.amount_paid) || 0), 0);
    const totalBalance = payments.reduce((sum, p) => sum + (parseFloat(p.balance) || 0), 0);

    res.json({
      student,
      payments,
      courses: enrolledCourses,
      transactions,
      summary: { totalFees, totalPaid, totalBalance }
    });
  } catch (error) {
    console.error('Get student payment detail error:', error);
    res.status(500).json({ error: 'Failed to fetch student payment detail' });
  }
});

// Get all student payments (Finance head, Assistant Finance, Academy head, Academy staff)
router.get('/', authenticateToken, requireStudentPaymentAccess(), async (req, res) => {
  try {
    let query = `
      SELECT sp.*,
             s.student_id,
             u.name as student_name, u.email as student_email, u.phone as student_phone,
             c.course_code, c.title as course_title, c.course_fee,
             creator.name as created_by_name
      FROM student_payments sp
      JOIN students s ON sp.student_id = s.id
      JOIN users u ON sp.user_id = u.id
      JOIN courses c ON sp.course_id = c.id
      LEFT JOIN users creator ON sp.created_at = sp.created_at
      WHERE 1=1
    `;
    const params = [];

    query += ' ORDER BY sp.created_at DESC';

    const payments = await db.all(query, params);
    res.json({ payments });
  } catch (error) {
    console.error('Get student payments error:', error);
    res.status(500).json({ error: 'Failed to fetch student payments' });
  }
});

// ----- Student payment request + finance approval -----

// POST /api/student-payments/request-payment (Student)
router.post('/request-payment', authenticateToken, requireRole('Student'), [
  body('course_id').isInt().withMessage('Course ID is required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
  body('payment_date').optional().isISO8601(),
  body('payment_method').optional().trim(),
  body('payment_reference').optional().trim(),
  body('proof_attachment').optional().trim(),
  body('notes').optional().trim()
], async (req, res) => {
  try {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    const { course_id, amount, payment_date, payment_method, payment_reference, proof_attachment, notes } = req.body;

    const student = await db.get(
      'SELECT s.id, s.user_id, s.student_id FROM students s WHERE s.user_id = ? AND s.approved = 1',
      [req.user.id]
    );
    if (!student) return res.status(404).json({ error: 'Student record not found or not approved' });

    const sp = await db.get(
      'SELECT id FROM student_payments WHERE student_id = ? AND course_id = ?',
      [student.id, course_id]
    );
    if (!sp) return res.status(400).json({ error: 'No billing record for this course' });

    const amt = parseFloat(amount);
    const payRec = await db.get(
      'SELECT balance FROM student_payments WHERE id = ?',
      [sp.id]
    );
    if (amt > (parseFloat(payRec.balance) || 0)) return res.status(400).json({ error: 'Amount exceeds balance' });

    const pd = payment_date || new Date().toISOString().split('T')[0];
    const run = await db.run(
      `INSERT INTO student_payment_transactions
       (student_payment_id, student_id, course_id, amount, payment_date, payment_method, payment_reference, proof_attachment, notes, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [sp.id, student.id, course_id, amt, pd, payment_method || null, payment_reference || null, proof_attachment || null, notes || null, req.user.id]
    );

    await logAction(req.user.id, 'request_payment', 'student_payments', run.lastID, { course_id, amount: amt }, req);

    const financeIds = await getFinanceAccessUserIds();
    if (financeIds.length) {
      try {
        await sendBulkNotifications(
          financeIds,
          'New payment request',
          `Student ${student.student_id} requested payment of ${amt} for course.`,
          'info',
          '/student-payments',
          req.user.id
        );
      } catch (e) { console.error('Request-payment notify error:', e); }
    }

    res.status(201).json({ message: 'Payment request submitted', transaction: { id: run.lastID, status: 'Pending' } });
  } catch (e) {
    console.error('Request payment error:', e);
    res.status(500).json({ error: 'Failed to submit payment request' });
  }
});

// GET /api/student-payments/pending (Finance/Admin)
router.get('/pending', authenticateToken, requireStudentPaymentAccess(), async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT t.id, t.student_payment_id, t.student_id, t.course_id, t.amount, t.payment_date, t.payment_method, t.payment_reference, t.proof_attachment, t.notes, t.status, t.created_by, t.created_at,
              s.student_id as student_code, u.name as student_name, u.email as student_email,
              c.course_code, c.title as course_title
       FROM student_payment_transactions t
       JOIN students s ON t.student_id = s.id
       JOIN users u ON s.user_id = u.id
       JOIN courses c ON t.course_id = c.id
       WHERE t.status = 'Pending'
       ORDER BY t.created_at ASC`
    );
    res.json({ pending: rows });
  } catch (e) {
    console.error('Get pending payments error:', e);
    res.status(500).json({ error: 'Failed to fetch pending payments' });
  }
});

// GET /api/student-payments/student/:studentId/transactions
router.get('/student/:studentId/transactions', authenticateToken, requireStudentPaymentAccess(), async (req, res) => {
  try {
    const { studentId } = req.params;
    const rows = await db.all(
      `SELECT t.id, t.student_payment_id, t.student_id, t.course_id, t.amount, t.payment_date, t.payment_method, t.payment_reference, t.proof_attachment, t.notes, t.status, t.created_by, t.created_at, t.admin_notes,
              c.course_code, c.title as course_title
       FROM student_payment_transactions t
       JOIN courses c ON t.course_id = c.id
       WHERE t.student_id = ? OR t.student_id = (SELECT id FROM students WHERE student_id = ?)
       ORDER BY t.created_at DESC`,
      [studentId, studentId]
    );
    res.json({ transactions: rows });
  } catch (e) {
    console.error('Get student transactions error:', e);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// POST /api/student-payments/transactions (Academy/Finance/Admin)
router.post('/transactions', authenticateToken, requireStudentPaymentAccess(), [
  body('student_id').isInt().withMessage('Student ID is required'),
  body('course_id').isInt().withMessage('Course ID is required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Payment amount must be greater than 0'),
  body('payment_date').optional().isISO8601().withMessage('Payment date must be a valid date'),
  body('payment_method').optional().trim(),
  body('payment_reference').optional().trim(),
  body('notes').optional().trim(),
  body('status').optional().isIn(['Pending', 'Approved', 'Rejected'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { student_id, course_id, amount, payment_date, payment_method, payment_reference, notes, status } = req.body;
    const amt = parseFloat(amount);
    const pd = payment_date || new Date().toISOString().split('T')[0];
    const txStatus = status || 'Approved';

    const enrollment = await db.get(
      `SELECT e.*, c.course_fee
       FROM student_course_enrollments e
       JOIN courses c ON e.course_id = c.id
       WHERE e.student_id = ? AND e.course_id = ? AND e.status != 'Dropped'`,
      [student_id, course_id]
    );
    if (!enrollment) {
      return res.status(404).json({ error: 'Student is not enrolled in this course' });
    }

    let paymentRecord = await db.get(
      `SELECT sp.*, c.course_fee
       FROM student_payments sp
       JOIN courses c ON sp.course_id = c.id
       WHERE sp.student_id = ? AND sp.course_id = ?`,
      [student_id, course_id]
    );

    if (!paymentRecord) {
      const courseFee = parseFloat(enrollment.course_fee) || 0;
      const student = await db.get('SELECT user_id FROM students WHERE id = ?', [student_id]);
      if (!student) {
        return res.status(404).json({ error: 'Student not found' });
      }
      const result = await db.run(
        `INSERT INTO student_payments (student_id, user_id, course_id, course_fee, amount_paid, balance)
         VALUES (?, ?, ?, ?, 0, ?)`,
        [student_id, student.user_id, course_id, courseFee, courseFee]
      );
      paymentRecord = await db.get(
        `SELECT sp.*, c.course_fee
         FROM student_payments sp
         JOIN courses c ON sp.course_id = c.id
         WHERE sp.id = ?`,
        [result.lastID]
      );
    }

    const run = await db.run(
      `INSERT INTO student_payment_transactions
       (student_payment_id, student_id, course_id, amount, payment_date, payment_method, payment_reference, notes, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        paymentRecord.id,
        student_id,
        course_id,
        amt,
        pd,
        payment_method || null,
        payment_reference || null,
        notes || null,
        txStatus,
        req.user.id
      ]
    );

    if (txStatus === 'Approved') {
      const currentPaid = parseFloat(paymentRecord.amount_paid) || 0;
      const fee = parseFloat(paymentRecord.course_fee) || 0;
      const nextPaid = currentPaid + amt;
      if (nextPaid > fee) {
        return res.status(400).json({ error: 'Amount exceeds course fee' });
      }
      const newBalance = Math.max(0, fee - nextPaid);
      await db.run(
        `UPDATE student_payments
         SET amount_paid = ?, balance = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [nextPaid, newBalance, paymentRecord.id]
      );
    }

    await logAction(req.user.id, 'add_student_payment_transaction', 'student_payments', run.lastID, { student_id, course_id, amount: amt, status: txStatus }, req);
    const paymentSummary = await getStudentPaymentSummary(student_id);
    res.status(201).json({ message: 'Transaction created', transaction: { id: run.lastID, status: txStatus }, paymentSummary });
  } catch (e) {
    console.error('Create transaction error:', e);
    res.status(500).json({ error: 'Failed to create transaction' });
  }
});

// PUT /api/student-payments/transactions/:id/approve (Finance/Admin)
router.put('/transactions/:id/approve', authenticateToken, requireStudentPaymentAccess(), [
  body('admin_notes').optional().trim()
], async (req, res) => {
  try {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    const id = req.params.id;
    const admin_notes = req.body.admin_notes || null;

    const t = await db.get(
      'SELECT id, student_payment_id, student_id, course_id, amount, status FROM student_payment_transactions WHERE id = ?',
      [id]
    );
    if (!t) return res.status(404).json({ error: 'Transaction not found' });
    if (t.status !== 'Pending') return res.status(400).json({ error: 'Transaction is not pending' });

    const sp = await db.get('SELECT id, amount_paid, balance, course_fee FROM student_payments WHERE id = ?', [t.student_payment_id]);
    if (!sp) return res.status(404).json({ error: 'Payment record not found' });

    const newPaid = (parseFloat(sp.amount_paid) || 0) + (parseFloat(t.amount) || 0);
    const fee = parseFloat(sp.course_fee) || 0;
    const newBal = Math.max(0, fee - newPaid);

    await db.run(
      'UPDATE student_payments SET amount_paid = ?, balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newPaid, newBal, sp.id]
    );
    await db.run(
      `UPDATE student_payment_transactions SET status = 'Approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP, admin_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [req.user.id, admin_notes, id]
    );

    const student = await db.get('SELECT user_id FROM students WHERE id = ?', [t.student_id]);
    if (student) {
      try {
        await sendNotificationToUser(student.user_id, {
          title: 'Payment approved',
          message: `Your payment of ${t.amount} has been approved.`,
          type: 'info',
          link: '/student/billing',
          senderId: req.user.id
        });
      } catch (e) { console.error('Approve notify student error:', e); }
    }

    await logAction(req.user.id, 'approve_payment_transaction', 'student_payments', id, { amount: t.amount }, req);
    const paymentSummary = await getStudentPaymentSummary(t.student_id);
    res.json({ message: 'Payment approved', transaction: { id: parseInt(id, 10), status: 'Approved' }, paymentSummary });
  } catch (e) {
    console.error('Approve transaction error:', e);
    res.status(500).json({ error: 'Failed to approve payment' });
  }
});

// PUT /api/student-payments/transactions/:id (edit transaction)
router.put('/transactions/:id', authenticateToken, requireStudentPaymentAccess(), [
  body('amount').optional().isFloat({ min: 0.01 }).withMessage('Payment amount must be greater than 0'),
  body('payment_date').optional().isISO8601().withMessage('Payment date must be a valid date'),
  body('payment_method').optional().trim(),
  body('payment_reference').optional().trim(),
  body('notes').optional().trim(),
  body('status').optional().isIn(['Pending', 'Approved', 'Rejected'])
], async (req, res) => {
  try {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    const id = req.params.id;
    const { amount, payment_date, payment_method, payment_reference, notes, status } = req.body;

    const t = await db.get(
      'SELECT id, student_payment_id, student_id, course_id, amount, status FROM student_payment_transactions WHERE id = ?',
      [id]
    );
    if (!t) return res.status(404).json({ error: 'Transaction not found' });

    const sp = await db.get(
      'SELECT id, amount_paid, balance, course_fee FROM student_payments WHERE id = ?',
      [t.student_payment_id]
    );
    if (!sp) return res.status(404).json({ error: 'Payment record not found' });

    const newAmount = amount !== undefined ? parseFloat(amount) : parseFloat(t.amount) || 0;
    const nextStatus = status || t.status;

    let delta = 0;
    if (t.status === 'Approved') {
      delta -= parseFloat(t.amount) || 0;
    }
    if (nextStatus === 'Approved') {
      delta += newAmount;
    }

    const currentPaid = parseFloat(sp.amount_paid) || 0;
    const fee = parseFloat(sp.course_fee) || 0;
    const proposedPaid = currentPaid + delta;
    if (proposedPaid < 0) return res.status(400).json({ error: 'Amount would create negative balance' });
    if (proposedPaid > fee) return res.status(400).json({ error: 'Amount exceeds course fee' });

    if (delta !== 0) {
      const newBalance = Math.max(0, fee - proposedPaid);
      await db.run(
        'UPDATE student_payments SET amount_paid = ?, balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [proposedPaid, newBalance, sp.id]
      );
    }

    const fields = [];
    const params = [];
    if (amount !== undefined) {
      fields.push('amount = ?');
      params.push(newAmount);
    }
    if (payment_date !== undefined) {
      fields.push('payment_date = ?');
      params.push(payment_date);
    }
    if (payment_method !== undefined) {
      fields.push('payment_method = ?');
      params.push(payment_method || null);
    }
    if (payment_reference !== undefined) {
      fields.push('payment_reference = ?');
      params.push(payment_reference || null);
    }
    if (notes !== undefined) {
      fields.push('notes = ?');
      params.push(notes || null);
    }
    if (status !== undefined) {
      fields.push('status = ?');
      params.push(nextStatus);
    }
    if (fields.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }
    params.push(id);
    await db.run(
      `UPDATE student_payment_transactions
       SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      params
    );

    await logAction(req.user.id, 'update_payment_transaction', 'student_payments', id, { amount: newAmount, status: nextStatus }, req);
    const paymentSummary = await getStudentPaymentSummary(t.student_id);
    res.json({ message: 'Transaction updated', transaction: { id: parseInt(id, 10), status: nextStatus }, paymentSummary });
  } catch (e) {
    console.error('Update transaction error:', e);
    res.status(500).json({ error: 'Failed to update transaction' });
  }
});

// PUT /api/student-payments/transactions/:id/reject (Finance/Admin)
router.put('/transactions/:id/reject', authenticateToken, requireStudentPaymentAccess(), [
  body('admin_notes').optional().trim()
], async (req, res) => {
  try {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    const id = req.params.id;
    const admin_notes = req.body.admin_notes || null;

    const t = await db.get('SELECT id, student_id, amount, status FROM student_payment_transactions WHERE id = ?', [id]);
    if (!t) return res.status(404).json({ error: 'Transaction not found' });
    if (t.status !== 'Pending') return res.status(400).json({ error: 'Transaction is not pending' });

    await db.run(
      `UPDATE student_payment_transactions SET status = 'Rejected', approved_by = ?, approved_at = CURRENT_TIMESTAMP, admin_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [req.user.id, admin_notes, id]
    );

    const student = await db.get('SELECT user_id FROM students WHERE id = ?', [t.student_id]);
    if (student) {
      try {
        await sendNotificationToUser(student.user_id, {
          title: 'Payment rejected',
          message: `Your payment request of ${t.amount} was rejected. ${admin_notes ? `Reason: ${admin_notes}` : ''}`,
          type: 'warning',
          link: '/student/billing',
          senderId: req.user.id
        });
      } catch (e) { console.error('Reject notify student error:', e); }
    }

    await logAction(req.user.id, 'reject_payment_transaction', 'student_payments', id, {}, req);
    res.json({ message: 'Payment rejected', transaction: { id: parseInt(id, 10), status: 'Rejected' } });
  } catch (e) {
    console.error('Reject transaction error:', e);
    res.status(500).json({ error: 'Failed to reject payment' });
  }
});

// Get enrolled courses for a student (for payment form) - MUST be before /student/:studentId
router.get('/student/:studentId/enrolled-courses', authenticateToken, requireStudentPaymentAccess(), async (req, res) => {
  try {
    const { studentId } = req.params;

    // Get enrolled courses from student_course_enrollments
    let enrolledCourses = await db.all(
      `SELECT 
        e.course_id,
        e.status as enrollment_status,
        c.course_code,
        c.title,
        c.course_fee,
        sp.id as payment_id,
        sp.amount_paid,
        sp.balance
       FROM student_course_enrollments e
       JOIN courses c ON e.course_id = c.id
       LEFT JOIN student_payments sp ON e.student_id = sp.student_id AND e.course_id = sp.course_id
       WHERE e.student_id = ? AND e.status != 'Dropped'
       ORDER BY c.course_code`,
      [studentId]
    );

    // If no enrollments in student_course_enrollments, check courses_enrolled JSON field in students table
    if (enrolledCourses.length === 0) {
      const student = await db.get('SELECT courses_enrolled FROM students WHERE id = ?', [studentId]);
      if (student && student.courses_enrolled) {
        let courseIds = [];
        try {
          courseIds = JSON.parse(student.courses_enrolled);
        } catch (e) {
          // If parsing fails, try to extract IDs from string
          courseIds = student.courses_enrolled.replace(/[\[\]]/g, '').split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
        }
        
        if (courseIds && courseIds.length > 0) {
          const placeholders = courseIds.map(() => '?').join(',');
          enrolledCourses = await db.all(
            `SELECT 
              c.id as course_id,
              'Enrolled' as enrollment_status,
              c.course_code,
              c.title,
              c.course_fee,
              sp.id as payment_id,
              sp.amount_paid,
              sp.balance
             FROM courses c
             LEFT JOIN student_payments sp ON sp.student_id = ? AND sp.course_id = c.id
             WHERE c.id IN (${placeholders})
             ORDER BY c.course_code`,
            [studentId, ...courseIds]
          );
        }
      }
    }

    res.json({ courses: enrolledCourses });
  } catch (error) {
    console.error('Get enrolled courses error:', error);
    res.status(500).json({ error: 'Failed to fetch enrolled courses' });
  }
});

// Get student payment summary (all payments for a student)
router.get('/student/:studentId', authenticateToken, requireStudentPaymentAccess(), async (req, res) => {
  try {
    const { studentId } = req.params;

    const payments = await db.all(
      `SELECT sp.*,
              s.student_id,
              u.name as student_name, u.email as student_email, u.phone as student_phone,
              c.course_code, c.title as course_title, c.course_fee
       FROM student_payments sp
       JOIN students s ON sp.student_id = s.id
       JOIN users u ON sp.user_id = u.id
       JOIN courses c ON sp.course_id = c.id
       WHERE sp.student_id = ? OR s.student_id = ?
       ORDER BY sp.created_at DESC`,
      [studentId, studentId]
    );

    // Get student details
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

    // Calculate totals
    const totalFees = payments.reduce((sum, p) => sum + (parseFloat(p.course_fee) || 0), 0);
    const totalPaid = payments.reduce((sum, p) => sum + (parseFloat(p.amount_paid) || 0), 0);
    const totalBalance = payments.reduce((sum, p) => sum + (parseFloat(p.balance) || 0), 0);

    res.json({
      student,
      payments,
      summary: {
        totalFees,
        totalPaid,
        totalBalance
      }
    });
  } catch (error) {
    console.error('Get student payment summary error:', error);
    res.status(500).json({ error: 'Failed to fetch student payment summary' });
  }
});

// Add payment to student (Finance Head, Admin)
router.post('/add-payment', authenticateToken, requireStudentPaymentAccess(), [
  body('student_id').isInt().withMessage('Student ID is required'),
  body('course_id').isInt().withMessage('Course ID is required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Payment amount must be greater than 0'),
  body('payment_date').optional().isISO8601().withMessage('Payment date must be a valid date'),
  body('payment_method').optional().trim(),
  body('payment_reference').optional().trim(),
  body('notes').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { student_id, course_id, amount, payment_date, payment_method, payment_reference, notes } = req.body;

    // Verify student is enrolled in this course
    const enrollment = await db.get(
      `SELECT e.*, c.course_fee
       FROM student_course_enrollments e
       JOIN courses c ON e.course_id = c.id
       WHERE e.student_id = ? AND e.course_id = ? AND e.status != 'Dropped'`,
      [student_id, course_id]
    );

    if (!enrollment) {
      return res.status(404).json({ error: 'Student is not enrolled in this course' });
    }

    // Get or create the payment record
    let paymentRecord = await db.get(
      `SELECT sp.*, c.course_fee
       FROM student_payments sp
       JOIN courses c ON sp.course_id = c.id
       WHERE sp.student_id = ? AND sp.course_id = ?`,
      [student_id, course_id]
    );

    // If payment record doesn't exist, create it
    if (!paymentRecord) {
      const courseFee = parseFloat(enrollment.course_fee) || 0;
      const student = await db.get('SELECT user_id FROM students WHERE id = ?', [student_id]);
      
      if (!student) {
        return res.status(404).json({ error: 'Student not found' });
      }

      const result = await db.run(
        `INSERT INTO student_payments (student_id, user_id, course_id, course_fee, amount_paid, balance)
         VALUES (?, ?, ?, ?, 0, ?)`,
        [student_id, student.user_id, course_id, courseFee, courseFee]
      );

      paymentRecord = await db.get(
        `SELECT sp.*, c.course_fee
         FROM student_payments sp
         JOIN courses c ON sp.course_id = c.id
         WHERE sp.id = ?`,
        [result.lastID]
      );
    }

    const currentAmountPaid = parseFloat(paymentRecord.amount_paid) || 0;
    const paymentAmount = parseFloat(amount);
    const newAmountPaid = currentAmountPaid + paymentAmount;
    const courseFee = parseFloat(paymentRecord.course_fee) || 0;
    const newBalance = Math.max(0, courseFee - newAmountPaid);

    // Update payment record
    await db.run(
      `UPDATE student_payments
       SET amount_paid = ?,
           balance = ?,
           payment_date = COALESCE(?, payment_date, CURRENT_DATE),
           payment_method = COALESCE(?, payment_method),
           payment_reference = COALESCE(?, payment_reference),
           notes = COALESCE(?, notes),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [newAmountPaid, newBalance, payment_date || null, payment_method || null, payment_reference || null, notes || null, paymentRecord.id]
    );

    await logAction(req.user.id, 'add_student_payment', 'student_payments', paymentRecord.id, {
      student_id,
      course_id,
      amount: paymentAmount,
      new_balance: newBalance
    }, req);

    res.json({
      message: 'Payment added successfully',
      payment: {
        id: paymentRecord.id,
        amount_paid: newAmountPaid,
        balance: newBalance
      }
    });
  } catch (error) {
    console.error('Add student payment error:', error);
    res.status(500).json({ error: 'Failed to add payment: ' + error.message });
  }
});

// Get single payment record
router.get('/:id', authenticateToken, requireStudentPaymentAccess(), async (req, res) => {
  try {
    const { id } = req.params;

    const payment = await db.get(
      `SELECT sp.*,
              s.student_id,
              u.name as student_name, u.email as student_email, u.phone as student_phone,
              c.course_code, c.title as course_title, c.course_fee
       FROM student_payments sp
       JOIN students s ON sp.student_id = s.id
       JOIN users u ON sp.user_id = u.id
       JOIN courses c ON sp.course_id = c.id
       WHERE sp.id = ?`,
      [id]
    );

    if (!payment) {
      return res.status(404).json({ error: 'Payment record not found' });
    }

    res.json({ payment });
  } catch (error) {
    console.error('Get student payment error:', error);
    res.status(500).json({ error: 'Failed to fetch payment record' });
  }
});

// Update student payment record (Academy/Finance/Admin)
router.put('/:id', authenticateToken, requireStudentPaymentAccess(), [
  body('course_fee').optional().isFloat({ min: 0 }).withMessage('Course fee must be >= 0'),
  body('amount_paid').optional().isFloat({ min: 0 }).withMessage('Amount paid must be >= 0'),
  body('balance').optional().isFloat({ min: 0 }).withMessage('Balance must be >= 0'),
  body('payment_date').optional().isISO8601().withMessage('Payment date must be a valid date'),
  body('payment_method').optional().trim(),
  body('payment_reference').optional().trim(),
  body('notes').optional().trim()
], async (req, res) => {
  try {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    const { id } = req.params;
    const updates = req.body;

    const payment = await db.get('SELECT id, course_fee, amount_paid, balance FROM student_payments WHERE id = ?', [id]);
    if (!payment) return res.status(404).json({ error: 'Payment record not found' });

    const nextCourseFee = updates.course_fee !== undefined ? parseFloat(updates.course_fee) : parseFloat(payment.course_fee) || 0;
    const nextAmountPaid = updates.amount_paid !== undefined ? parseFloat(updates.amount_paid) : parseFloat(payment.amount_paid) || 0;
    const nextBalance = updates.balance !== undefined ? parseFloat(updates.balance) : Math.max(0, nextCourseFee - nextAmountPaid);
    if (nextAmountPaid > nextCourseFee) {
      return res.status(400).json({ error: 'Amount paid exceeds course fee' });
    }

    const fields = [];
    const params = [];
    if (updates.course_fee !== undefined) {
      fields.push('course_fee = ?');
      params.push(nextCourseFee);
    }
    if (updates.amount_paid !== undefined) {
      fields.push('amount_paid = ?');
      params.push(nextAmountPaid);
    }
    if (updates.balance !== undefined || updates.course_fee !== undefined || updates.amount_paid !== undefined) {
      fields.push('balance = ?');
      params.push(nextBalance);
    }
    if (updates.payment_date !== undefined) {
      fields.push('payment_date = ?');
      params.push(updates.payment_date || null);
    }
    if (updates.payment_method !== undefined) {
      fields.push('payment_method = ?');
      params.push(updates.payment_method || null);
    }
    if (updates.payment_reference !== undefined) {
      fields.push('payment_reference = ?');
      params.push(updates.payment_reference || null);
    }
    if (updates.notes !== undefined) {
      fields.push('notes = ?');
      params.push(updates.notes || null);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    params.push(id);
    await db.run(
      `UPDATE student_payments
       SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      params
    );

    const fullPayment = await db.get('SELECT student_id FROM student_payments WHERE id = ?', [id]);
    await logAction(req.user.id, 'update_student_payment', 'student_payments', id, updates, req);
    const paymentSummary = fullPayment ? await getStudentPaymentSummary(fullPayment.student_id) : null;
    res.json({ message: 'Payment updated successfully', paymentSummary });
  } catch (e) {
    console.error('Update student payment error:', e);
    res.status(500).json({ error: 'Failed to update payment' });
  }
});

module.exports = router;

