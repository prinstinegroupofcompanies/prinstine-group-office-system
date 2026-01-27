// server/routes/staffAttendance.js
// Centralized Staff Attendance Routes (FIXED)

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken, requireRole } = require('../utils/auth');
const { formatISO } = require('date-fns');

// ============================
// Helpers
// ============================
const getTodayDate = () =>
  formatISO(new Date(), { representation: 'date' });

// ============================
// STAFF: Attendance History
// ============================
router.get('/', authenticateToken, async (req, res) => {
  try {
    const rows = await db.all(
      `
      SELECT *
      FROM staff_attendance
      WHERE user_id = ?
      ORDER BY attendance_date DESC
      `,
      [req.user.id]
    );

    res.json({ attendance: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

// ============================
// STAFF: Today Status
// ============================
router.get('/today/status', authenticateToken, async (req, res) => {
  try {
    const today = getTodayDate();

    const attendance = await db.get(
      `
      SELECT *
      FROM staff_attendance
      WHERE user_id = ? AND attendance_date = ?
      `,
      [req.user.id, today]
    );

    res.json({
      attendance,
      canSignIn: !attendance || !attendance.sign_in_time,
      canSignOut:
        attendance &&
        attendance.sign_in_time &&
        !attendance.sign_out_time
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load today status' });
  }
});

// ============================
// STAFF: Sign In
// ============================
router.post('/sign-in', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userName = req.user.name;
    const today = getTodayDate();
    const now = new Date();

    const startTime = new Date();
    startTime.setHours(9, 0, 0, 0);
    const isLate = now > startTime;

    const existing = await db.get(
      `
      SELECT *
      FROM staff_attendance
      WHERE user_id = ? AND attendance_date = ?
      `,
      [userId, today]
    );

    if (existing?.sign_in_time) {
      return res.status(400).json({ error: 'Already signed in today' });
    }

    await db.run(
      `
      INSERT INTO staff_attendance (
        user_id,
        user_name,
        attendance_date,
        sign_in_time,
        sign_in_late,
        sign_in_late_reason,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, 'Pending')
      `,
      [
        userId,
        userName,
        today,
        now.toISOString(),
        isLate ? 1 : 0,
        isLate ? req.body?.late_reason || null : null
      ]
    );

    res.json({ message: 'Signed in successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to sign in' });
  }
});

// ============================
// STAFF: Sign Out
// ============================
router.post('/sign-out', authenticateToken, async (req, res) => {
  try {
    const today = getTodayDate();
    const now = new Date();

    const endTime = new Date();
    endTime.setHours(17, 0, 0, 0);
    const isEarly = now < endTime;

    const attendance = await db.get(
      `
      SELECT *
      FROM staff_attendance
      WHERE user_id = ? AND attendance_date = ?
      `,
      [req.user.id, today]
    );

    if (!attendance?.sign_in_time) {
      return res.status(400).json({ error: 'You must sign in first' });
    }

    if (attendance.sign_out_time) {
      return res.status(400).json({ error: 'Already signed out today' });
    }

    await db.run(
      `
      UPDATE staff_attendance
      SET sign_out_time = ?,
          sign_out_early = ?,
          sign_out_early_reason = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [
        now.toISOString(),
        isEarly ? 1 : 0,
        isEarly ? req.body?.early_reason || null : null,
        attendance.id
      ]
    );

    res.json({ message: 'Signed out successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to sign out' });
  }
});

// ============================
// ADMIN: View Attendance (FIXED)
// ============================
router.get(
  '/admin/view',
  authenticateToken,
  requireRole('Admin'),
  async (req, res) => {
    try {
      const { user_id, date, week_start, month, year } = req.query;
      let where = '1=1';
      const params = [];

      if (user_id) {
        where += ' AND sa.user_id = ?';
        params.push(user_id);
      }

      if (date) {
        where += ' AND sa.attendance_date = ?';
        params.push(date);
      }

      if (week_start) {
        const start = new Date(week_start);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);

        where += ' AND sa.attendance_date BETWEEN ? AND ?';
        params.push(
          start.toISOString().split('T')[0],
          end.toISOString().split('T')[0]
        );
      }

      if (month && year) {
        const start = `${year}-${String(month).padStart(2, '0')}-01`;
        const end = new Date(year, month, 0)
          .toISOString()
          .split('T')[0];

        where += ' AND sa.attendance_date BETWEEN ? AND ?';
        params.push(start, end);
      }

      const rows = await db.all(
        `
        SELECT
          sa.*,
          u.email AS user_email,
          u.role AS user_role
        FROM staff_attendance sa
        LEFT JOIN users u ON u.id = sa.user_id
        WHERE ${where}
        ORDER BY sa.attendance_date DESC
        `,
        params
      );

      res.json({
        total: rows.length,
        attendance: rows
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Admin view failed' });
    }
  }
);

// ============================
// ADMIN: Approve / Reject
// ============================
router.put(
  '/:id/approve',
  authenticateToken,
  requireRole('Admin'),
  async (req, res) => {
    try {
      const { status, admin_notes } = req.body;

      if (!['Approved', 'Rejected'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      await db.run(
        `
        UPDATE staff_attendance
        SET status = ?,
            approved_by = ?,
            approved_at = CURRENT_TIMESTAMP,
            admin_notes = ?
        WHERE id = ?
        `,
        [status, req.user.id, admin_notes || null, req.params.id]
      );

      res.json({ message: `Attendance ${status.toLowerCase()}` });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Approval failed' });
    }
  }
);

// ============================
// STAFF: Calendar View
// ============================
router.get('/calendar', authenticateToken, async (req, res) => {
  try {
    const { month, year } = req.query;

    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const end = new Date(year, month, 0)
      .toISOString()
      .split('T')[0];

    const rows = await db.all(
      `
      SELECT attendance_date, status, sign_in_late, sign_out_early
      FROM staff_attendance
      WHERE user_id = ?
        AND attendance_date BETWEEN ? AND ?
      `,
      [req.user.id, start, end]
    );

    res.json({ records: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Calendar load failed' });
  }
});

module.exports = router;
