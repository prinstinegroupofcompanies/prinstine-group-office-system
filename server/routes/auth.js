const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { hashPassword, comparePassword, generateToken, authenticateToken } = require('../utils/auth');
const { logAction } = require('../utils/audit');
const { sendOTP, sendPasswordReset } = require('../utils/email');
const { normalizeProfileImage } = require('../utils/normalizeProfileImage');
const crypto = require('crypto');

// Generate OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Registration removed - users are created by admin only

// Login
router.post('/login', [
  body('email').trim().notEmpty().withMessage('Email or username is required'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  const requestStartTime = Date.now();
  console.log('=== LOGIN ROUTE HIT ===');
  console.log('Time:', new Date().toISOString());
  console.log('Request body received:', !!req.body, 'Email:', req.body?.email);
  
  try {
    const errors = validationResult(req);
    console.log('Validation completed in:', Date.now() - requestStartTime, 'ms');
    if (!errors.isEmpty()) {
      console.error('Validation errors:', JSON.stringify(errors.array(), null, 2));
      console.error('Request body:', JSON.stringify(req.body, null, 2));
      const errorMessages = errors.array().map(e => e.msg || e.message || e.param).join(', ');
      return res.status(400).json({ 
        error: 'Validation failed: ' + errorMessages,
        errors: errors.array() 
      });
    }

    const { email, password } = req.body;

    const loginId = (email || '').toLowerCase().trim();
    console.log('Login attempt for:', loginId);

    let user = await db.get(
      'SELECT id, email, username, password_hash, role, name, phone, profile_image, is_active, email_verified FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [loginId]
    );

    if (!user) {
      user = await db.get(
        'SELECT id, email, username, password_hash, role, name, phone, profile_image, is_active, email_verified FROM users WHERE LOWER(TRIM(username)) = ? LIMIT 1',
        [loginId]
      );
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid email/username or password' });
    }

    console.log('User found:', { id: user.id, email: user.email, role: user.role, is_active: user.is_active });

    // Allow Admin, DepartmentHead, Staff, Student, and Instructor to log in (case-insensitive)
    const allowedRoles = ['Admin', 'DepartmentHead', 'Staff', 'Student', 'Instructor'];
    const roleNorm = (user.role || '').trim();
    const canonicalRole = allowedRoles.find(r => r.toLowerCase() === roleNorm.toLowerCase());
    if (!canonicalRole) {
      console.log('Login denied - role not allowed:', user.role);
      return res.status(403).json({ error: 'Login access restricted. Contact administrator.' });
    }

    // Student and Instructor can always log in with their email/password (even when pending approval).
    // Other roles require is_active.
    const canBypassActive = canonicalRole === 'Student' || canonicalRole === 'Instructor';
    if (!canBypassActive && !user.is_active) {
      console.log('Account is deactivated for user:', user.id);
      return res.status(403).json({ error: 'Account is deactivated. Please contact administrator.' });
    }

    if (!user.password_hash) {
      console.error('Password hash is missing for user:', user.id);
      console.error('User details:', { id: user.id, email: user.email, role: user.role });
      return res.status(500).json({ error: 'Account configuration error. Password not set. Please contact administrator to reset your password.' });
    }

    // Verify password
    console.log('Verifying password...');
    console.log('Password hash exists:', !!user.password_hash);
    console.log('Password hash length:', user.password_hash?.length);
    console.log('Password provided length:', password.length);
    console.log('User role:', user.role);
    
    // For debugging - check if password hash looks valid (bcrypt hashes start with $2a$, $2b$, or $2y$)
    if (user.password_hash && !user.password_hash.startsWith('$2')) {
      console.error('WARNING: Password hash does not appear to be a valid bcrypt hash!');
      console.error('Hash starts with:', user.password_hash.substring(0, 10));
    }
    
    const isValidPassword = await comparePassword(password, user.password_hash);
    console.log('Password verification result:', isValidPassword);
    
    if (!isValidPassword) {
      console.log('Invalid password for user:', user.id);
      console.log('User email:', user.email);
      console.log('User role:', user.role);
      console.log('Attempted password length:', password.length);
      // Don't log the actual password for security
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate token with canonical role so route guards work correctly
    const token = generateToken({ ...user, role: canonicalRole });
    console.log('Login successful for user:', user.id);

    // Log action asynchronously (don't block login response)
    logAction(user.id, 'login', 'auth', user.id, {}, req).catch(err => {
      console.error('Error logging login action (non-blocking):', err);
    });

    const userResponse = {
      id: user.id,
      email: user.email,
      username: user.username,
      role: canonicalRole,
      name: user.name,
      phone: user.phone || null,
      profile_image: user.profile_image || null,
      emailVerified: user.email_verified === 1
    };
    
    console.log('Login successful, returning user:', {
      id: userResponse.id,
      email: userResponse.email,
      role: userResponse.role
    });
    
    // Prepare response data
    const responseData = {
      token,
      user: userResponse
    };
    
    console.log('Sending response at:', new Date().toISOString());
    
    // Send response - res.json() handles everything properly
    res.json(responseData);
    
    console.log('Response sent successfully at:', new Date().toISOString());
  } catch (error) {
    console.error('Login error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// Get current user
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await db.get(
      `SELECT id, email, username, role, name, phone, profile_image, is_active, email_verified, created_at
       FROM users WHERE id = ?`,
      [req.user.id]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const canonicalRoles = { admin: 'Admin', departmenthead: 'DepartmentHead', staff: 'Staff', student: 'Student', instructor: 'Instructor' };
    const rk = (user.role || '').trim().toLowerCase();
    if (canonicalRoles[rk]) user.role = canonicalRoles[rk];

    // For Staff users, get department and position from staff table
    if (user.role === 'Staff') {
      const staff = await db.get(
        'SELECT department, position FROM staff WHERE user_id = ?',
        [user.id]
      );
      if (staff) {
        user.department = staff.department || null;
        user.position = staff.position || null;
      }
    }

    // For DepartmentHead users, get all departments they manage and set academyAccess
    if (user.role === 'DepartmentHead') {
      const userEmail = (user.email || '').toLowerCase().trim();
      const academyHeadEmails = ['fwallace@prinstinegroup.org'];
      if (academyHeadEmails.includes(userEmail)) {
        user.academyAccess = true;
      }
      let depts = [];
      try {
        const deptTableInfo = await db.all("PRAGMA table_info(departments)").catch(() => []);
        const deptColumnNames = (deptTableInfo || []).map(col => col.name);
        const hasHeadEmail = deptColumnNames.includes('head_email');
        if (hasHeadEmail) {
          depts = await db.all(
            'SELECT name FROM departments WHERE manager_id = ? OR LOWER(TRIM(head_email)) = ?',
            [user.id, userEmail]
          );
        } else {
          depts = await db.all('SELECT name FROM departments WHERE manager_id = ?', [user.id]);
        }
      } catch (e) {
        console.warn('DepartmentHead departments fetch failed:', e?.message);
      }
      if (Array.isArray(depts) && depts.length > 0) {
        user.department = depts[0].name || null;
        if (!user.academyAccess) {
          const academyMatch = /academy|elearning|e-learning|marketing/i;
          user.academyAccess = depts.some(d => d && d.name && academyMatch.test(d.name));
        }
      }
    }

    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Update current user profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { name, phone, profile_image } = req.body;
    const userId = req.user.id;

    const updateFields = [];
    const params = [];

    if (name !== undefined) {
      updateFields.push('name = ?');
      params.push(name);
    }
    if (phone !== undefined) {
      updateFields.push('phone = ?');
      params.push(phone);
    }
    if (profile_image !== undefined) {
      const normalizedProfileImage = normalizeProfileImage(profile_image);
      updateFields.push('profile_image = ?');
      params.push(normalizedProfileImage);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(userId);
    await db.run(
      `UPDATE users SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      params
    );

    // Fetch updated user
    const updatedUser = await db.get(
      `SELECT id, email, username, role, name, phone, profile_image, is_active, email_verified, created_at
       FROM users WHERE id = ?`,
      [userId]
    );

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    await logAction(userId, 'update_profile', 'users', userId, { name, phone, profile_image }, req);

    // Emit real-time update for profile changes (including profile_image)
    if (global.io) {
      global.io.emit('profile_updated', {
        user_id: userId,
        profile_image: updatedUser.profile_image,
        name: updatedUser.name,
        phone: updatedUser.phone
      });
      console.log('Emitted profile_updated event for user:', userId);
    }

    res.json({
      message: 'Profile updated successfully',
      user: updatedUser
    });
  } catch (error) {
    console.error('Update profile error:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    
    // Provide specific error messages for production
    let errorMessage = 'Failed to update profile. Please try again.';
    if (error.message && error.message.includes('database')) {
      errorMessage = 'Database error. Please contact support if this persists.';
    }
    
    res.status(500).json({ error: errorMessage });
  }
});

// Request password reset
router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail()
], async (req, res) => {
  try {
    const { email } = req.body;

    const user = await db.get('SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) LIMIT 1', [email]);
    if (!user) {
      // Don't reveal if user exists for security
      return res.json({ message: 'If the email exists, a password reset link has been sent' });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.run(
      'UPDATE users SET password_reset_token = ?, password_reset_expires = ? WHERE id = ?',
      [resetToken, resetExpires.toISOString(), user.id]
    );

    // Use production frontend URL or construct from request
    const frontendUrl = process.env.FRONTEND_URL || (req.protocol + '://' + req.get('host').replace(/:\d+$/, ''));
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;
    await sendPasswordReset(email, resetToken, resetUrl);

    await logAction(user.id, 'password_reset_requested', 'auth', user.id, {}, req);

    res.json({ message: 'If the email exists, a password reset link has been sent' });
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// Reset password
router.post('/reset-password', [
  body('token').notEmpty(),
  body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
], async (req, res) => {
  try {
    const { token, password } = req.body;

    const user = await db.get(
      'SELECT id FROM users WHERE password_reset_token = ? AND password_reset_expires > datetime("now")',
      [token]
    );

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const passwordHash = await hashPassword(password);

    await db.run(
      'UPDATE users SET password_hash = ?, password_reset_token = NULL, password_reset_expires = NULL WHERE id = ?',
      [passwordHash, user.id]
    );

    await logAction(user.id, 'password_reset', 'auth', user.id, {}, req);

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Change password (authenticated)
router.post('/change-password', authenticateToken, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
], async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await db.get('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);

    const isValidPassword = await comparePassword(currentPassword, user.password_hash);
    if (!isValidPassword) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const passwordHash = await hashPassword(newPassword);

    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, req.user.id]);

    await logAction(req.user.id, 'password_changed', 'auth', req.user.id, {}, req);

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

module.exports = router;

