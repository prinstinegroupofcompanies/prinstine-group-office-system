const path = require('path');

/**
 * Absolute path to the uploads root directory.
 * Must match server.js: UPLOADS_DIR env, or server/uploads (symlinked to persistent disk on Render).
 */
function getUploadsRoot() {
  return path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'));
}

/**
 * Map a stored public path like /uploads/certificates/foo.pdf to an absolute disk path
 * under getUploadsRoot(). Handles legacy paths without a leading slash.
 */
function resolveUploadsDiskPath(webOrRelativePath) {
  if (!webOrRelativePath || typeof webOrRelativePath !== 'string') return null;
  let rel = webOrRelativePath.trim();
  // Legacy rows may store an absolute filesystem path (not under /uploads/).
  if (rel.startsWith('/') && !rel.startsWith('/uploads/')) {
    return path.resolve(rel);
  }
  if (rel.startsWith('/uploads/')) {
    rel = rel.slice('/uploads/'.length);
  } else if (rel.startsWith('uploads/')) {
    rel = rel.slice('uploads/'.length);
  }
  return path.join(getUploadsRoot(), rel);
}

module.exports = { getUploadsRoot, resolveUploadsDiskPath };
