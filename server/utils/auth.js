const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

/**
 * Hash a password using bcrypt
 */
async function hashPassword(password) {
  const saltRounds = 10;
  return await bcrypt.hash(password, saltRounds);
}

/**
 * Compare password with hash
 */
async function comparePassword(password, hash) {
  return await bcrypt.compare(password, hash);
}

/**
 * Generate JWT token
 */
function generateToken(user) {
  const payload = {
    id: user.id,
    email: user.email,
    role: user.role,
    username: user.username,
    name: user.name || null
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verify JWT token
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

/**
 * Middleware to authenticate requests
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }

  req.user = decoded;
  next();
}

/**
 * Middleware to check role permissions
 */
function requireRole(...allowedRoles) {
  const flat = allowedRoles.flat();
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!flat.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}

const HR_OFFICER_EMAILS = ['samantha@prinstinegroup.org'];

/**
 * Middleware: Allow Admin, HumanResourcesDepartmentHead, or HR Officer by email (samantha@prinstinegroup.org)
 */
function requireStaffManagement(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const email = ((req.user.email ?? '') + '').toLowerCase().trim();
  const allowed =
    ['Admin', 'HumanResourcesDepartmentHead'].includes(req.user.role) ||
    HR_OFFICER_EMAILS.includes(email);
  if (!allowed) {
    return res.status(403).json({ error: 'Insufficient permissions for staff management' });
  }
  next();
}

/**
 * Middleware: Allow staff read access for Admin, HR Dept Head, HR Officer, or Department Head.
 */
function requireStaffRead(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const email = ((req.user.email ?? '') + '').toLowerCase().trim();
  const allowed =
    ['Admin', 'HumanResourcesDepartmentHead', 'DepartmentHead'].includes(req.user.role) ||
    HR_OFFICER_EMAILS.includes(email);
  if (!allowed) {
    return res.status(403).json({ error: 'Insufficient permissions to view staff' });
  }
  next();
}

/**
 * Check permission for a specific module and action
 */
async function checkPermission(db, role, module, action) {
  const permission = await db.get(
    'SELECT granted FROM permissions WHERE role = ? AND module = ? AND action = ?',
    [role, module, action]
  );
  return permission && permission.granted === 1;
}

/**
 * Middleware to check module permissions
 */
function requirePermission(module, action) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const db = require('../config/database');
    const hasPermission = await checkPermission(db, req.user.role, module, action);

    if (!hasPermission) {
      return res.status(403).json({ error: 'Insufficient permissions for this action' });
    }

    next();
  };
}

const {
  hasStudentPaymentAccess,
  getStudentPaymentAccessUserIds
} = require('./studentPaymentAccess');

/** @deprecated Use getStudentPaymentAccessUserIds — kept for existing imports */
async function getFinanceAccessUserIds() {
  return getStudentPaymentAccessUserIds();
}

/**
 * Middleware: Student Payments for Finance and Academy team (same processing access).
 */
function requireStudentPaymentAccess() {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (await hasStudentPaymentAccess(req.user)) return next();
    return res.status(403).json({
      error: 'Only Finance or Academy team members with student payment access can use this feature'
    });
  };
}

module.exports = {
  hashPassword,
  comparePassword,
  generateToken,
  verifyToken,
  authenticateToken,
  requireRole,
  requireStaffManagement,
  requireStaffRead,
  requireStudentPaymentAccess,
  getFinanceAccessUserIds,
  checkPermission,
  requirePermission
};

