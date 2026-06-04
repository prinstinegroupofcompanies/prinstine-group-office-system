const path = require('path');
const fs = require('fs');
const { getUploadsRoot, resolveUploadsDiskPath } = require('./uploadsRoot');

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

/** Resolve persisted path (legacy web, absolute disk, pdf_path only, etc.) to an existing file path. */
function resolveCertificateAbsoluteDiskPath(record) {
  const raw = record.resolved_file_path || record.file_path || record.pdf_path || null;
  if (!raw) return null;

  if (/^https?:\/\//i.test(String(raw).trim())) {
    return null;
  }

  const webish = toPublicCertificatePath(raw);
  const candidates = [];

  if (webish && !/^https?:\/\//i.test(webish.trim())) {
    candidates.push(resolveUploadsDiskPath(webish));
  }
  candidates.push(resolveUploadsDiskPath(raw));

  const seen = new Set();
  for (const candidate of candidates) {
    const key = candidate || '';
    if (!candidate || seen.has(key)) continue;
    seen.add(key);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function decodeDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const trimmed = dataUrl.trim();
  const match = trimmed.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) return null;
  try {
    return {
      mime: String(match[1] || 'application/octet-stream').toLowerCase(),
      buffer: Buffer.from(match[2], 'base64')
    };
  } catch (_err) {
    return null;
  }
}

function sendCertificateDataUrlResponse(res, dataUrl, friendlyCertificateId) {
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded || !decoded.buffer) {
    res.status(404).json({ error: 'Certificate file data is not available' });
    return;
  }

  const { mime, buffer } = decoded;
  const ext =
    mime === 'application/pdf'
      ? '.pdf'
      : mime === 'image/png'
        ? '.png'
        : mime === 'image/jpeg'
          ? '.jpg'
          : '';
  const safeSlug = String(friendlyCertificateId || 'CERT').replace(/[^\w.-]/g, '_').slice(0, 200);
  const filename = ext ? `certificate-${safeSlug}${ext}` : `certificate-${safeSlug}`;

  res.setHeader('Content-Type', mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
}

function sendCertificateFileResponse(res, absDiskPath, friendlyCertificateId) {
  if (!absDiskPath || !fs.existsSync(absDiskPath)) {
    res.status(404).json({ error: 'Certificate file not found on server' });
    return;
  }

  const extLower = path.extname(absDiskPath).toLowerCase();
  const mime =
    extLower === '.pdf'
      ? 'application/pdf'
      : extLower === '.png'
        ? 'image/png'
        : extLower === '.jpg' || extLower === '.jpeg'
          ? 'image/jpeg'
          : 'application/octet-stream';

  const safeSlug = String(friendlyCertificateId || 'CERT').replace(/[^\w.-]/g, '_').slice(0, 200);
  const filename = extLower ? `certificate-${safeSlug}${extLower}` : `certificate-${safeSlug}`;

  const absolute = path.resolve(absDiskPath);
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  res.sendFile(absolute);
}

/**
 * Serve certificate bytes: prefer on-disk file (fast), fall back to legacy DB data URL only.
 * @param {object} cert — needs certificate_id, file_path/pdf_path/resolved_file_path, optional file_data_url
 */
async function deliverCertificateBinary(res, db, cert, options = {}) {
  const notFoundMessage = options.notFoundMessage || 'Certificate file not found on server';

  const absDiskPath = resolveCertificateAbsoluteDiskPath(cert);
  if (absDiskPath && fs.existsSync(absDiskPath)) {
    sendCertificateFileResponse(res, absDiskPath, cert.certificate_id);
    return;
  }

  if (cert.file_data_url) {
    const decoded = decodeDataUrl(cert.file_data_url);
    if (decoded && decoded.buffer && decoded.buffer.length) {
      sendCertificateDataUrlResponse(res, cert.file_data_url, cert.certificate_id);
      return;
    }
  }

  res.status(404).json({ error: notFoundMessage });
}

module.exports = {
  toPublicCertificatePath,
  resolveCertificateAbsoluteDiskPath,
  deliverCertificateBinary
};
