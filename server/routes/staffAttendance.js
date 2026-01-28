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
    let userName = req.user.name;
    if (!userName) {
      const u = await db.get('SELECT name FROM users WHERE id = ?', [userId]);
      userName = u?.name || req.user.email || `User ${userId}`;
    }
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

function weekStart(d) {
  const x = new Date(d);
  const day = x.getDay();
  const diff = x.getDate() - day;
  x.setDate(diff);
  return x.toISOString().split('T')[0];
}

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
        const end = new Date(year, Number(month), 0)
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
          u.name AS user_display_name,
          u.role AS user_role
        FROM staff_attendance sa
        LEFT JOIN users u ON u.id = sa.user_id
        WHERE ${where}
        ORDER BY sa.attendance_date DESC
        `,
        params
      );

      // Users list for admin filter (Staff + DepartmentHead)
      let users = [];
      try {
        const userRows = await db.all(
          `SELECT id, email, name, role FROM users WHERE role IN ('Staff', 'DepartmentHead') ORDER BY name`
        );
        users = userRows || [];
      } catch (e) {
        console.warn('Could not fetch users for admin view:', e.message);
      }

      // Build attendance_by_user grouped by user and week
      const byUser = new Map();
      for (const r of rows) {
        const uid = r.user_id;
        const name = r.user_display_name || r.user_name || r.user_email || `User ${uid}`;
        const email = r.user_email || '';
        if (!byUser.has(uid)) {
          byUser.set(uid, { user_id: uid, user_name: name, user_email: email, weeks: {} });
        }
        const rec = byUser.get(uid);
        const wk = weekStart(r.attendance_date);
        if (!rec.weeks[wk]) rec.weeks[wk] = { records: [] };
        rec.weeks[wk].records.push({ ...r, requisitions: r.requisitions || [] });
      }
      const attendance_by_user = Array.from(byUser.values());

      res.json({
        total: rows.length,
        attendance: rows,
        attendance_by_user,
        users
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
      if (status === 'Rejected' && !(admin_notes && String(admin_notes).trim())) {
        return res.status(400).json({ error: 'Notes are required when rejecting attendance' });
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

// ============================
// ADMIN: Export Excel
// ============================
router.get('/export/excel', authenticateToken, requireRole('Admin'), async (req, res) => {
  try {
    const { start_date, end_date, user_id } = req.query;
    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'start_date and end_date are required' });
    }
    let where = 'sa.attendance_date BETWEEN ? AND ?';
    const params = [start_date, end_date];
    if (user_id) {
      where += ' AND sa.user_id = ?';
      params.push(user_id);
    }
    const rows = await db.all(
      `SELECT sa.*, u.name AS user_display_name, u.email AS user_email
       FROM staff_attendance sa
       LEFT JOIN users u ON u.id = sa.user_id
       WHERE ${where}
       ORDER BY sa.attendance_date, u.name`,
      params
    );
    const fmt = (d) => (d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
    const data = [
      ['Date', 'Employee', 'Email', 'Sign In', 'Sign Out', 'Late', 'Early', 'Status'],
      ...rows.map((r) => [
        r.attendance_date,
        (r.user_display_name || r.user_name || r.user_email || '').toString(),
        (r.user_email || '').toString(),
        fmt(r.sign_in_time),
        fmt(r.sign_out_time),
        r.sign_in_late ? 'Yes' : '',
        r.sign_out_early ? 'Yes' : '',
        r.status || ''
      ])
    ];
    const filename = `attendance-${start_date}-to-${end_date}.xlsx`;
    res.json({ data, filename });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Export failed' });
  }
});

// ============================
// ADMIN: Export PDF (returns data for client-side PDF generation)
// ============================
router.get('/export/pdf', authenticateToken, requireRole('Admin'), async (req, res) => {
  try {
    const { start_date, end_date, user_id } = req.query;
    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'start_date and end_date are required' });
    }
    let where = 'sa.attendance_date BETWEEN ? AND ?';
    const params = [start_date, end_date];
    if (user_id) {
      where += ' AND sa.user_id = ?';
      params.push(user_id);
    }
    const rows = await db.all(
      `SELECT sa.*, u.name AS user_display_name, u.email AS user_email
       FROM staff_attendance sa
       LEFT JOIN users u ON u.id = sa.user_id
       WHERE ${where}
       ORDER BY sa.attendance_date, u.name`,
      params
    );
    const fmt = (d) => (d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A');
    const records = rows.map((r) => ({
      date: r.attendance_date,
      employee: (r.user_display_name || r.user_name || r.user_email || 'N/A').toString(),
      email: (r.user_email || '').toString(),
      signIn: fmt(r.sign_in_time),
      signOut: fmt(r.sign_out_time),
      late: r.sign_in_late ? 'Yes' : 'No',
      early: r.sign_out_early ? 'Yes' : 'No',
      status: r.status || ''
    }));
    const data = {
      title: 'Attendance Report',
      dateRange: `${start_date} to ${end_date}`,
      records
    };
    const filename = `attendance-${start_date}-to-${end_date}.pdf`;
    res.json({ data, filename });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Export failed' });
  }
});

module.exports = router;
