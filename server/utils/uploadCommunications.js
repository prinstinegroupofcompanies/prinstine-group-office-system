const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure uploads/communications directory exists
const uploadsDir = path.join(__dirname, '../../uploads/communications');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure storage for communication attachments
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `comm-${uniqueSuffix}-${sanitizedName}`);
  }
});

// File filter - allow ALL document types (very permissive for communications)
const fileFilter = (req, file, cb) => {
  // Get file extension
  const ext = path.extname(file.originalname).toLowerCase();
  
  // Block only executable and script files for security
  const blockedExtensions = ['.exe', '.bat', '.cmd', '.com', '.scr', '.vbs', '.js', '.jar', '.app', '.deb', '.rpm', '.msi', '.dmg', '.pkg', '.sh', '.ps1'];
  
  if (blockedExtensions.includes(ext)) {
    return cb(new Error('Executable files are not allowed for security reasons'));
  }
  
  // Allow all other file types
  // This includes: images, documents, archives, videos, audio, and any other file type
  cb(null, true);
};

// Configure multer for communications
const uploadCommunications = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit (increased for larger documents)
  },
  fileFilter: fileFilter
});

module.exports = uploadCommunications;

