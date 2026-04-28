const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticateToken, requireRole } = require('../utils/auth');
const { logAction } = require('../utils/audit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { normalizeProfileImage } = require('../utils/normalizeProfileImage');
const { getUploadsRoot, resolveUploadsDiskPath } = require('../utils/uploadsRoot');

// Configure multer for certificate file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(getUploadsRoot(), 'certificates');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `certificate-${uniqueSuffix}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PNG, JPEG, and PDF files are allowed.'), false);
  }
};

const certificateMaxUploadBytes = Number(process.env.CERTIFICATE_MAX_FILE_SIZE_MB || 0) > 0
  ? Number(process.env.CERTIFICATE_MAX_FILE_SIZE_MB) * 1024 * 1024
  : null;

const uploadOptions = {
  storage: storage,
  fileFilter: fileFilter
};
if (certificateMaxUploadBytes) {
  uploadOptions.limits = { fileSize: certificateMaxUploadBytes };
}

const upload = multer(uploadOptions);

function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (unlinkErr) {
    console.error('Failed to remove file:', filePath, unlinkErr.message);
  }
}

function handleCertificateUpload(req, res, next) {
  upload.single('certificate_file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        const sizeInfo = certificateMaxUploadBytes
          ? `${Math.round(certificateMaxUploadBytes / (1024 * 1024))}MB`
          : 'the configured server limit';
        return res.status(413).json({
          error: `Certificate file is too large. Please upload a smaller file or increase server limit (${sizeInfo}).`
        });
      }
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    return res.status(400).json({ error: err.message || 'Invalid upload request' });
  });
}

// Generate certificate ID
function generateCertificateId() {
  return 'CERT-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase();
}

async function isAcademyTeam(user) {
  if (!user) return false;
  if (user.role === 'Admin') return true;
  if (user.role === 'Instructor') return true;
  if (user.role === 'DepartmentHead') {
    try {
      const dept = await db.get('SELECT name FROM departments WHERE manager_id = ?', [user.id]);
      const deptName = String(dept?.name || '').toLowerCase();
      return deptName.includes('academy') || deptName.includes('elearning') || deptName.includes('e-learning');
    } catch (_err) {
      return false;
    }
  }
  if (user.role === 'Staff') {
    try {
      const staff = await db.get('SELECT department, position FROM staff WHERE user_id = ?', [user.id]);
      const deptName = String(staff?.department || '').toLowerCase();
      const positionName = String(staff?.position || '').toLowerCase();
      return (
        deptName.includes('academy') ||
        deptName.includes('elearning') ||
        deptName.includes('e-learning') ||
        (positionName.includes('academy') && positionName.includes('coordinator'))
      );
    } catch (_err) {
      return false;
    }
  }
  return false;
}

function isCertificateWindowOpenForCohort(row) {
  const enabled = Number(row?.cert_access_enabled || 0) === 1;
  if (!enabled) return false;
  const now = new Date();
  if (row?.cert_access_start) {
    const start = new Date(row.cert_access_start);
    if (now < start) return false;
  }
  if (row?.cert_access_end) {
    const end = new Date(row.cert_access_end);
    if (now > end) return false;
  }
  return true;
}

function toPublicCertificatePath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return null;
  const trimmed = rawPath.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
    return trimmed;
  }
  if (trimmed.startsWith('/uploads/')) return trimmed;
  if (trimmed.startsWith('uploads/')) return `/${trimmed}`;

  const normalized = path.resolve(trimmed);
  const uploadsRoot = path.resolve(getUploadsRoot());

  if (normalized.startsWith(uploadsRoot)) {
    const rel = path.relative(uploadsRoot, normalized).split(path.sep).join('/');
    return rel ? `/uploads/${rel}` : '/uploads';
  }

  const marker = '/uploads/';
  const markerIdx = normalized.split(path.sep).join('/').indexOf(marker);
  if (markerIdx >= 0) {
    return normalized.split(path.sep).join('/').slice(markerIdx);
  }

  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function normalizeCertificateRow(certificate) {
  if (!certificate) return certificate;
  const resolvedFilePath = toPublicCertificatePath(certificate.file_path || certificate.pdf_path || null);
  const inferredType = String(resolvedFilePath || '').toLowerCase().endsWith('.pdf')
    ? 'pdf'
    : (String(resolvedFilePath || '').toLowerCase().endsWith('.png') ? 'png' : (resolvedFilePath ? 'jpeg' : null));
  return {
    ...certificate,
    file_path: resolvedFilePath,
    file_type: certificate.file_type || inferredType
  };
}

async function getCertificateColumnNames() {
  try {
    const pragma = await db.all("PRAGMA table_info(certificates)");
    if (Array.isArray(pragma) && pragma.length > 0) {
      return pragma.map((c) => c.name);
    }
  } catch (_err) {}
  try {
    const cols = await db.all("SELECT column_name FROM information_schema.columns WHERE table_name = 'certificates' AND table_schema = 'public'");
    if (Array.isArray(cols) && cols.length > 0) {
      return cols.map((c) => c.column_name);
    }
  } catch (_err) {}
  return [];
}

async function ensureCertificateStorageColumns() {
  const certColumns = await getCertificateColumnNames();
  try {
    if (!certColumns.includes('file_path')) {
      await db.run('ALTER TABLE certificates ADD COLUMN file_path TEXT');
    }
  } catch (_err) {}
  try {
    if (!certColumns.includes('file_type')) {
      await db.run('ALTER TABLE certificates ADD COLUMN file_type TEXT');
    }
  } catch (_err) {}
  try {
    if (!certColumns.includes('completion_date')) {
      await db.run('ALTER TABLE certificates ADD COLUMN completion_date DATE');
    }
  } catch (_err) {}
}

router.use(async (_req, _res, next) => {
  try {
    await ensureCertificateStorageColumns();
  } catch (_err) {
    // non-fatal; route handlers will surface concrete DB errors if any
  }
  next();
});

// Get all certificates (Admin + Academy team)
router.get('/', authenticateToken, requireRole('Admin', 'Staff', 'Instructor', 'DepartmentHead'), async (req, res) => {
  try {
    const hasAccess = await isAcademyTeam(req.user);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Only Academy team and Admin can view certificates' });
    }
    const { search, student_id, course_id } = req.query;
    let query = `
      SELECT c.*, 
             s.student_id as student_code,
             u.name as student_name,
             u.profile_image as student_image,
             co.course_code,
             co.title as course_title,
             co.start_date as course_start_date,
             co.end_date as course_end_date,
             s.cohort_id,
             ch.name as cohort_name
      FROM certificates c
      JOIN students s ON c.student_id = s.id
      JOIN users u ON s.user_id = u.id
      JOIN courses co ON c.course_id = co.id
      LEFT JOIN cohorts ch ON ch.id = s.cohort_id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      query += ' AND (u.name LIKE ? OR s.student_id LIKE ? OR c.certificate_id LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }
    if (student_id) {
      query += ' AND c.student_id = ?';
      params.push(student_id);
    }
    if (course_id) {
      query += ' AND c.course_id = ?';
      params.push(course_id);
    }

    query += ' ORDER BY c.created_at DESC';

    const certificates = await db.all(query, params);
    res.json({ certificates: certificates.map(normalizeCertificateRow) });
  } catch (error) {
    console.error('Get certificates error:', error);
    res.status(500).json({ error: 'Failed to fetch certificates' });
  }
});

// Search certificates by student name or ID (Admin/Academy team)
router.get('/search/:query', authenticateToken, requireRole('Admin', 'Staff', 'Instructor', 'DepartmentHead'), async (req, res) => {
  try {
    const hasAccess = await isAcademyTeam(req.user);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Only Academy team and Admin can search certificates' });
    }
    const query = req.params.query;

    const certificates = await db.all(
      `SELECT c.*, 
              s.student_id as student_code,
              u.name as student_name,
              u.profile_image as student_image,
              co.course_code,
              co.title as course_title,
              co.start_date as course_start_date,
              co.end_date as course_end_date
       FROM certificates c
       JOIN students s ON c.student_id = s.id
       JOIN users u ON s.user_id = u.id
       JOIN courses co ON c.course_id = co.id
       WHERE u.name LIKE ? OR s.student_id LIKE ? OR c.certificate_id LIKE ?
       ORDER BY c.created_at DESC`,
      [`%${query}%`, `%${query}%`, `%${query}%`]
    );

    res.json({ certificates: certificates.map(normalizeCertificateRow) });
  } catch (error) {
    console.error('Search certificates error:', error);
    res.status(500).json({ error: 'Failed to search certificates' });
  }
});

// Get certificate by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const certificateId = req.params.id;

    const certificate = await db.get(
      `SELECT c.*, 
              s.student_id as student_code,
              u.name as student_name,
              u.profile_image as student_image,
              u.email as student_email,
              co.course_code,
              co.title as course_title,
              co.description as course_description,
              co.start_date as course_start_date,
              co.end_date as course_end_date,
              co.mode as course_mode
       FROM certificates c
       JOIN students s ON c.student_id = s.id
       JOIN users u ON s.user_id = u.id
       JOIN courses co ON c.course_id = co.id
       WHERE c.id = ? OR c.certificate_id = ?`,
      [certificateId, certificateId]
    );

    if (!certificate) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    // Check permissions - Academy team/Admin can see all, students can only see their own
    const canAcademyViewAll = await isAcademyTeam(req.user);
    if (!canAcademyViewAll) {
      const student = await db.get('SELECT id FROM students WHERE user_id = ?', [req.user.id]);
      if (!student || certificate.student_id !== student.id) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
    }

    res.json({ certificate: normalizeCertificateRow(certificate) });
  } catch (error) {
    console.error('Get certificate error:', error);
    res.status(500).json({ error: 'Failed to fetch certificate' });
  }
});

// Create certificate with file upload (Admin + Academy team)
router.post('/', authenticateToken, requireRole('Admin', 'Staff', 'Instructor', 'DepartmentHead'), handleCertificateUpload, [
  body('student_id').isInt().withMessage('Student ID is required'),
  body('course_id').isInt().withMessage('Course ID is required')
], async (req, res) => {
  try {
    const hasAccess = await isAcademyTeam(req.user);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Only Academy team and Admin can create certificates' });
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { student_id, course_id, grade, issue_date, completion_date } = req.body;

    // Verify student exists
    const student = await db.get('SELECT id, user_id FROM students WHERE id = ?', [student_id]);
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Verify course exists
    const course = await db.get('SELECT id, course_code, title, start_date, end_date FROM courses WHERE id = ?', [course_id]);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Check if certificate already exists for this student and course
    const existing = await db.get(
      'SELECT id FROM certificates WHERE student_id = ? AND course_id = ?',
      [student_id, course_id]
    );
    if (existing) {
      return res.status(400).json({ error: 'Certificate already exists for this student and course' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Certificate file is required' });
    }

    const certificateId = generateCertificateId();
    const verificationCode = crypto.randomBytes(16).toString('hex').toUpperCase();

    // Determine file type
    const fileExt = path.extname(req.file.filename).toLowerCase();
    const fileType = fileExt === '.pdf' ? 'pdf' : fileExt === '.png' ? 'png' : 'jpeg';
    const filePath = `/uploads/certificates/${req.file.filename}`;

    const certColumns = await getCertificateColumnNames();
    const fields = ['certificate_id', 'student_id', 'course_id', 'issue_date', 'grade', 'verification_code'];
    const values = [
      certificateId,
      student_id,
      course_id,
      issue_date || new Date().toISOString().split('T')[0],
      grade || null,
      verificationCode
    ];
    if (certColumns.includes('file_path')) {
      fields.push('file_path');
      values.push(filePath);
    }
    if (certColumns.includes('file_type')) {
      fields.push('file_type');
      values.push(fileType);
    }
    if (certColumns.includes('completion_date')) {
      fields.push('completion_date');
      values.push(completion_date || null);
    }
    if (certColumns.includes('pdf_path')) {
      fields.push('pdf_path');
      values.push(filePath);
    }

    const placeholders = fields.map(() => '?').join(', ');
    const result = await db.run(
      `INSERT INTO certificates (${fields.join(', ')}) VALUES (${placeholders})`,
      values
    );

    // Update enrollment status if exists
    const enrollment = await db.get(
      'SELECT id FROM enrollments WHERE student_id = ? AND course_id = ?',
      [student_id, course_id]
    );
    if (enrollment) {
      await db.run(
        'UPDATE enrollments SET status = ?, completion_date = ? WHERE student_id = ? AND course_id = ?',
        ['Completed', completion_date || new Date().toISOString().split('T')[0], student_id, course_id]
      );
    }

    await logAction(req.user.id, 'create_certificate', 'certificates', result.lastID, { certificateId }, req);

    res.status(201).json({
      message: 'Certificate created successfully',
      certificate: {
        id: result.lastID,
        certificate_id: certificateId,
        verification_code: verificationCode,
        file_path: filePath
      }
    });
  } catch (error) {
    console.error('Create certificate error:', error);
    if (req.file) {
      // Delete uploaded file on error
      safeUnlink(req.file.path);
    }
    res.status(500).json({ error: 'Failed to create certificate: ' + error.message });
  }
});

// Update certificate (Admin + Academy team)
router.put('/:id', authenticateToken, requireRole('Admin', 'Staff', 'Instructor', 'DepartmentHead'), handleCertificateUpload, async (req, res) => {
  try {
    const hasAccess = await isAcademyTeam(req.user);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Only Academy team and Admin can edit certificates' });
    }
    const certificateId = req.params.id;
    const { grade, issue_date, completion_date } = req.body;

    const certificate = await db.get(
      'SELECT id, COALESCE(file_path, pdf_path) as file_path FROM certificates WHERE id = ?',
      [certificateId]
    );
    if (!certificate) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    const updates = [];
    const params = [];

    if (grade !== undefined) {
      updates.push('grade = ?');
      params.push(grade);
    }
    if (issue_date !== undefined) {
      updates.push('issue_date = ?');
      params.push(issue_date);
    }
    if (completion_date !== undefined) {
      updates.push('completion_date = ?');
      params.push(completion_date);
    }

    // Handle file update
    if (req.file) {
      // Delete old file
      if (certificate.file_path) {
        const oldFilePath = resolveUploadsDiskPath(certificate.file_path);
        safeUnlink(oldFilePath);
      }

      const fileExt = path.extname(req.file.filename).toLowerCase();
      const fileType = fileExt === '.pdf' ? 'pdf' : fileExt === '.png' ? 'png' : 'jpeg';
      const filePath = `/uploads/certificates/${req.file.filename}`;

      const certColumns = await getCertificateColumnNames();
      if (certColumns.includes('file_path')) {
        updates.push('file_path = ?');
        params.push(filePath);
      }
      if (certColumns.includes('pdf_path')) {
        updates.push('pdf_path = ?');
        params.push(filePath);
      }
      if (certColumns.includes('file_type')) {
        updates.push('file_type = ?');
        params.push(fileType);
      }
    }

    if (updates.length > 0) {
      params.push(certificateId);
      await db.run(
        `UPDATE certificates SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        params
      );
    }

    await logAction(req.user.id, 'update_certificate', 'certificates', certificateId, req.body, req);

    res.json({ message: 'Certificate updated successfully' });
  } catch (error) {
    console.error('Update certificate error:', error);
    if (req.file) {
      safeUnlink(req.file.path);
    }
    res.status(500).json({ error: 'Failed to update certificate' });
  }
});

// Delete certificate (Admin + Academy team)
router.delete('/:id', authenticateToken, requireRole('Admin', 'Staff', 'Instructor', 'DepartmentHead'), async (req, res) => {
  try {
    const hasAccess = await isAcademyTeam(req.user);
    if (!hasAccess) {
      return res.status(403).json({ error: 'Only Academy team and Admin can delete certificates' });
    }
    const certificateId = req.params.id;

    const certificate = await db.get(
      'SELECT COALESCE(file_path, pdf_path) as file_path FROM certificates WHERE id = ?',
      [certificateId]
    );
    if (!certificate) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    // Delete file
    if (certificate.file_path) {
      const filePath = resolveUploadsDiskPath(certificate.file_path);
      if (filePath && fs.existsSync(filePath)) {
        safeUnlink(filePath);
      }
    }

    await db.run('DELETE FROM certificates WHERE id = ?', [certificateId]);

    await logAction(req.user.id, 'delete_certificate', 'certificates', certificateId, {}, req);

    res.json({ message: 'Certificate deleted successfully' });
  } catch (error) {
    console.error('Delete certificate error:', error);
    res.status(500).json({ error: 'Failed to delete certificate' });
  }
});

// Public verification by student name and ID
router.post('/verify', async (req, res) => {
  try {
    const { student_name, student_id } = req.body;

    if (!student_name || !student_id) {
      return res.status(400).json({ error: 'Student name and ID are required' });
    }

    const certificates = await db.all(
      `SELECT c.*, 
              s.student_id as student_code,
              s.cohort_id,
              u.name as student_name,
              u.profile_image as student_image,
              co.course_code,
              co.title as course_title,
              co.start_date as course_start_date,
              co.end_date as course_end_date,
              ch.name as cohort_name,
              ch.cert_access_enabled,
              ch.cert_access_start,
              ch.cert_access_end
       FROM certificates c
       JOIN students s ON c.student_id = s.id
       JOIN users u ON s.user_id = u.id
       JOIN courses co ON c.course_id = co.id
       LEFT JOIN cohorts ch ON ch.id = s.cohort_id
       WHERE LOWER(u.name) = LOWER(?) AND s.student_id = ?`,
      [student_name.trim(), student_id.trim()]
    );

    if (!certificates || certificates.length === 0) {
      return res.status(404).json({ error: 'Certificate not found. Please verify the student name and ID.' });
    }

    const blockedByWindow = certificates.some((row) => !isCertificateWindowOpenForCohort(row));
    if (blockedByWindow) {
      return res.status(403).json({
        error: 'Certificate access for this cohort is currently closed. Please contact Academy administration.'
      });
    }

    const first = certificates[0];

    res.json({
      valid: true,
      student: {
        full_name: first.student_name,
        student_id: first.student_code,
        profile_image: normalizeProfileImage(first.student_image),
        cohort_id: first.cohort_id,
        cohort_name: first.cohort_name || null
      },
      certificates: certificates.map((certificate) => ({
        id: certificate.id,
        certificate_id: certificate.certificate_id,
        course_code: certificate.course_code,
        course_title: certificate.course_title,
        course_start_date: certificate.course_start_date,
        course_end_date: certificate.course_end_date,
        issue_date: certificate.issue_date,
        completion_date: certificate.completion_date,
        grade: certificate.grade,
        file_path: toPublicCertificatePath(certificate.file_path || certificate.pdf_path || null),
        file_type: certificate.file_type || (String(certificate.file_path || certificate.pdf_path || '').toLowerCase().endsWith('.pdf') ? 'pdf' : 'image'),
        verification_code: certificate.verification_code
      })),
      access_window: {
        enabled: Number(first.cert_access_enabled || 0) === 1,
        start: first.cert_access_start || null,
        end: first.cert_access_end || null
      }
    });
  } catch (error) {
    console.error('Verify certificate error:', error);
    res.status(500).json({ error: 'Failed to verify certificate' });
  }
});

// Download certificate in different formats
router.get('/:id/download/:format', authenticateToken, async (req, res) => {
  try {
    const certificateId = req.params.id;
    const format = req.params.format.toLowerCase();

    if (!['png', 'jpeg', 'pdf', 'original'].includes(format)) {
      return res.status(400).json({ error: 'Invalid format. Use png, jpeg, pdf, or original' });
    }

    const certificate = await db.get(
      `SELECT c.*, s.student_id as student_code, COALESCE(c.file_path, c.pdf_path) as resolved_file_path
       FROM certificates c
       JOIN students s ON c.student_id = s.id
       WHERE c.id = ? OR c.certificate_id = ?`,
      [certificateId, certificateId]
    );

    if (!certificate) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    // Check permissions - Academy team/Admin can download all, students can only download their own
    const canAcademyViewAll = await isAcademyTeam(req.user);
    if (!canAcademyViewAll) {
      const student = await db.get('SELECT id FROM students WHERE user_id = ?', [req.user.id]);
      if (!student || certificate.student_id !== student.id) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
    }

    if (!certificate.resolved_file_path) {
      return res.status(404).json({ error: 'Certificate file not found' });
    }

    const filePath = resolveUploadsDiskPath(certificate.resolved_file_path);

    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Certificate file not found on server' });
    }

    // If requesting original format, serve the file as-is
    if (format === 'original' || format === certificate.file_type) {
      const ext = path.extname(filePath);
      const contentType = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : 'image/jpeg';
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="certificate-${certificate.certificate_id}${ext}"`);
      return res.sendFile(path.resolve(filePath));
    }

    // For format conversion, we would need image processing libraries
    // For now, return the original file with appropriate headers
    const ext = path.extname(filePath);
    const contentType = format === 'pdf' ? 'application/pdf' : format === 'png' ? 'image/png' : 'image/jpeg';
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="certificate-${certificate.certificate_id}.${format}"`);
    res.sendFile(path.resolve(filePath));
  } catch (error) {
    console.error('Download certificate error:', error);
    res.status(500).json({ error: 'Failed to download certificate' });
  }
});

// Public download endpoint (for verified certificates)
router.get('/public/:id/download/:format', async (req, res) => {
  try {
    const certificateId = req.params.id;
    const format = req.params.format.toLowerCase();

    if (!['png', 'jpeg', 'pdf', 'original'].includes(format)) {
      return res.status(400).json({ error: 'Invalid format' });
    }

    const certificate = await db.get(
      `SELECT COALESCE(c.file_path, c.pdf_path) as file_path, c.certificate_id, c.file_type,
              ch.cert_access_enabled, ch.cert_access_start, ch.cert_access_end
       FROM certificates c
       JOIN students s ON s.id = c.student_id
       LEFT JOIN cohorts ch ON ch.id = s.cohort_id
       WHERE c.id = ? OR c.certificate_id = ?`,
      [certificateId, certificateId]
    );

    if (!certificate) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    if (!isCertificateWindowOpenForCohort(certificate)) {
      return res.status(403).json({ error: 'Certificate access window is closed for this cohort' });
    }

    if (!certificate.file_path) {
      return res.status(404).json({ error: 'Certificate file not found' });
    }

    const filePath = resolveUploadsDiskPath(certificate.file_path);

    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Certificate file not found' });
    }

    const ext = path.extname(filePath);
    const contentType = format === 'pdf' || ext === '.pdf' ? 'application/pdf' : 
                       format === 'png' || ext === '.png' ? 'image/png' : 'image/jpeg';
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="certificate-${certificate.certificate_id}.${format}"`);
    res.sendFile(path.resolve(filePath));
  } catch (error) {
    console.error('Public download certificate error:', error);
    res.status(500).json({ error: 'Failed to download certificate' });
  }
});

module.exports = router;

