const express = require('express');
const router = express.Router();
const upload = require('../utils/upload');
const uploadClaims = require('../utils/uploadClaims');
const uploadCommunications = require('../utils/uploadCommunications');
const uploadReports = require('../utils/uploadReports');
const { uploadEntityImage } = require('../utils/uploadEntityImages');
const { authenticateToken } = require('../utils/auth');
const path = require('path');
const fs = require('fs');

// Upload profile image - permanently stored on server
router.post('/profile-image', authenticateToken, upload.single('image'), async (req, res) => {
  const db = require('../config/database');
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const userId = req.user.id;
    
    // Get user's current profile image to delete old one
    const user = await db.get('SELECT profile_image FROM users WHERE id = ?', [userId]);
    
    // Delete old profile image if it exists (only under profile-images; never touch entity-images)
    if (user && user.profile_image) {
      try {
        let oldImagePath = user.profile_image;
        if (oldImagePath.includes('/uploads/')) {
          const pathMatch = oldImagePath.match(/\/uploads\/[^?]+/);
          if (pathMatch) oldImagePath = pathMatch[0];
        }
        if (oldImagePath.includes('/uploads/profile-images/')) {
          const oldImageFullPath = path.join(__dirname, '../..', oldImagePath);
          const normalizedOldPath = path.normalize(oldImageFullPath);
          const profileImagesDir = path.normalize(path.join(__dirname, '../../uploads/profile-images'));
          if (normalizedOldPath.startsWith(profileImagesDir) && fs.existsSync(normalizedOldPath)) {
            fs.unlinkSync(normalizedOldPath);
            console.log('Deleted old profile image:', normalizedOldPath);
          }
        }
      } catch (deleteError) {
        console.warn('Could not delete old profile image (non-fatal):', deleteError.message);
      }
    }

    // Return relative URL in consistent format - stored permanently on server
    // Format: /uploads/profile-images/profile-{userId}-{timestamp}-{random}.ext
    const imageUrl = `/uploads/profile-images/${req.file.filename}`;
    
    console.log('Profile image uploaded:', {
      userId: userId,
      filename: req.file.filename,
      path: req.file.path,
      size: req.file.size,
      imageUrl: imageUrl
    });
    
    // Update user's profile_image in database immediately for persistence
    try {
      await db.run('UPDATE users SET profile_image = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [imageUrl, userId]);
      
      // Emit real-time update
      if (global.io) {
        global.io.emit('profile_updated', {
          user_id: userId,
          profile_image: imageUrl,
          name: req.user.name
        });
      }
    } catch (dbError) {
      console.error('Error updating profile_image in database:', dbError);
      // Continue even if DB update fails - file is uploaded
    }
    
    res.json({
      message: 'Profile image uploaded and saved successfully',
      imageUrl: imageUrl,
      filename: req.file.filename
    });
  } catch (error) {
    console.error('Profile image upload error:', error);
    
    // Clean up uploaded file if database operation failed
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error('Error cleaning up uploaded file:', cleanupError);
      }
    }
    
    // Provide specific error messages
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Image size too large. Maximum size is 5MB.' });
    }
    if (error.message && error.message.includes('Only image files')) {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to upload profile image. Please try again.' });
  }
});

// Upload entity profile image (staff, student, instructor, client, partner, user).
// Permanent storage under uploads/entity-images/. Files are never deleted when profile is updated.
// Caller persists imageUrl via create/update API.
router.post('/entity-image', authenticateToken, uploadEntityImage.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const relativePath = `/uploads/entity-images/${req.file.filename}`;
    res.json({
      message: 'Image uploaded successfully',
      imageUrl: relativePath,
      url: relativePath,
      filename: req.file.filename
    });
  } catch (error) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Image size too large. Maximum size is 5MB.' });
    }
    if (error.message && error.message.includes('Only image files')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to upload image. Please try again.' });
  }
});

// Upload communication attachment (authenticated users)
router.post('/communication', authenticateToken, uploadCommunications.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Return full URL for communication attachments - use production URL
    const baseUrl = process.env.API_BASE_URL || process.env.FRONTEND_URL || (req.protocol + '://' + req.get('host'));
    const fileUrl = `${baseUrl}/uploads/communications/${req.file.filename}`;
    
    console.log('Communication attachment uploaded:', {
      filename: req.file.filename,
      path: req.file.path,
      size: req.file.size,
      mimetype: req.file.mimetype,
      fileUrl: fileUrl
    });
    
    res.json({
      message: 'File uploaded successfully',
      url: fileUrl,
      filename: req.file.filename
    });
  } catch (error) {
    console.error('Upload error:', error);
    if (error.message.includes('File type not allowed')) {
      return res.status(400).json({ error: error.message });
    }
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size too large. Maximum size is 10MB.' });
    }
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Upload report attachment (authenticated users)
router.post('/report', authenticateToken, uploadReports.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Return full URL for report attachments - use production URL
    const baseUrl = process.env.API_BASE_URL || process.env.FRONTEND_URL || (req.protocol + '://' + req.get('host'));
    const fileUrl = `${baseUrl}/uploads/reports/${req.file.filename}`;
    
    console.log('Report attachment uploaded:', {
      filename: req.file.filename,
      path: req.file.path,
      size: req.file.size,
      mimetype: req.file.mimetype,
      fileUrl: fileUrl
    });
    
    res.json({
      message: 'File uploaded successfully',
      url: fileUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
  } catch (error) {
    console.error('Upload error:', error);
    if (error.message.includes('File type not allowed')) {
      return res.status(400).json({ error: error.message });
    }
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size too large. Maximum size is 10MB.' });
    }
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Upload claim attachment (public endpoint - no auth required)
router.post('/', uploadClaims.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Return full URL for claim attachments - use production URL
    const baseUrl = process.env.API_BASE_URL || process.env.FRONTEND_URL || (req.protocol + '://' + req.get('host'));
    const fileUrl = `${baseUrl}/uploads/claims/${req.file.filename}`;
    
    console.log('Claim attachment uploaded:', {
      filename: req.file.filename,
      path: req.file.path,
      size: req.file.size,
      mimetype: req.file.mimetype,
      fileUrl: fileUrl
    });
    
    res.json({
      message: 'File uploaded successfully',
      url: fileUrl,
      filename: req.file.filename
    });
  } catch (error) {
    console.error('Upload error:', error);
    if (error.message.includes('Only PNG, JPEG, and PDF')) {
      return res.status(400).json({ error: error.message });
    }
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size too large. Maximum size is 10MB.' });
    }
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Download file endpoint (authenticated)
// This endpoint allows authenticated users to download files permanently stored on server
// Usage: /api/upload/download?path=/uploads/communications/filename.pdf
router.get('/download', authenticateToken, (req, res) => {
  let fileStream = null;
  
  try {
    const filePath = req.query.path;
    const userId = req.user?.id;
    const userName = req.user?.name || 'Unknown';
    
    console.log(`[Download Request] User: ${userName} (${userId}), Path: ${filePath}`);
    
    if (!filePath) {
      console.error('[Download Error] No file path provided');
      return res.status(400).json({ error: 'File path is required' });
    }

    // Security: Ensure path is within uploads directory
    if (!filePath.startsWith('/uploads/')) {
      console.error('[Download Error] Invalid file path (does not start with /uploads/):', filePath);
      return res.status(403).json({ error: 'Invalid file path' });
    }

    // Resolve the full file path
    const fullPath = path.join(__dirname, '../..', filePath);
    
    // Additional security check - ensure it's within the project directory
    const normalizedPath = path.normalize(fullPath);
    const uploadsBaseDir = path.normalize(path.join(__dirname, '../../uploads'));
    
    if (!normalizedPath.startsWith(uploadsBaseDir)) {
      console.error('[Download Error] Access denied - path outside uploads directory:', {
        normalizedPath,
        uploadsBaseDir
      });
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if file exists
    if (!fs.existsSync(normalizedPath)) {
      console.error('[Download Error] File not found:', normalizedPath);
      return res.status(404).json({ error: 'File not found. The file may have been deleted or moved.' });
    }

    // Get file stats
    let stats;
    try {
      stats = fs.statSync(normalizedPath);
      console.log(`[Download] File found: ${normalizedPath}, Size: ${stats.size} bytes`);
    } catch (statError) {
      console.error('[Download Error] Error getting file stats:', statError);
      return res.status(500).json({ error: 'Unable to access file' });
    }
    
    if (!stats.isFile()) {
      console.error('[Download Error] Path is not a file:', normalizedPath);
      return res.status(400).json({ error: 'Path is not a file' });
    }

    // Determine content type based on file extension
    const ext = path.extname(normalizedPath).toLowerCase();
    const contentTypeMap = {
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.txt': 'text/plain',
      '.csv': 'text/csv',
      '.zip': 'application/zip',
      '.rar': 'application/x-rar-compressed'
    };

    const contentType = contentTypeMap[ext] || 'application/octet-stream';
    const filename = path.basename(normalizedPath);

    console.log(`[Download] Serving file: ${filename}, Content-Type: ${contentType}, Size: ${stats.size} bytes`);

    // Set headers for permanent file download
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Length', stats.size);
    // Cache control for production - files should be downloadable but not cached by browser
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    // Allow CORS for file downloads
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Type, Content-Length');

    // Stream the file - this ensures the file is served directly from disk
    fileStream = fs.createReadStream(normalizedPath);
    
    // Handle stream errors
    fileStream.on('error', (streamError) => {
      console.error('[Download Error] File stream error:', {
        error: streamError.message,
        code: streamError.code,
        path: normalizedPath
      });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to read file. The file may be corrupted or inaccessible.' });
      } else {
        // Headers already sent, can't send error response
        res.end();
      }
    });
    
    // Track download progress
    let bytesSent = 0;
    fileStream.on('data', (chunk) => {
      bytesSent += chunk.length;
    });
    
    fileStream.on('end', () => {
      console.log(`[Download] File sent successfully: ${filename}, ${bytesSent} bytes`);
    });
    
    // Handle client disconnect
    req.on('close', () => {
      console.log(`[Download] Client disconnected during download: ${filename}`);
      if (fileStream && !fileStream.destroyed) {
        fileStream.destroy();
      }
    });
    
    // Pipe file to response
    fileStream.pipe(res);

  } catch (error) {
    console.error('[Download Error] Unexpected error:', {
      error: error.message,
      code: error.code,
      stack: error.stack,
      filePath: req.query.path
    });
    
    // Clean up file stream if it exists
    if (fileStream && !fileStream.destroyed) {
      fileStream.destroy();
    }
    
    if (!res.headersSent) {
      // Provide specific error messages for common issues
      if (error.code === 'ENOENT') {
        res.status(404).json({ error: 'File not found. The file may have been deleted or moved.' });
      } else if (error.code === 'EACCES') {
        res.status(403).json({ error: 'Access denied to file' });
      } else {
        res.status(500).json({ error: 'Failed to download file. Please try again.' });
      }
    }
  }
});

// View file endpoint (authenticated) - opens file in browser instead of downloading
// Usage: /api/upload/view?path=/uploads/communications/filename.pdf
router.get('/view', authenticateToken, (req, res) => {
  let fileStream = null;
  
  try {
    const filePath = req.query.path;
    const userId = req.user?.id;
    const userName = req.user?.name || 'Unknown';
    
    console.log(`[View Request] User: ${userName} (${userId}), Path: ${filePath}`);
    
    if (!filePath) {
      console.error('[View Error] No file path provided');
      return res.status(400).json({ error: 'File path is required' });
    }

    // Security: Ensure path is within uploads directory
    if (!filePath.startsWith('/uploads/')) {
      console.error('[View Error] Invalid file path (does not start with /uploads/):', filePath);
      return res.status(403).json({ error: 'Invalid file path' });
    }

    // Resolve the full file path
    const fullPath = path.join(__dirname, '../..', filePath);
    
    // Additional security check - ensure it's within the project directory
    const normalizedPath = path.normalize(fullPath);
    const uploadsBaseDir = path.normalize(path.join(__dirname, '../../uploads'));
    
    if (!normalizedPath.startsWith(uploadsBaseDir)) {
      console.error('[View Error] Access denied - path outside uploads directory:', {
        normalizedPath,
        uploadsBaseDir
      });
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if file exists
    if (!fs.existsSync(normalizedPath)) {
      console.error('[View Error] File not found:', normalizedPath);
      return res.status(404).json({ error: 'File not found. The file may have been deleted or moved.' });
    }

    // Get file stats with error handling
    let stats;
    try {
      stats = fs.statSync(normalizedPath);
      console.log(`[View] File found: ${normalizedPath}, Size: ${stats.size} bytes`);
    } catch (statError) {
      console.error('[View Error] Error getting file stats:', statError);
      return res.status(500).json({ error: 'Unable to access file' });
    }
    
    if (!stats.isFile()) {
      console.error('[View Error] Path is not a file:', normalizedPath);
      return res.status(400).json({ error: 'Path is not a file' });
    }

    // Determine content type based on file extension
    const ext = path.extname(normalizedPath).toLowerCase();
    const contentTypeMap = {
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.txt': 'text/plain',
      '.csv': 'text/csv',
      '.zip': 'application/zip',
      '.rar': 'application/x-rar-compressed'
    };

    const contentType = contentTypeMap[ext] || 'application/octet-stream';
    const filename = path.basename(normalizedPath);

    console.log(`[View] Serving file inline: ${filename}, Content-Type: ${contentType}`);

    // Set headers for viewing (inline instead of attachment)
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Length', stats.size);
    // Cache control for production
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('ETag', `"${stats.mtime.getTime()}-${stats.size}"`);
    // Allow CORS for file viewing
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Type, Content-Length');

    // Stream the file
    fileStream = fs.createReadStream(normalizedPath);
    
    // Handle stream errors
    fileStream.on('error', (streamError) => {
      console.error('[View Error] File stream error:', {
        error: streamError.message,
        code: streamError.code,
        path: normalizedPath
      });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to read file' });
      } else {
        res.end();
      }
    });
    
    // Handle client disconnect
    req.on('close', () => {
      console.log(`[View] Client disconnected during view: ${filename}`);
      if (fileStream && !fileStream.destroyed) {
        fileStream.destroy();
      }
    });
    
    // Pipe file to response
    fileStream.pipe(res);

  } catch (error) {
    console.error('[View Error] Unexpected error:', {
      error: error.message,
      code: error.code,
      stack: error.stack,
      filePath: req.query.path
    });
    
    // Clean up file stream if it exists
    if (fileStream && !fileStream.destroyed) {
      fileStream.destroy();
    }
    
    if (!res.headersSent) {
      if (error.code === 'ENOENT') {
        res.status(404).json({ error: 'File not found. The file may have been deleted or moved.' });
      } else if (error.code === 'EACCES') {
        res.status(403).json({ error: 'Access denied to file' });
      } else {
        res.status(500).json({ error: 'Failed to view file. Please try again.' });
      }
    }
  }
});

module.exports = router;

