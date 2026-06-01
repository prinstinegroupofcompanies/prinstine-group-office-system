const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../utils/auth');
const { logAction } = require('../utils/audit');
const {
  PERMISSION_DEFINITIONS,
  ASSIGNABLE_TO_STAFF_KEYS,
  canManageAcademyPermissions,
  getStoredPermissionsForUser,
  listAcademyStaffForPermissions,
  setStaffAcademyPermissions,
  resolveAcademyPermissions,
  isAcademyDepartmentHead
} = require('../utils/academyPermissions');

/** Current user's academy access (for sidebar / menu gating) */
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const academyPermissions = await resolveAcademyPermissions(req.user);
    const isAcademyDeptHead = await isAcademyDepartmentHead(req.user);
    const role = req.user.role;
    const isAcademyStaff =
      role === 'Admin' ||
      role === 'Instructor' ||
      isAcademyDeptHead ||
      academyPermissions.length > 0;
    const hasAccess =
      role === 'Admin' ||
      role === 'Instructor' ||
      isAcademyDeptHead ||
      academyPermissions.length > 0;

    res.json({
      hasAccess,
      academyPermissions,
      isAcademyDepartmentHead: isAcademyDeptHead,
      isAcademyStaff: !!isAcademyStaff
    });
  } catch (e) {
    console.error('Academy permissions me error:', e);
    res.status(500).json({ error: 'Failed to load academy access' });
  }
});

router.get('/definitions', authenticateToken, async (req, res) => {
  try {
    if (!(await canManageAcademyPermissions(req.user))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json({
      definitions: PERMISSION_DEFINITIONS,
      assignableKeys: ASSIGNABLE_TO_STAFF_KEYS
    });
  } catch (e) {
    console.error('Academy permission definitions error:', e);
    res.status(500).json({ error: 'Failed to load permission definitions' });
  }
});

router.get('/staff', authenticateToken, async (req, res) => {
  try {
    if (!(await canManageAcademyPermissions(req.user))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const staff = await listAcademyStaffForPermissions();
    res.json({ staff });
  } catch (e) {
    console.error('Academy staff permissions list error:', e);
    res.status(500).json({ error: 'Failed to list academy staff' });
  }
});

router.get('/user/:userId', authenticateToken, async (req, res) => {
  try {
    if (!(await canManageAcademyPermissions(req.user))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const userId = parseInt(req.params.userId, 10);
    if (Number.isNaN(userId)) return res.status(400).json({ error: 'Invalid user id' });
    const permissions = await getStoredPermissionsForUser(userId);
    res.json({ userId, permissions });
  } catch (e) {
    console.error('Get user academy permissions error:', e);
    res.status(500).json({ error: 'Failed to fetch permissions' });
  }
});

router.put(
  '/user/:userId',
  authenticateToken,
  [body('permissions').isArray().withMessage('permissions must be an array')],
  async (req, res) => {
    try {
      if (!(await canManageAcademyPermissions(req.user))) {
        return res.status(403).json({ error: 'Access denied' });
      }
      const errs = validationResult(req);
      if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });

      const userId = parseInt(req.params.userId, 10);
      if (Number.isNaN(userId)) return res.status(400).json({ error: 'Invalid user id' });

      const permissions = await setStaffAcademyPermissions(
        userId,
        req.body.permissions,
        req.user.id
      );

      await logAction(
        req.user.id,
        'set_academy_permissions',
        'academy',
        userId,
        { permissions },
        req
      );

      res.json({ message: 'Academy permissions updated', userId, permissions });
    } catch (e) {
      console.error('Set academy permissions error:', e);
      const status = e.statusCode || 500;
      res.status(status).json({ error: e.message || 'Failed to update permissions' });
    }
  }
);

module.exports = router;
