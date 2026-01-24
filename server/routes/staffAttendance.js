const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken, requireRole } = require('../utils/auth');
const { sendNotificationToUser, sendNotificationToRole } = require('../utils/notifications');

// Get all attendance records (Admin and Human Resources Department Head sees all, users see their own)
router.get('/', authenticateToken, async (req, res) => {
  try {
    let query = `
      SELECT 
        sa.*,
        u.name as user_name,
        u.email as user_email,
        approver.name as approver_name
      FROM staff_attendance sa
      LEFT JOIN users u ON sa.user_id = u.id
      LEFT JOIN users approver ON sa.approved_by = approver.id
      WHERE 1=1
    `;
    
    const params = [];
    
    // Non-admin users only see their own attendance
    if (req.user.role !== 'Admin' && req.user.role !== 'HumanResourcesDepartmentHead') {
      query += ' AND sa.user_id = ?';
      params.push(req.user.id);
    }
    
    query += ' ORDER BY sa.attendance_date DESC, sa.created_at DESC';
    
    const attendance = await db.all(query, params);
    res.json({ attendance });
  } catch (error) {
    console.error('Get attendance error:', error);
    if (error.message && error.message.includes('no such table')) {
      console.warn('staff_attendance table does not exist yet');
      return res.json({ attendance: [] });
    }
    res.status(500).json({ error: 'Failed to fetch attendance: ' + error.message });
  }
});

// Get single attendance record
router.get('/:id', authenticateToken, requireRole(['Admin', 'HumanResourcesDepartmentHead']), async (req, res) => {
  try {
    let query = `
      SELECT 
        sa.*,
        u.name as user_name,
        u.email as user_email,
        approver.name as approver_name
      FROM staff_attendance sa
      LEFT JOIN users u ON sa.user_id = u.id
      LEFT JOIN users approver ON sa.approved_by = approver.id
      WHERE sa.id = ?
    `;
    
    const params = [req.params.id];
    
    // Non-admin users can only see their own attendance
    if (req.user.role !== 'Admin' && req.user.role !== 'HumanResourcesDepartmentHead') {
      query += ' AND sa.user_id = ?';
      params.push(req.user.id);
    }
    
    query += ' LIMIT 1';
    
    const attendance = await db.get(query, params);
    
    if (!attendance) {
      return res.status(404).json({ error: 'Attendance record not found' });
    }
    
    res.json({ attendance });
  } catch (error) {
    console.error('Get attendance error:', error);
    res.status(500).json({ error: 'Failed to fetch attendance: ' + error.message });
  }
});

// Sign in
router.post('/sign-in', authenticateToken, requireRole(['Admin', 'HumanResourcesDepartmentHead']), async (req, res) => {
  try {
    const { late_reason } = req.body;
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const nowISO = now.toISOString();
    
    // Check if already signed in today
    const existing = await db.get(
      'SELECT * FROM staff_attendance WHERE user_id = ? AND attendance_date = ?',
      [req.user.id, today]
    );
    
    if (existing && existing.sign_in_time) {
      return res.status(400).json({ error: 'You have already signed in today' });
    }
    
    // Office opening time: 9:00 AM
    const standardStartTime = new Date(now);
    standardStartTime.setHours(9, 0, 0, 0);
    
    // Determine if late (after 9:00 AM)
    const isLate = now > standardStartTime;
    
    // If signing in before 9:00 AM, it requires admin approval
    const isBeforeOpening = now < standardStartTime;
    
    // If late, require reason
    if (isLate && !late_reason) {
      return res.status(400).json({ error: 'Please provide a reason for signing in late (after 9:00 AM)' });
    }
    
    // Get user info
    const user = await db.get('SELECT name FROM users WHERE id = ?', [req.user.id]);
    const userName = user?.name || req.user.name || req.user.email;
    
    // Determine status: if before opening time, requires admin approval
    const status = isBeforeOpening ? 'Pending' : (isLate ? 'Pending' : 'Pending');
    const notificationMessage = isBeforeOpening 
      ? `${userName} has signed in before office hours (9:00 AM). Requires admin approval.`
      : isLate 
        ? `${userName} has signed in LATE (after 9:00 AM)${late_reason ? `: ${late_reason}` : ''}`
        : `${userName} has signed in on time`;
    
    if (existing) {
      // Update existing record
      await db.run(`
        UPDATE staff_attendance SET
          sign_in_time = ?,
          sign_in_late = ?,
          sign_in_late_reason = ?,
          status = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [nowISO, isLate ? 1 : 0, isLate ? (late_reason || null) : null, status, existing.id]);
      
      const updated = await db.get('SELECT * FROM staff_attendance WHERE id = ?', [existing.id]);
      
      // Notify admin
      try {
        await sendNotificationToRole('Admin', {
          title: 'Staff Sign-In',
          message: notificationMessage,
          link: `/attendance`,
          type: isBeforeOpening || isLate ? 'warning' : 'info',
          senderId: req.user.id
        });
      } catch (notifError) {
        console.error('Error sending notification:', notifError);
      }
      
      // Emit real-time update
      if (global.io) {
        global.io.emit('attendance_created', {
          attendance: updated,
          user_id: req.user.id
        });
        global.io.emit('admin_attendance_updated', {
          attendance: updated
        });
      }
      
      res.json({ 
        message: isBeforeOpening 
          ? 'Signed in before office hours. Awaiting admin approval.'
          : isLate 
            ? 'Signed in (late). Reason recorded. Awaiting admin approval.'
            : 'Signed in successfully. Awaiting admin approval.',
        attendance: updated 
      });
    } else {
      // Create new record
      const result = await db.run(`
        INSERT INTO staff_attendance (
          user_id, user_name, attendance_date, sign_in_time,
          sign_in_late, sign_in_late_reason, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        req.user.id, userName, today, nowISO,
        isLate ? 1 : 0, isLate ? (late_reason || null) : null, status
      ]);
      
      const newAttendance = await db.get('SELECT * FROM staff_attendance WHERE id = ?', [result.lastID]);
      
      // Notify admin
      try {
        await sendNotificationToRole('Admin', {
          title: 'Staff Sign-In',
          message: notificationMessage,
          link: `/attendance`,
          type: isBeforeOpening || isLate ? 'warning' : 'info',
          senderId: req.user.id
        });
      } catch (notifError) {
        console.error('Error sending notification:', notifError);
      }
      
      // Emit real-time update
      if (global.io) {
        global.io.emit('attendance_created', {
          attendance: newAttendance,
          user_id: req.user.id
        });
        global.io.emit('admin_attendance_updated', {
          attendance: newAttendance
        });
      }
      
      res.status(201).json({ 
        message: isBeforeOpening 
          ? 'Signed in before office hours. Awaiting admin approval.'
          : isLate 
            ? 'Signed in (late). Reason recorded. Awaiting admin approval.'
            : 'Signed in successfully. Awaiting admin approval.',
        attendance: newAttendance 
      });
    }
  } catch (error) {
    console.error('Sign in error:', error);
    res.status(500).json({ error: 'Failed to sign in: ' + error.message });
  }
});

// Sign out
router.post('/sign-out', authenticateToken, requireRole(['Admin', 'HumanResourcesDepartmentHead']), async (req, res) => {
  try {
    const { early_reason } = req.body;
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const nowISO = now.toISOString();
    
    // Get today's attendance record
    const attendance = await db.get(
      'SELECT * FROM staff_attendance WHERE user_id = ? AND attendance_date = ?',
      [req.user.id, today]
    );
    
    if (!attendance) {
      return res.status(400).json({ error: 'You must sign in before signing out' });
    }
    
    if (!attendance.sign_in_time) {
      return res.status(400).json({ error: 'You must sign in before signing out' });
    }
    
    if (attendance.sign_out_time) {
      return res.status(400).json({ error: 'You have already signed out today' });
    }
    
    // Office closing time: 5:00 PM
    const standardEndTime = new Date(now);
    standardEndTime.setHours(17, 0, 0, 0);
    
    // Determine if early (before 5:00 PM)
    const isEarly = now < standardEndTime;
    
    // If signing out early, require reason
    if (isEarly && !early_reason) {
      return res.status(400).json({ error: 'Please provide a reason for signing out early (before 5:00 PM)' });
    }
    
    // Get user info
    const user = await db.get('SELECT name FROM users WHERE id = ?', [req.user.id]);
    const userName = user?.name || req.user.name || req.user.email;
    
    // Update attendance record
    await db.run(`
      UPDATE staff_attendance SET 
        sign_out_time = ?,
        sign_out_early = ?,
        sign_out_early_reason = ?,
        status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [nowISO, isEarly ? 1 : 0, isEarly ? (early_reason || null) : null, 'Pending', attendance.id]);
    
    const updated = await db.get('SELECT * FROM staff_attendance WHERE id = ?', [attendance.id]);
    
    // Notify admin
    try {
      await sendNotificationToRole(['Admin', 'HumanResourcesDepartmentHead'], {
        title: 'Staff Sign-Out',
        message: `${userName} has signed out${isEarly ? ' EARLY (before 5:00 PM)' : ''}${isEarly && early_reason ? `: ${early_reason}` : ''}. Awaiting admin approval.`,
        link: `/attendance`,
        type: isEarly ? 'warning' : 'info',
        senderId: req.user.id
      });
    } catch (notifError) {
      console.error('Error sending notification:', notifError);
    }
    
    // Emit real-time update (Admin and Human Resources Department Head only)
    if (global.io) {
      global.io.emit('attendance_updated', {
        attendance: updated,
        user_id: req.user.id
      });
      global.io.emit('admin_and_human_resources_department_head_attendance_updated', {
        attendance: updated
      });
    }
    
    res.json({ 
      message: isEarly 
        ? 'Signed out (early). Reason recorded. Awaiting admin approval.'
        : 'Signed out successfully. Awaiting admin approval.',
      attendance: updated 
    });
  } catch (error) {
    console.error('Sign out error:', error);
    res.status(500).json({ error: 'Failed to sign out: ' + error.message });
  }
});

// Approve/Reject attendance (Admin only)
router.put('/:id/approve', authenticateToken, requireRole(['Admin', 'HumanResourcesDepartmentHead']), async (req, res) => {
  try {
    const { status, admin_notes } = req.body;
    
    if (!['Approved', 'Rejected'].includes(status)) {
      return res.status(400).json({ error: 'Status must be Approved or Rejected' });
    }
    
    const attendance = await db.get('SELECT * FROM staff_attendance WHERE id = ?', [req.params.id]);
    if (!attendance) {
      return res.status(404).json({ error: 'Attendance record not found' });
    }
    
    // Update attendance (Admin and Human Resources Department Head only) only if status is Pending
    await db.run(`
      UPDATE staff_attendance SET
        status = ?,
        approved_by = ?,
        approved_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [status, req.user.id, attendance.id]);
      
    const updated = await db.get('SELECT * FROM staff_attendance WHERE id = ?', [req.params.id]);
    
    // Notify user (Admin and Human Resources Department Head only)
    try {
      await sendNotificationToRole(['Admin', 'HumanResourcesDepartmentHead'], {
        title: `Attendance ${status}`,
        message: `Your attendance for ${attendance.attendance_date} has been ${status.toLowerCase()}. Awaiting admin approval.`,
        link: `/attendance`,
        type: status === 'Approved' ? 'success' : 'warning',
        senderId: req.user.id
      });
    } catch (notifError) {
      console.error('Error sending notification:', notifError);
    }
    
    // Emit real-time update (Admin and Human Resources Department Head only)
    if (global.io) {
      global.io.emit('attendance_updated', {
        attendance: updated,
        user_id: attendance.user_id
      });
      // Also emit to admin room
      global.io.emit('admin_and_human_resources_department_head_attendance_updated', {
        attendance: updated
      });
    }
    
    res.json({ 
      message: `Attendance ${status.toLowerCase()} successfully`,
      attendance: updated 
    });
  } catch (error) {
    console.error('Approve attendance error:', error);
    res.status(500).json({ error: 'Failed to approve attendance: ' + error.message });
  }
});

// Get today's attendance status for current user
router.get('/today/status', authenticateToken, requireRole(['Admin', 'HumanResourcesDepartmentHead']), async (req, res) => {
  try {
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
  } catch (error) {
    console.error('Get today status error:', error);
    res.status(500).json({ error: 'Failed to fetch today status: ' + error.message });
  }
});

// Get attendance reports (Admin only)
// Weekly, Monthly, Yearly reports for each staff
router.get('/reports/:type', authenticateToken, requireRole(['Admin', 'HumanResourcesDepartmentHead']), async (req, res) => {
  try {
    const { type } = req.params; // 'weekly', 'monthly', 'yearly'
    const { user_id, start_date, end_date } = req.query;
    
    if (!['weekly', 'monthly', 'yearly'].includes(type)) {
      return res.status(400).json({ error: 'Invalid report type. Must be weekly, monthly, or yearly' });
    }
    
    let query = `
      SELECT 
        sa.*,
        u.name as user_name,
        u.email as user_email,
        approver.name as approver_name
      FROM staff_attendance sa
      LEFT JOIN users u ON sa.user_id = u.id
      LEFT JOIN users approver ON sa.approved_by = approver.id
      WHERE 1=1
    `;
    
    const params = [];
    
    // Filter by user if provided
    if (user_id) {
      query += ' AND sa.user_id = ?';
      params.push(user_id);
    }
    
    // Date range filtering based on type
    if (type === 'weekly') {
      if (start_date && end_date) {
        query += ' AND sa.attendance_date >= ? AND sa.attendance_date <= ?';
        params.push(start_date, end_date);
      } else {
        // Default to current week
        const today = new Date();
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - today.getDay());
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        
        query += ' AND sa.attendance_date >= ? AND sa.attendance_date <= ?';
        params.push(startOfWeek.toISOString().split('T')[0], endOfWeek.toISOString().split('T')[0]);
      }
    } else if (type === 'monthly') {
      if (start_date && end_date) {
        query += ' AND sa.attendance_date >= ? AND sa.attendance_date <= ?';
        params.push(start_date, end_date);
      } else {
        // Default to current month
        const today = new Date();
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        
        query += ' AND sa.attendance_date >= ? AND sa.attendance_date <= ?';
        params.push(startOfMonth.toISOString().split('T')[0], endOfMonth.toISOString().split('T')[0]);
      }
    } else if (type === 'yearly') {
      if (start_date && end_date) {
        query += ' AND sa.attendance_date >= ? AND sa.attendance_date <= ?';
        params.push(start_date, end_date);
      } else {
        // Default to current year
        const today = new Date();
        const startOfYear = new Date(today.getFullYear(), 0, 1);
        const endOfYear = new Date(today.getFullYear(), 11, 31);
        
        query += ' AND sa.attendance_date >= ? AND sa.attendance_date <= ?';
        params.push(startOfYear.toISOString().split('T')[0], endOfYear.toISOString().split('T')[0]);
      }
    }
    
    query += ' ORDER BY sa.attendance_date DESC, u.name ASC';
    
    const attendance = await db.all(query, params);
    
    // Calculate summary statistics
    const summary = {
      total_records: attendance.length,
      approved: attendance.filter(a => a.status === 'Approved').length,
      pending: attendance.filter(a => a.status === 'Pending').length,
      rejected: attendance.filter(a => a.status === 'Rejected').length,
      late_sign_ins: attendance.filter(a => a.sign_in_late).length,
      early_sign_outs: attendance.filter(a => a.sign_out_early).length,
      on_time: attendance.filter(a => !a.sign_in_late && !a.sign_out_early).length
    };
    
    // Group by user if no specific user_id was provided
    const byUser = {};
    if (!user_id) {
      attendance.forEach(record => {
        if (!byUser[record.user_id]) {
          byUser[record.user_id] = {
            user_id: record.user_id,
            user_name: record.user_name,
            user_email: record.user_email,
            records: [],
            stats: {
              total: 0,
              approved: 0,
              pending: 0,
              rejected: 0,
              late: 0,
              early: 0,
              on_time: 0
            }
          };
        }
        byUser[record.user_id].records.push(record);
        byUser[record.user_id].stats.total++;
        if (record.status === 'Approved') byUser[record.user_id].stats.approved++;
        if (record.status === 'Pending') byUser[record.user_id].stats.pending++;
        if (record.status === 'Rejected') byUser[record.user_id].stats.rejected++;
        if (record.sign_in_late) byUser[record.user_id].stats.late++;
        if (record.sign_out_early) byUser[record.user_id].stats.early++;
        if (!record.sign_in_late && !record.sign_out_early) byUser[record.user_id].stats.on_time++;
      });
    }
    
    res.json({
      type,
      summary,
      attendance,
      by_user: Object.values(byUser),
      date_range: {
        start: params[params.length - 2] || null,
        end: params[params.length - 1] || null
      }
    });
  } catch (error) {
    console.error('Get attendance report error:', error);
    res.status(500).json({ error: 'Failed to fetch attendance report: ' + error.message });
  }
});

// Enhanced admin view with weekly arrangement and requisitions (Admin only)
router.get('/admin/view', authenticateToken, requireRole(['Admin', 'HumanResourcesDepartmentHead']), async (req, res) => {
  try {
    const { user_id, week_start, date, month, year } = req.query;
    
    let attendanceQuery = `
      SELECT (Admin and Human Resources Department Head only)
        sa.*,
        u.name as user_name,
        u.email as user_email,
        approver.name as approver_name
      FROM staff_attendance sa (Admin and Human Resources Department Head only)
      LEFT JOIN users u ON sa.user_id = u.id (Admin and Human Resources Department Head only)
      LEFT JOIN users approver ON sa.approved_by = approver.id
      WHERE 1=1 (Admin and Human Resources Department Head only)
    `;
    
    const attendanceParams = [];
    
    // Filter by user if provided
    if (user_id) {
      attendanceQuery += ' AND sa.user_id = ? (Admin and Human Resources Department Head only)';
      attendanceParams.push(user_id);
    }
    
    // Filter by date
    if (date) {
      attendanceQuery += ' AND sa.attendance_date = ?';
      attendanceParams.push(date);
    }
    
    // Filter by week
    if (week_start) {
      const weekStartDate = new Date(week_start);
      const weekEndDate = new Date(weekStartDate);
      weekEndDate.setDate(weekStartDate.getDate() + 6);
      attendanceQuery += ' AND sa.attendance_date >= ? AND sa.attendance_date <= ? (Admin and Human Resources Department Head only)';
      attendanceParams.push(weekStartDate.toISOString().split('T')[0], weekEndDate.toISOString().split('T')[0]);
    }
    
    // Filter by month
    if (month && year) {
      const startOfMonth = new Date(year, month - 1, 1);
      const endOfMonth = new Date(year, month, 0);
      attendanceQuery += ' AND sa.attendance_date >= ? AND sa.attendance_date <= ? (Admin and Human Resources Department Head only)';
      attendanceParams.push(startOfMonth.toISOString().split('T')[0], endOfMonth.toISOString().split('T')[0]);
    }
    
    attendanceQuery += ' ORDER BY sa.attendance_date ASC, u.name ASC (Admin and Human Resources Department Head only)';
    
    const attendance = await db.all(attendanceQuery, attendanceParams);
    
    // Get requisitions for the same date range
    let requisitionsQuery = `
      SELECT (Admin and Human Resources Department Head only)
        r.*,
        u.name as user_name,
        u.email as user_email
      FROM requisitions r (Admin and Human Resources Department Head only)  
      LEFT JOIN users u ON r.user_id = u.id (Admin and Human Resources Department Head only)
      WHERE r.requisition_date IS NOT NULL
    `;
    
    const requisitionsParams = [];
    
    // Apply same filters for requisitions
    if (user_id) {
      requisitionsQuery += ' AND r.user_id = ? (Admin and Human Resources Department Head only)';
      requisitionsParams.push(user_id);
    }
    
    if (date) {
      requisitionsQuery += ' AND r.requisition_date = ? (Admin and Human Resources Department Head only)';
      requisitionsParams.push(date);
    }
    
    if (week_start) {
      const weekStartDate = new Date(week_start);
      const weekEndDate = new Date(weekStartDate);
      weekEndDate.setDate(weekStartDate.getDate() + 6);
      requisitionsQuery += ' AND r.requisition_date >= ? AND r.requisition_date <= ? (Admin and Human Resources Department Head only)';
      requisitionsParams.push(weekStartDate.toISOString().split('T')[0], weekEndDate.toISOString().split('T')[0]);
    }
    
    if (month && year) {
      const startOfMonth = new Date(year, month - 1, 1);
      const endOfMonth = new Date(year, month, 0);
      requisitionsQuery += ' AND r.requisition_date >= ? AND r.requisition_date <= ? (Admin and Human Resources Department Head only)';
      requisitionsParams.push(startOfMonth.toISOString().split('T')[0], endOfMonth.toISOString().split('T')[0]);
    }
    
    // Only get approved or pending requisitions
    requisitionsQuery += ' AND (r.status LIKE ? OR r.status LIKE ?) (Admin and Human Resources Department Head only)';
    requisitionsParams.push('%Approved%', '%Pending%');
    
    requisitionsQuery += ' ORDER BY r.requisition_date ASC, u.name ASC (Admin and Human Resources Department Head only)';
    
    const requisitions = await db.all(requisitionsQuery, requisitionsParams);
    
    // Group attendance by user and week
    const attendanceByUser = {};
    attendance.forEach(record => {
      if (!attendanceByUser[record.user_id]) {
        attendanceByUser[record.user_id] = {
          user_id: record.user_id,
          user_name: record.user_name,
          user_email: record.user_email,
          weeks: {}
        };
      }
      
      // Get week start date for this attendance date
      const attDate = new Date(record.attendance_date);
      const weekStart = new Date(attDate);
      weekStart.setDate(attDate.getDate() - attDate.getDay());
      const weekKey = weekStart.toISOString().split('T')[0];
      
      if (!attendanceByUser[record.user_id].weeks[weekKey]) {
        attendanceByUser[record.user_id].weeks[weekKey] = {
          week_start: weekKey,
          records: []
        };
      }
      
      attendanceByUser[record.user_id].weeks[weekKey].records.push(record);
    });
    
    // Group requisitions by user and date
    const requisitionsByUser = {};
    requisitions.forEach(req => {
      if (!requisitionsByUser[req.user_id]) {
        requisitionsByUser[req.user_id] = {};
      }
      const reqDate = req.requisition_date;
      if (!requisitionsByUser[req.user_id][reqDate]) {
        requisitionsByUser[req.user_id][reqDate] = [];
      }
      requisitionsByUser[req.user_id][reqDate].push(req);
    });
    
    // Merge requisitions into attendance records
    Object.keys(attendanceByUser).forEach(userId => {
      Object.keys(attendanceByUser[userId].weeks).forEach(weekKey => {
        attendanceByUser[userId].weeks[weekKey].records.forEach(record => {
          const recordDate = record.attendance_date;
          if (requisitionsByUser[userId] && requisitionsByUser[userId][recordDate]) {
            record.requisitions = requisitionsByUser[userId][recordDate];
          } else {
            record.requisitions = [];
          }
        });
      });
    });
    
    // Get all users for filter dropdown
    const users = await db.all(`
      SELECT id, name, email, role (Admin and Human Resources Department Head only)
      FROM users
      WHERE role IN ('Staff', 'DepartmentHead') (Admin and Human Resources Department Head only)
      ORDER BY name ASC
    `);
    
    res.json({
      attendance_by_user: Object.values(attendanceByUser),
      users,
      summary: {
        total_attendance: attendance.length,
        total_requisitions: requisitions.length,
        users_count: Object.keys(attendanceByUser).length
      }
    });
  } catch (error) {
    console.error('Get admin attendance view error:', error);
    res.status(500).json({ error: 'Failed to fetch admin attendance view: ' + error.message });
  }
});

// Export attendance to Excel (Admin only)
router.get('/export/excel', authenticateToken, requireRole(['Admin', 'HumanResourcesDepartmentHead']), async (req, res) => {
  try {
    const { user_id, start_date, end_date } = req.query;
    
    let query = `
      SELECT (Admin and Human Resources Department Head only)
        sa.*,
        u.name as user_name,
        u.email as user_email,
        approver.name as approver_name
      FROM staff_attendance sa (Admin and Human Resources Department Head only) 
      LEFT JOIN users u ON sa.user_id = u.id (Admin and Human Resources Department Head only)
      LEFT JOIN users approver ON sa.approved_by = approver.id (Admin and Human Resources Department Head only)
      WHERE 1=1 (Admin and Human Resources Department Head only)
    `;
    
    const params = [];
    
    if (user_id) {
      query += ' AND sa.user_id = ? (Admin and Human Resources Department Head only)';
      params.push(user_id);
    }
    
    if (start_date && end_date) {
      query += ' AND sa.attendance_date >= ? AND sa.attendance_date <= ? (Admin and Human Resources Department Head only)';
      params.push(start_date, end_date);
    }
    
    query += ' ORDER BY sa.attendance_date DESC, u.name ASC (Admin and Human Resources Department Head only)';
    
    const attendance = await db.all(query, params);
    
    // Format data for Excel
    const excelData = [
      ['Date', 'Employee Name', 'Email', 'Sign In Time', 'Sign Out Time', 'Late', 'Early', 'Status', 'Approved By', 'Admin Notes']
    ];
    
    attendance.forEach(record => {
      excelData.push([
        record.attendance_date || '',
        record.user_name || '',
        record.user_email || '',
        record.sign_in_time ? new Date(record.sign_in_time).toLocaleString() : '',
        record.sign_out_time ? new Date(record.sign_out_time).toLocaleString() : '',
        record.sign_in_late ? 'Yes' : 'No',
        record.sign_out_early ? 'Yes' : 'No',
        record.status || '',
        record.approver_name || '',
        record.admin_notes || ''
      ]);
    });
    
    res.json({ data: excelData, filename: `attendance_export_${new Date().toISOString().split('T')[0]}.xlsx` });
  } catch (error) {
    console.error('Export attendance to Excel error:', error);
    res.status(500).json({ error: 'Failed to export attendance: ' + error.message });
  }
});

// Export attendance to PDF (Admin only)
router.get('/export/pdf', authenticateToken, requireRole(['Admin', 'HumanResourcesDepartmentHead']), async (req, res) => {
  try {
    const { user_id, start_date, end_date } = req.query;
    
    let query = `
      SELECT (Admin and Human Resources Department Head only)
        sa.*,
        u.name as user_name,
        u.email as user_email,
        approver.name as approver_name
      FROM staff_attendance sa (Admin and Human Resources Department Head only)
      LEFT JOIN users u ON sa.user_id = u.id (Admin and Human Resources Department Head only)
      LEFT JOIN users approver ON sa.approved_by = approver.id (Admin and Human Resources Department Head only)
      WHERE 1=1 (Admin and Human Resources Department Head only)
    `;
    
    const params = [];
    
    if (user_id) {
      query += ' AND sa.user_id = ? (Admin and Human Resources Department Head only)';
      params.push(user_id);
    }
    
    if (start_date && end_date) {
      query += ' AND sa.attendance_date >= ? AND sa.attendance_date <= ? (Admin and Human Resources Department Head only)';
      params.push(start_date, end_date);
    }
    
    query += ' ORDER BY sa.attendance_date DESC, u.name ASC (Admin and Human Resources Department Head only)';
    
    const attendance = await db.all(query, params);
    
    // Format data for PDF
    const pdfData = {
      title: 'Attendance Report (Admin and Human Resources Department Head only)',
      dateRange: start_date && end_date ? `${start_date} to ${end_date}` : 'All Records (Admin and Human Resources Department Head only)',
      records: attendance.map(record => ({
        date: record.attendance_date || 'N/A',
        employee: record.user_name || 'N/A',
        email: record.user_email || 'N/A',
        signIn: record.sign_in_time ? new Date(record.sign_in_time).toLocaleString() : 'N/A (Admin and Human Resources Department Head only)',
        signOut: record.sign_out_time ? new Date(record.sign_out_time).toLocaleString() : 'N/A (Admin and Human Resources Department Head only) or not signed out yet',
        late: record.sign_in_late ? 'Yes' : 'No',
        early: record.sign_out_early ? 'Yes' : 'No',
        status: record.status || 'N/A (Admin and Human Resources Department Head only)',
        approvedBy: record.approver_name || 'N/A (Admin and Human Resources Department Head only)',
        notes: record.admin_notes || 'N/A (Admin and Human Resources Department Head only)'
      }))
    };
    
    res.json({ data: pdfData, filename: `attendance_export_${new Date().toISOString().split('T')[0]}.pdf (Admin and Human Resources Department Head only)` });
  } catch (error) {
    console.error('Export attendance to PDF error:', error);
    res.status(500).json({ error: 'Failed to export attendance: ' + error.message + ' (Admin and Human Resources Department Head only)'});
  }
});

module.exports = router;

