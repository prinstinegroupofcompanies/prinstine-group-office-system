const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken, requireRole } = require('../utils/auth');
const { sendNotificationToRole } = require('../utils/notifications');

/* ============================
   GET ATTENDANCE (WITH TODAY FLAG)
============================ */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    let query = `
      SELECT 
        sa.*,
        u.name AS user_name,
        u.email AS user_email,
        approver.name AS approver_name,
        CASE 
          WHEN sa.attendance_date = ? THEN 1 
          ELSE 0 
        END AS is_today
      FROM staff_attendance sa
      LEFT JOIN users u ON sa.user_id = u.id
      LEFT JOIN users approver ON sa.approved_by = approver.id
      WHERE 1=1
    `;

    const params = [today];

    if (req.user.role !== 'Admin') {
      query += ' AND sa.user_id = ?';
      params.push(req.user.id);
    }

    query += ' ORDER BY sa.attendance_date DESC, sa.created_at DESC';

    const attendance = await db.all(query, params);

    const todayRecord = attendance.find(a => a.is_today === 1) || null;

    res.json({
      attendance,
      todayAttendance: todayRecord,
      canSignIn: !todayRecord || !todayRecord.sign_in_time,
      canSignOut:
        todayRecord &&
        todayRecord.sign_in_time &&
        !todayRecord.sign_out_time
    });
  } catch (error) {
    console.error('Get attendance error:', error);
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

/* ============================
   SIGN IN (STAFF ONLY)
============================ */
router.post(
  '/sign-in',
  authenticateToken,
  requireRole(['Staff']),
  async (req, res) => {
    try {
      const { late_reason } = req.body;
      const today = new Date().toISOString().split('T')[0];
      const now = new Date();
      const nowISO = now.toISOString();

      const existing = await db.get(
        'SELECT * FROM staff_attendance WHERE user_id = ? AND attendance_date = ?',
        [req.user.id, today]
      );

      if (existing?.sign_in_time) {
        return res.status(400).json({ error: 'Already signed in today' });
      }

      const standardStartTime = new Date(now);
      standardStartTime.setHours(9, 0, 0, 0);

      const isLate = now > standardStartTime;

      if (isLate && !late_reason) {
        return res.status(400).json({ error: 'Late reason required' });
      }

      if (existing) {
        await db.run(
          `
          UPDATE staff_attendance SET
            sign_in_time = ?,
            sign_in_late = ?,
            sign_in_late_reason = ?,
            status = 'Pending',
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
          [nowISO, isLate ? 1 : 0, late_reason || null, existing.id]
        );
      } else {
        await db.run(
          `
          INSERT INTO staff_attendance (
            user_id, attendance_date, sign_in_time,
            sign_in_late, sign_in_late_reason, status
          ) VALUES (?, ?, ?, ?, ?, 'Pending')
        `,
          [req.user.id, today, nowISO, isLate ? 1 : 0, late_reason || null]
        );
      }

      await sendNotificationToRole('Admin', {
        title: 'Staff Sign-In',
        message: `${req.user.name} signed in${isLate ? ' (Late)' : ''}`,
        link: '/attendance',
        type: isLate ? 'warning' : 'info',
        senderId: req.user.id
      });

      res.json({ message: 'Signed in successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

/* ============================
   SIGN OUT (STAFF ONLY)
============================ */
router.post(
  '/sign-out',
  authenticateToken,
  requireRole(['Staff']),
  async (req, res) => {
    try {
      const { early_reason } = req.body;
      const today = new Date().toISOString().split('T')[0];
      const now = new Date();
      const nowISO = now.toISOString();

      const attendance = await db.get(
        'SELECT * FROM staff_attendance WHERE user_id = ? AND attendance_date = ?',
        [req.user.id, today]
      );

      if (!attendance?.sign_in_time) {
        return res.status(400).json({ error: 'Sign in first' });
      }

      if (attendance.sign_out_time) {
        return res.status(400).json({ error: 'Already signed out' });
      }

      const standardEndTime = new Date(now);
      standardEndTime.setHours(17, 0, 0, 0);

      const isEarly = now < standardEndTime;

      if (isEarly && !early_reason) {
        return res.status(400).json({ error: 'Early reason required' });
      }

      await db.run(
        `
        UPDATE staff_attendance SET
          sign_out_time = ?,
          sign_out_early = ?,
          sign_out_early_reason = ?,
          status = 'Pending',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
        [nowISO, isEarly ? 1 : 0, early_reason || null, attendance.id]
      );

      await sendNotificationToRole('Admin', {
        title: 'Staff Sign-Out',
        message: `${req.user.name} signed out${isEarly ? ' early' : ''}`,
        link: '/attendance',
        type: isEarly ? 'warning' : 'info',
        senderId: req.user.id
      });

      res.json({ message: 'Signed out successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

/* ============================
   TODAY STATUS (UNCHANGED, CORRECT)
============================ */
router.get(
  '/today/status',
  authenticateToken,
  requireRole(['Staff', 'Admin']),
  async (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const attendance = await db.get(
      'SELECT * FROM staff_attendance WHERE user_id = ? AND attendance_date = ?',
      [req.user.id, today]
    );

    res.json({
      attendance: attendance || null,
      canSignIn: !attendance || !attendance.sign_in_time,
      canSignOut: attendance && attendance.sign_in_time && !attendance.sign_out_time
    });
  }
);

/* ============================
   APPROVE / REJECT (ADMIN)
============================ */
router.put('/:id/approve', authenticateToken, requireRole(['Admin']), async (req, res) => {
  const { status } = req.body;

  if (!['Approved', 'Rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  await db.run(
    `
    UPDATE staff_attendance SET
      status = ?,
      approved_by = ?,
      approved_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
    [status, req.user.id, req.params.id]
  );

  res.json({ message: `Attendance ${status}` });
});

module.exports = router;
