#!/usr/bin/env node
/**
 * One-time: move legacy certificates.file_data_url blobs to disk and clear the column.
 * Usage: node scripts/migrate-certificate-files-to-disk.js
 */
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const { getUploadsRoot } = require('../utils/uploadsRoot');

function decodeDataUrlLocal(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const match = dataUrl.trim().match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) return null;
  try {
    return {
      mime: String(match[1] || 'application/octet-stream').toLowerCase(),
      buffer: Buffer.from(match[2], 'base64')
    };
  } catch (_e) {
    return null;
  }
}

async function main() {
  await db.connect();
  const uploadDir = path.join(getUploadsRoot(), 'certificates');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const rows = await db.all(
    `SELECT id, certificate_id, file_data_url, file_path, pdf_path
     FROM certificates
     WHERE file_data_url IS NOT NULL AND TRIM(file_data_url) != ''`
  );

  let migrated = 0;
  for (const row of rows || []) {
    const existing = row.file_path || row.pdf_path;
    if (existing && !String(existing).startsWith('data:')) {
      await db.run('UPDATE certificates SET file_data_url = NULL WHERE id = ?', [row.id]);
      migrated++;
      continue;
    }

    const decoded = decodeDataUrlLocal(row.file_data_url);
    if (!decoded?.buffer?.length) continue;

    const ext =
      decoded.mime === 'application/pdf'
        ? '.pdf'
        : decoded.mime === 'image/png'
          ? '.png'
          : '.jpg';
    const filename = `certificate-migrated-${row.id}-${Date.now()}${ext}`;
    const diskPath = path.join(uploadDir, filename);
    fs.writeFileSync(diskPath, decoded.buffer);
    const webPath = `/uploads/certificates/${filename}`;

    await db.run(
      `UPDATE certificates SET file_path = ?, pdf_path = ?, file_data_url = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [webPath, webPath, row.id]
    );
    migrated++;
    console.log(`Migrated certificate ${row.certificate_id || row.id} → ${webPath}`);
  }

  console.log(`Done. Processed ${(rows || []).length} row(s), updated ${migrated}.`);
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
