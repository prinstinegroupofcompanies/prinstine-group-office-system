/**
 * Multer config for entity profile images (staff, student, instructor, client, partner, user).
 * Storage: uploads/entity-images/ - permanent, on-disk. Never deleted when updating profile images.
 * Used by forms when creating/editing entities; caller saves URL via create/update API.
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ALLOWED_TYPES = ['staff', 'student', 'instructor', 'client', 'partner', 'user'];
const BASE_DIR = path.join(__dirname, '../../uploads/entity-images');

if (!fs.existsSync(BASE_DIR)) {
  fs.mkdirSync(BASE_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, BASE_DIR);
  },
  filename: (req, file, cb) => {
    const type = ((req.body && req.body.type) || 'user').toString().toLowerCase();
    const safeType = ALLOWED_TYPES.includes(type) ? type : 'user';
    const uuid = crypto.randomBytes(8).toString('hex');
    const ext = (path.extname(file.originalname) || '').toLowerCase() || '.jpg';
    const safeExt = /^\.(jpe?g|png|gif|webp)$/.test(ext) ? ext : '.jpg';
    cb(null, `${safeType}-${uuid}${safeExt}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|webp/;
  const ext = path.extname(file.originalname).toLowerCase();
  const mimetype = (file.mimetype || '').toLowerCase();
  if (allowed.test(ext.replace('.', '')) && mimetype.startsWith('image/')) {
    return cb(null, true);
  }
  cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'));
};

const uploadEntityImage = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter
});

module.exports = { uploadEntityImage, ALLOWED_TYPES, BASE_DIR };
