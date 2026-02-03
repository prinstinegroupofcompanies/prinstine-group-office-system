const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticateToken, requireRole, requireStaffManagement, requireStaffRead } = require('../utils/auth');
const { logAction } = require('../utils/audit');
const { hashPassword } = require('../utils/auth');
const { normalizeProfileImage } = require('../utils/normalizeProfileImage');
const crypto = require('crypto');

// Generate unique staff ID
function generateStaffId() {
  return 'STF-' + Date.now().toString().slice(-8) + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
}

const HR_OFFICER_EMAILS = ['samantha@prinstinegroup.org'];
const isHROfficer = (user) => HR_OFFICER_EMAILS.includes(((user?.email ?? '') + '').toLowerCase().trim());

// Get all staff (Admin, HR Officer, Human Resources Department Head, Department Head)
router.get('/', authenticateToken, requireStaffRead, async (req, res) => {
  try {
    const { department, employment_type, search } = req.query;
    let query = `
      SELECT s.*, u.name, u.email, u.phone, u.profile_image, u.is_active
      FROM staff s
      JOIN users u ON s.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (department) {
      query += ' AND s.department = ?';
      params.push(department);
    }
    if (employment_type) {
      query += ' AND s.employment_type = ?';
      params.push(employment_type);
    }
    if (search) {
      query += ' AND (u.name LIKE ? OR u.email LIKE ? OR s.staff_id LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    // HR Officer (by email) has full access like Admin
    if (isHROfficer(req.user)) {
      // No additional filter - see all
    } else if (req.user.role === 'HumanResourcesDepartmentHead') {
      // Check if head_email column exists
      const deptTableInfo = await db.all("PRAGMA table_info(departments)");
      const deptColumnNames = deptTableInfo.map(col => col.name);
      const hasHeadEmail = deptColumnNames.includes('head_email');
      
      // Get department for this department head
      let dept;
      if (hasHeadEmail) {
        dept = await db.get(
          'SELECT id, name FROM departments WHERE manager_id = ? OR LOWER(TRIM(head_email)) = ?',
          [req.user.id, req.user.email.toLowerCase().trim()]
        );
      } else {
        // Fallback to manager_id only if head_email doesn't exist
        dept = await db.get(
          'SELECT id, name FROM departments WHERE manager_id = ?',
          [req.user.id]
        );
      }
      
      if (dept) {
        query += ' AND s.department = ?';
        params.push(dept.name);
      }
    } else if (req.user.role === 'DepartmentHead') {
      const deptTableInfo = await db.all("PRAGMA table_info(departments)");
      const deptColumnNames = deptTableInfo.map(col => col.name);
      const hasHeadEmail = deptColumnNames.includes('head_email');
      let dept;
      if (hasHeadEmail) {
        dept = await db.get(
          'SELECT id, name FROM departments WHERE manager_id = ? OR LOWER(TRIM(head_email)) = ?',
          [req.user.id, req.user.email.toLowerCase().trim()]
        );
      } else {
        dept = await db.get(
          'SELECT id, name FROM departments WHERE manager_id = ?',
          [req.user.id]
        );
      }
      if (!dept || !dept.name) {
        return res.status(403).json({ error: 'Department not found for this department head' });
      }
      query += ' AND s.department = ?';
      params.push(dept.name);
    } else if (req.user.role === 'Staff') {
      // Staff (non–HR Officer) can only see their own staff record
      query += ' AND s.user_id = ?';
      params.push(req.user.id);
    }

    query += ' ORDER BY s.created_at DESC';

    const staff = await db.all(query, params);
    
    // Include Dept Heads + Admins without staff records for Admin, HR Officer, or HR Dept Head
    const fullAccess = req.user.role === 'Admin' || isHROfficer(req.user) ||
      (req.user.role === 'HumanResourcesDepartmentHead' &&
       (req.user.email || '').toLowerCase().includes('human resources'));
    if (fullAccess) {
      try {
        // Include Human Resources Department Heads who don't have staff records
        const deptHeadsQuery = `
          SELECT 
            NULL as id,
            u.id as user_id,
            'DEPT-' || u.id as staff_id,
            'Full-time' as employment_type,
            d.name as position,
            d.name as department,
            NULL as employment_date,
            NULL as base_salary,
            NULL as bonus_structure,
            NULL as emergency_contact_name,
            NULL as emergency_contact_phone,
            NULL as address,
            u.created_at as created_at,
            u.updated_at as updated_at,
            u.name,
            u.email,
            u.phone,
            u.profile_image,
            u.is_active
          FROM users u
          LEFT JOIN departments d ON (d.manager_id = u.id OR LOWER(TRIM(d.head_email)) = LOWER(TRIM(u.email)))
          WHERE u.role = 'HumanResourcesDepartmentHead'
          AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.user_id = u.id)
        `;
        const deptHeads = await db.all(deptHeadsQuery);
        staff.push(...deptHeads);
        
        // Also include Admin users who don't have staff records (Admin and Human Resources Department Head can see all staff)
        const adminUsersQuery = `
          SELECT 
            NULL as id,
            u.id as user_id,  
            u.name,
            u.email,
          FROM users u
          WHERE u.role = 'Admin'
          AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.user_id = u.id)
        `;
        const adminUsers = await db.all(adminUsersQuery);
        staff.push(...adminUsers);
      } catch (error) {
        console.error('Error fetching Human Resources Department Heads and Admin users:', error);
         // Continue without Human Resources Department Heads and Admin users if there's an error
      }
    }
    
    res.json({ staff });
  } catch (error) {
    console.error('Get staff error:', error);
    // Handle missing staff table if it doesn't exist yet
    if (error.message && error.message.includes('no such table')) {
      console.warn('Staff table does not exist yet');
      return res.json({ staff: [] });
    }
    res.status(500).json({ error: 'Failed to fetch staff members' });
  }
});

// Get single staff member
router.get('/:id', authenticateToken, requireStaffRead, async (req, res) => {
  try {
    const staffId = req.params.id;

    const staff = await db.get(
      `SELECT s.*, u.name, u.email, u.phone, u.profile_image, u.is_active, u.created_at as user_created_at
       FROM staff s
       JOIN users u ON s.user_id = u.id
       WHERE s.id = ? OR s.staff_id = ?`,
      [staffId, staffId]
    );

    if (!staff) {
      return res.status(404).json({ error: 'Staff member information not found' });
    }

    const canViewAll = req.user.role === 'Admin' || req.user.role === 'HumanResourcesDepartmentHead' || isHROfficer(req.user);
    const ownRecord = staff.user_id === req.user.id;
    let deptHeadView = false;
    if (req.user.role === 'DepartmentHead') {
      const deptTableInfo = await db.all("PRAGMA table_info(departments)");
      const deptColumnNames = deptTableInfo.map(col => col.name);
      const hasHeadEmail = deptColumnNames.includes('head_email');
      let dept;
      if (hasHeadEmail) {
        dept = await db.get(
          'SELECT id, name FROM departments WHERE manager_id = ? OR LOWER(TRIM(head_email)) = ?',
          [req.user.id, req.user.email.toLowerCase().trim()]
        );
      } else {
        dept = await db.get(
          'SELECT id, name FROM departments WHERE manager_id = ?',
          [req.user.id]
        );
      }
      deptHeadView = !!(dept && dept.name && staff.department === dept.name);
    }
    if (!canViewAll && !ownRecord && !deptHeadView) {
      return res.status(403).json({ error: 'You do not have permission to view this staff member.' });
    }

    res.json({ staff });
  } catch (error) {
    console.error('Get staff member error:', error);
    // Handle missing staff table if it doesn't exist yet
    if (error.message && error.message.includes('no such table')) {
      console.warn('Staff table does not exist yet');
      return res.json({ staff: [] });
    }
    res.status(500).json({ error: 'Failed to fetch staff member information. Staff table does not exist yet.' });
  }
});

// Create staff member (Admin, HR Officer, and Human Resources Department Head)
router.post('/', authenticateToken, requireStaffManagement, [
  body('email').isEmail().normalizeEmail(),
  body('name').trim().notEmpty(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('Validation errors for creating staff member information:', errors.array());
      return res.status(400).json({ 
        error: 'Validation failed for creating staff member information. Please check the required fields and try again.',
        errors: errors.array() 
      });
    }

    const {
      email, name, username, phone, profile_image, password
    } = req.body;
    const normalizedProfileImage = normalizeProfileImage(profile_image) ?? null;

    // Check if user exists
    const existingUser = await db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUser) {
      return res.status(400).json({ error: 'A staff member with this email already exists. Please use a different email address.' });
    }

    // Password is required when creating staff (admin creates it)
    if (!password) {
      return res.status(400).json({ error: 'Password is required. Admin or Human Resources Department Head can create a password for staff login. Please provide a password.' });
    }
    const passwordHash = await hashPassword(password); // Hash the password
    
    // Create user
    const userResult = await db.run(
      `INSERT INTO users (email, username, password_hash, role, name, phone, profile_image, is_active, email_verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`,
      [email, username || email.split('@')[0], passwordHash, 'Staff', name, phone || null, normalizedProfileImage]
    );

    // Generate staff ID
    const staffId = generateStaffId();

    // Create staff record - use appropriate columns based on what exists
    let staffResult;
    try {
      if (hasEnhancedFields) {
        // Build column list dynamically based on what exists
        const columns = [
          'user_id', 'staff_id', 'employment_type', 'position', 'department', 'employment_date',
          'base_salary', 'bonus_structure', 'emergency_contact_name', 'emergency_contact_phone', 'address',
          'date_of_birth', 'place_of_birth', 'nationality', 'gender', 'marital_status', 'national_id', 'tax_id',
          'bank_name', 'bank_account_number', 'bank_branch', 'next_of_kin_name', 'next_of_kin_relationship',
          'next_of_kin_phone', 'next_of_kin_address', 'qualifications', 'previous_employment'
        ];
        
        if (hasReferencesColumn) {
          columns.push(referencesColumnName);
        }
        columns.push('notes');
        
        const placeholders = columns.map(() => '?').join(', ');
        const columnList = columns.join(', ');
        
        // Build parameters array to match columns exactly
        const params = [
          userResult.lastID, staffId, employment_type, position, department,
          employment_date || new Date().toISOString().split('T')[0],
          baseSalaryValue, bonus_structure || null, emergency_contact_name || null,
          emergency_contact_phone || null, address || null,
          date_of_birth || null, place_of_birth || null, nationality || null,
          gender || null, marital_status || null, national_id || null, tax_id || null,
          bank_name || null, bank_account_number || null, bank_branch || null,
          next_of_kin_name || null, next_of_kin_relationship || null,
          next_of_kin_phone || null, next_of_kin_address || null,
          qualificationsData, previousEmploymentData
        ];
        
        console.log(`Inserting staff with ${columns.length} columns and ${params.length} parameters`);
        console.log('Columns:', columns);
        console.log('Params:', params);
        
        staffResult = await db.run(
          `INSERT INTO staff (${columnList})
           VALUES (${placeholders})`,
          params
        );
      } else {
        // Fallback to basic fields only if enhanced fields don't exist
        staffResult = await db.run(
          `INSERT INTO staff (user_id, staff_id, employment_type, position, department, employment_date,
            base_salary, bonus_structure, emergency_contact_name, emergency_contact_phone, address)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userResult.lastID, staffId, employment_type, position, department,
            employment_date || new Date().toISOString().split('T')[0],
            baseSalaryValue, bonus_structure || null, emergency_contact_name || null,
            emergency_contact_phone || null, address || null
          ]
        );
      }

      // Force checkpoint to ensure data is persisted immediately
      if (db.db) {
        await new Promise((resolve) => {
          db.db.run('PRAGMA wal_checkpoint(TRUNCATE)', (err) => {
            if (err && !err.message.includes('database is locked')) {
              console.warn('Checkpoint warning after staff creation:', err.message);
            }
            resolve();
          });
        });
      }

      await logAction(req.user.id, 'create_staff', 'staff', staffResult.lastID, { staffId, email }, req);

      res.status(201).json({
        message: 'Staff member created successfully',
        staff: { id: staffResult.lastID, staff_id: staffId, user_id: userResult.lastID }
      });
    } catch (staffError) {
      // If staff record creation fails, we should rollback the user creation
      console.error('Failed to create staff record after user creation:', staffError);
      console.error('Staff creation error details:', {
        message: staffError.message,
        code: staffError.code,
        errno: staffError.errno,
        sql: staffError.sql
      });
      // Try to delete the user that was created
      try {
        await db.run('DELETE FROM users WHERE id = ?', [userResult.lastID]);
        console.log('Rolled back user creation due to staff record creation failure');
      } catch (deleteError) {
        console.error('Failed to rollback user creation:', deleteError);
      }
      throw staffError; // Re-throw to be caught by outer catch
    }
  } catch (error) {
    console.error('Create staff error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      errno: error.errno,
      sql: error.sql,
      stack: error.stack?.split('\n').slice(0, 5).join('\n')
    });
    
    // Handle specific database errors
    let errorMessage = 'Failed to create staff member';
    if (error.message && error.message.includes('FOREIGN KEY constraint')) {
      errorMessage = 'Foreign key constraint failed. Please ensure the department exists. Department head name not found on table.';
    } else if (error.message && error.message.includes('UNIQUE constraint')) {
      errorMessage = 'A staff member or user with this email already exists. Please use a different email address.';
    } else if (error.message && error.message.includes('NOT NULL constraint')) {
      errorMessage = 'Required fields are missing. Please check the required fields and try again.';
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    res.status(500).json({ 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Update staff member information (Admin, HR Officer, and Human Resources Department Head)
router.put('/:id', authenticateToken, requireStaffManagement, async (req, res) => {
  try {
    const staffId = req.params.id;
    const updates = req.body;

    const staff = await db.get('SELECT user_id, id FROM staff WHERE id = ? OR staff_id = ?', [staffId, staffId]);
    if (!staff) {
      return res.status(404).json({ error: 'Staff member information not found' });
    }
    const canEditAll = req.user.role === 'Admin' || req.user.role === 'HumanResourcesDepartmentHead' || isHROfficer(req.user);
    if (staff.user_id !== req.user.id && !canEditAll) {
      return res.status(403).json({ error: 'Only Admin, HR Officer, and Human Resources Department Head can update staff member information' });
    }

    // Update user info if provided
    if (updates.name || updates.phone || updates.profile_image !== undefined || updates.password !== undefined) {
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
      if (updates.password) {
        userUpdates.push('password_hash = ?');
        userParams.push(await hashPassword(updates.password));
      }
      if (userUpdates.length > 0) {
        userParams.push(staff.user_id);
        await db.run(`UPDATE users SET ${userUpdates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, userParams);
      }
    }

    // Check which columns exist in staff table
    const USE_POSTGRESQL_UPDATE = !!process.env.DATABASE_URL;
    let staffTableInfo;
    let staffColumnNames;
    
    if (USE_POSTGRESQL_UPDATE) {
      staffTableInfo = await db.all(
        "SELECT column_name as name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'staff'"
      );
      staffColumnNames = staffTableInfo.map(col => col.name);
    } else {
      staffTableInfo = await db.all("PRAGMA table_info(staff)");
      staffColumnNames = staffTableInfo.map(col => col.name);
    }
    
    // Update staff info - only update fields that exist in the table (Admin and Human Resources Department Head only)
    const staffUpdates = [];
    const staffParams = [];
    const allowedFields = [
      'employment_type', 'position', 'department', 'employment_date',
      'base_salary', 'bonus_structure', 'emergency_contact_name', 'emergency_contact_phone', 'address',
      'date_of_birth', 'place_of_birth', 'nationality', 'gender', 'marital_status',
      'national_id', 'tax_id', 'bank_name', 'bank_account_number', 'bank_branch',
      'next_of_kin_name', 'next_of_kin_relationship', 'next_of_kin_phone', 'next_of_kin_address',
      'qualifications', 'previous_employment', 'references', 'notes'
    ];

    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        // Check if column exists in table (Admin and Human Resources Department Head only)
        let columnExists = false;
        if (field === 'references') {
          // References column is escaped differently in SQLite vs PostgreSQL
          if (USE_POSTGRESQL_UPDATE) {
            columnExists = staffColumnNames.includes('references');
          } else {
            columnExists = staffColumnNames.includes('[references]') || staffColumnNames.includes('references');
          }
        } else {
          columnExists = staffColumnNames.includes(field);
        }
        
        // Skip field if column doesn't exist (Admin and Human Resources Department Head only)
        if (!columnExists) {
          return;
        }
        // Handle JSON fields (Admin and Human Resources Department Head only)
        let value = updates[field];
        // Escape 'references' as it's a reserved keyword in SQL (Admin and Human Resources Department Head only)
        const fieldName = field === 'references' ? (USE_POSTGRESQL_UPDATE ? '"references"' : '[references]') : field;
        staffUpdates.push(`${fieldName} = ?`);
        staffParams.push(value || null);
      }
    });

    if (staffUpdates.length > 0) {
      // Use the actual staff.id from the database, not the param (in case staff_id was used) (Admin and Human Resources Department Head only)
      const actualStaffId = staff.id || staffId;
      staffParams.push(actualStaffId);
      await db.run(`UPDATE staff SET ${staffUpdates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, staffParams);
    }

    await logAction(req.user.id, 'update_staff', 'staff', staffId, updates, req);

    res.json({ message: 'Staff member updated successfully' });
  } catch (error) {
    console.error('Update staff error:', error);
    res.status(500).json({ error: 'Failed to update staff member' });
  }
});

// Delete staff member (Admin only)
router.delete('/:id', authenticateToken, requireRole('Admin'), async (req, res) => {
  try {
    const staffId = req.params.id;
    
    // Validate staff ID
    if (!staffId || staffId === 'null' || staffId === 'undefined') {
      return res.status(400).json({ error: 'Invalid staff ID provided' });
    }

    // Get staff record - try both id and staff_id
    const staff = await db.get('SELECT user_id, id FROM staff WHERE id = ? OR staff_id = ?', [staffId, staffId]);
    if (!staff) {
      return res.status(404).json({ error: 'Staff member not found' });
    }

    // Use the actual staff.id from the database
    const actualStaffId = staff.id || staffId;
    
    // Delete staff (cascade will delete user)
    await db.run('DELETE FROM staff WHERE id = ?', [actualStaffId]);

    await logAction(req.user.id, 'delete_staff', 'staff', staffId, {}, req);

    res.json({ message: 'Staff member information deleted successfully' });
  } catch (error) {
    console.error('Delete staff error:', error);
    res.status(500).json({ error: 'Failed to delete staff member. Staff table does not exist yet.' });
  }
});

// Get performance reviews for a staff member
router.get('/:id/reviews', authenticateToken, async (req, res) => {
  try {
    const staffId = req.params.id;

    const reviews = await db.all(
      `SELECT pr.*, u.name as reviewer_name
       FROM performance_reviews pr
       LEFT JOIN users u ON pr.reviewer_id = u.id
       WHERE pr.staff_id = ?
       ORDER BY pr.review_date DESC`,
      [staffId]
    );

    res.json({ reviews });
  } catch (error) {
    console.error('Get reviews error:', error);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// Add performance review
router.post('/:id/reviews', authenticateToken, requireRole('Admin'), [
  body('rating').isInt({ min: 1, max: 5 }),
  body('comments').trim().notEmpty()
], async (req, res) => {
  try {
    const { rating, comments, goals } = req.body;
    const staffId = req.params.id;

    const result = await db.run(
      `INSERT INTO performance_reviews (staff_id, reviewer_id, rating, comments, goals)
       VALUES (?, ?, ?, ?, ?)`,
      [staffId, req.user.id, rating, comments, goals ? JSON.stringify(goals) : null]
    );

    await logAction(req.user.id, 'create_review', 'staff', staffId, { rating }, req);

    res.status(201).json({ message: 'Performance review added', reviewId: result.lastID });
  } catch (error) {
    console.error('Add review error:', error);
    res.status(500).json({ error: 'Failed to add review' });
  }
});

// Get leave requests for staff
router.get('/:id/leaves', authenticateToken, async (req, res) => {
  try {
    const staffId = req.params.id;

    const leaves = await db.all(
      `SELECT lr.*, u.name as approver_name
       FROM leave_requests lr
       LEFT JOIN users u ON lr.approved_by = u.id
       WHERE lr.staff_id = ?
       ORDER BY lr.created_at DESC`,
      [staffId]
    );

    res.json({ leaves });
  } catch (error) {
    console.error('Get leaves error:', error);
    res.status(500).json({ error: 'Failed to fetch leave requests' });
  }
});

// Create leave request
router.post('/:id/leaves', authenticateToken, requireStaffManagement, [
  body('leave_type').isIn(['Sick', 'Vacation', 'Personal', 'Emergency', 'Other']),
  body('start_date').isISO8601(),
  body('end_date').isISO8601(),
  body('reason').trim().notEmpty().optional()
], async (req, res) => {
  try {
    const { leave_type, start_date, end_date, reason = null } = req.body;
    const staffId = req.params.id;

    // Calculate days
    const start = new Date(start_date);
    const end = new Date(end_date);
    const daysRequested = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

    const result = await db.run(
      `INSERT INTO leave_requests (staff_id, leave_type, start_date, end_date, days_requested, reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [staffId, leave_type, start_date, end_date, daysRequested, reason]
    );

    await logAction(req.user.id, 'create_leave_request', 'staff', staffId, { leave_type, daysRequested }, req);

    res.status(201).json({ message: 'Leave request submitted', leaveId: result.lastID });
  } catch (error) {
    console.error('Create leave error:', error);
    res.status(500).json({ error: 'Failed to submit leave request' });
  }
});

// Approve/reject leave request (Admin, HR Officer, and Human Resources Department Head)
router.put('/leaves/:leaveId', authenticateToken, requireStaffManagement, [
  body('status').isIn(['Approved', 'Rejected'])
], async (req, res) => {
  try {
    const { status, comments } = req.body;
    const leaveId = req.params.leaveId;

    await db.run(
      `UPDATE leave_requests 
       SET status = ?, approved_by = ?, approval_date = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, req.user.id, leaveId]
    );

    await logAction(req.user.id, 'update_leave', 'staff', leaveId, { status }, req);

    res.json({ message: `Leave request ${status.toLowerCase()}` });
  } catch (error) {
    console.error('Update leave error:', error);
    res.status(500).json({ error: 'Failed to update leave request' });
  }
});

module.exports = router;

