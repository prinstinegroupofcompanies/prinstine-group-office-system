// server/routes/staffAttendance.js
// Centralized Staff Attendance Routes (Fixed Date Handling, Approval, Export, Calendar)

const express = require('express');
const router = express.Router();
const db = require('../config/database'); // adjust path if needed
const { authenticateToken, requireRole } = require('../utils/auth');
const { startOfDay, endOfDay, formatISO } = require('date-fns');

// Helper: get today date (YYYY-MM-DD) in server local time
const getTodayDate = () => formatISO(new Date(), { representation: 'date' });

// ============================
// GET: User attendance history
// ============================
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const rows = await db.all(
      `SELECT * FROM staff_attendance
       WHERE user_id = ?
       ORDER BY attendance_date DESC`,
      [userId]
    );
    res.json({ attendance: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

// ============================
// GET: Today status
// ============================
router.get('/today/status', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const today = getTodayDate();

    const attendance = await db.get(
      `SELECT * FROM staff_attendance
       WHERE user_id = ? AND attendance_date = ?`,
      [userId, today]
    );

    res.json({
      attendance,
      canSignIn: !attendance || !attendance.sign_in_time,
      canSignOut: attendance && attendance.sign_in_time && !attendance.sign_out_time
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch today status' });
  }
});

// ============================
// POST: Sign In
// ============================
router.post('/sign-in', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const userName = req.user.name;
    const today = getTodayDate();
    const now = new Date();

    const standardStart = new Date();
    standardStart.setHours(9, 0, 0, 0);
    const isLate = now > standardStart;

    const existing = await db.get(
      `SELECT * FROM staff_attendance WHERE user_id = ? AND attendance_date = ?`,
      [userId, today]
    );

    if (existing && existing.sign_in_time) {
      return res.status(400).json({ error: 'Already signed in today' });
    }

    await db.run(
      `INSERT OR REPLACE INTO staff_attendance
       (id, user_id, user_name, attendance_date, sign_in_time, sign_in_late, sign_in_late_reason, status)
       VALUES (
         COALESCE((SELECT id FROM staff_attendance WHERE user_id = ? AND attendance_date = ?), NULL),
         ?, ?, ?, ?, ?, ?, 'Pending'
       )`,
      [userId, today, userId, userName, today, now.toISOString(), isLate ? 1 : 0, isLate ? req.body.late_reason : null]
    );

    res.json({ message: 'Signed in successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to sign in' });
  }
});

// ============================
// POST: Sign Out
// ============================
router.post('/sign-out', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const today = getTodayDate();
    const now = new Date();

    const standardEnd = new Date();
    standardEnd.setHours(17, 0, 0, 0);
    const isEarly = now < standardEnd;

    const attendance = await db.get(
      `SELECT * FROM staff_attendance WHERE user_id = ? AND attendance_date = ?`,
      [userId, today]
    );

    if (!attendance || !attendance.sign_in_time) {
      return res.status(400).json({ error: 'You must sign in first' });
    }
    if (attendance.sign_out_time) {
      return res.status(400).json({ error: 'Already signed out today' });
    }

    await db.run(
      `UPDATE staff_attendance
       SET sign_out_time = ?,
           sign_out_early = ?,
           sign_out_early_reason = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [now.toISOString(), isEarly ? 1 : 0, isEarly ? req.body.early_reason : null, attendance.id]
    );

    res.json({ message: 'Signed out successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to sign out' });
  }
});

// ============================
// PUT: Approve / Reject Attendance
// ============================
router.put('/:id/approve', requireAuth, requireRole('Admin'), async (req, res) => {
  try {
    const { status, admin_notes } = req.body;

    if (!['Approved', 'Rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    await db.run(
      `UPDATE staff_attendance
       SET status = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP, admin_notes = ?
       WHERE id = ?`,
      [status, req.user.id, admin_notes || null, req.params.id]
    );

    res.json({ message: `Attendance ${status.toLowerCase()}` });
  } catch (err) {
    res.status(500).json({ error: 'Approval failed' });
  }
});

// ============================
// GET: Admin View (Weekly / Date / Month)
// ============================
router.get('/admin/view', requireAuth, requireRole('Admin'), async (req, res) => {
  try {
    const { user_id, week_start, date, month, year } = req.query;
    const params = [];
    let where = '1=1';

    if (user_id) {
      where += ' AND sa.user_id = ?';
      params.push(user_id);
    }

    if (date) {
      where += ' AND sa.attendance_date = ?';
      params.push(date);
    }

    if (week_start) {
      const ws = new Date(week_start);
      const we = new Date(ws);
      we.setDate(ws.getDate() + 6);
      where += ' AND sa.attendance_date BETWEEN ? AND ?';
      params.push(formatISO(ws, { representation: 'date' }));
      params.push(formatISO(we, { representation: 'date' }));
    }

    if (month && year) {
      const start = `${year}-${String(month).padStart(2, '0')}-01`;
      const end = new Date(year, month, 0).toISOString().split('T')[0];
      where += ' AND sa.attendance_date BETWEEN ? AND ?';
      params.push(start, end);
    }

    const rows = await db.all(
      `SELECT sa.*, u.email AS user_email
       FROM staff_attendance sa
       JOIN users u ON u.id = sa.user_id
       WHERE ${where}
       ORDER BY sa.user_id, sa.attendance_date`,
      params
    );

    // Group by user → week
    const grouped = {};
    rows.forEach(r => {
      if (!grouped[r.user_id]) {
        grouped[r.user_id] = {
          user_id: r.user_id,
          user_name: r.user_name,
          user_email: r.user_email,
          weeks: {}
        };
      }
      const d = new Date(r.attendance_date);
      d.setDate(d.getDate() - d.getDay());
      const weekKey = d.toISOString().split('T')[0];

      if (!grouped[r.user_id].weeks[weekKey]) {
        grouped[r.user_id].weeks[weekKey] = { records: [] };
      }
      grouped[r.user_id].weeks[weekKey].records.push(r);
    });

    res.json({ attendance_by_user: Object.values(grouped) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load admin view' });
  }
});

// ============================
// GET: Calendar View
// ============================
router.get('/calendar', requireAuth, async (req, res) => {
  try {
    const { month, year } = req.query;
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const end = new Date(year, month, 0).toISOString().split('T')[0];

    const rows = await db.all(
      `SELECT attendance_date, status, sign_in_late, sign_out_early
       FROM staff_attendance
       WHERE user_id = ? AND attendance_date BETWEEN ? AND ?`,
      [req.user.id, start, end]
    );

    res.json({ records: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load calendar' });
  }
});

module.exports = router;
