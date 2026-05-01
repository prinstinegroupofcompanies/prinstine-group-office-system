// Server restart trigger - v1.0.1
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const db = require('./config/database');
const { startPeriodicCheckpoint, stopPeriodicCheckpoint } = require('./utils/dbCheckpoint');
const { checkAndSendBirthdayNotifications } = require('./utils/birthdayNotifications');
const fs = require('fs');
const path = require('path');

const app = express();
// Render (and most hosts) sit behind a reverse proxy — required for correct HTTPS / client IP
app.set('trust proxy', 1);

const server = http.createServer(app);
const allowedSocketOrigins = [
  process.env.FRONTEND_URL,
  'https://prinstinemanagementsystem.org',
  'https://www.prinstinemanagementsystem.org',
  'https://prinstine-group-system-frontend.onrender.com',
  'http://localhost:3000',
  'http://localhost:3001'
].filter(Boolean);

const io = socketIo(server, {
  // High-latency / restrictive mobile networks (Orange, MTN, etc.)
  pingTimeout: 120000,
  pingInterval: 25000,
  upgradeTimeout: 60000,
  transports: ['polling', 'websocket'],
  allowEIO3: true,
  cors: {
    origin: function (origin, callback) {
      // Allow production domain and other allowed origins
      if (!origin || 
          origin.includes('prinstinemanagementsystem.org') ||
          origin.includes('prinstine-group-system-frontend.onrender.com') || 
          origin.includes('localhost') || 
          allowedSocketOrigins.indexOf(origin) !== -1 ||
          allowedSocketOrigins.some(allowed => origin.includes(allowed.replace(/^https?:\/\//, '')))) {
        return callback(null, true);
      }
      callback(null, true); // Allow all for now
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true
  }
});

// Make io available to other modules
app.set('io', io);
global.io = io;

const PORT = process.env.PORT || 3006;

// Middleware
// TEMPORARILY DISABLED HELMET to debug timeout issues
// app.use(helmet({
//   crossOriginResourcePolicy: { policy: "cross-origin" }
// }));

// CORS — work across ISPs and mobile carriers (Orange, MTN, etc.)
// Never use Access-Control-Allow-Origin: * together with Allow-Credentials: true (browser rejects it).
// Echo the request Origin when present so any legitimate frontend URL (Render preview, custom domain) works.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Credentials', 'true');
  } else {
    res.header('Access-Control-Allow-Origin', '*');
    // Do not send Allow-Credentials with * — browsers reject that combination
  }

  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Origin, Referer, Accept');
  res.header('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Request logging - SIMPLIFIED to avoid blocking
app.use((req, res, next) => {
  // Only log for specific paths to reduce overhead
  if (req.path.includes('/auth/login') || req.path.includes('/health')) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

const apiBodyLimitMb = Number(process.env.API_BODY_LIMIT_MB || 0);
const apiBodyLimit = apiBodyLimitMb > 0 ? `${apiBodyLimitMb}mb` : '50mb';

// JSON body parser
app.use(express.json({
  limit: apiBodyLimit,
  strict: false
}));

// URL-encoded body parser
app.use(express.urlencoded({
  extended: true,
  limit: apiBodyLimit
}));

// System audit: optional JWT user id + per-request HTTP log (ICT head reviews via /api/audit-logs)
const attachAuditUserFromToken = require('./middleware/attachAuditUserFromToken');
const auditHttpLogger = require('./middleware/auditHttpLogger');
app.use('/api', attachAuditUserFromToken);
app.use('/api', auditHttpLogger);

// Keep uploads on a persistent path in production (for Render: /var/data/uploads)
const uploadsRoot = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, '../uploads'));
const legacyUploadsPath = path.resolve(path.join(__dirname, '../uploads'));

if (!fs.existsSync(uploadsRoot)) {
  fs.mkdirSync(uploadsRoot, { recursive: true });
}

// Many modules still reference ../uploads directly.
// Create/update a symlink so those paths resolve to persistent storage.
try {
  if (legacyUploadsPath !== uploadsRoot) {
    if (fs.existsSync(legacyUploadsPath)) {
      const stat = fs.lstatSync(legacyUploadsPath);
      if (!stat.isSymbolicLink()) {
        fs.renameSync(legacyUploadsPath, `${legacyUploadsPath}.legacy-${Date.now()}`);
      } else {
        fs.unlinkSync(legacyUploadsPath);
      }
    }
    fs.symlinkSync(uploadsRoot, legacyUploadsPath, 'dir');
  }
} catch (err) {
  console.warn('Uploads symlink setup warning:', err.message);
}

// Ensure permanent storage dirs exist (entity-images: student/instructor/staff profile photos)
const entityImagesDir = path.join(uploadsRoot, 'entity-images');
if (!fs.existsSync(entityImagesDir)) {
  fs.mkdirSync(entityImagesDir, { recursive: true });
}

// Serve uploaded files
app.use('/uploads', express.static(uploadsRoot));
app.use('/uploads/claims', express.static(path.join(uploadsRoot, 'claims')));
app.use('/uploads/communications', express.static(path.join(uploadsRoot, 'communications')));
app.use('/uploads/proposals', express.static(path.join(uploadsRoot, 'proposals')));
app.use('/uploads/archived-documents', express.static(path.join(uploadsRoot, 'archived-documents')));
app.use('/uploads/requisitions', express.static(path.join(uploadsRoot, 'requisitions')));

// Rate limiting - TEMPORARILY DISABLED to debug login timeout issues
// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: process.env.NODE_ENV === 'production' ? 100 : 1000, // Higher limit for development
//   message: 'Too many requests, please try again later.',
//   standardHeaders: true,
//   legacyHeaders: false,
//   skip: (req) => {
//     // Skip rate limiting for health checks and login
//     return req.path === '/api/health' || req.path === '/api/auth/login';
//   }
// });

// More lenient rate limiter for auth routes - TEMPORARILY DISABLED
// const authLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: process.env.NODE_ENV === 'production' ? 5 : 50, // Allow more login attempts in development
//   message: 'Too many login attempts, please try again later.',
//   standardHeaders: true,
//   legacyHeaders: false,
//   skipSuccessfulRequests: true, // Don't count successful logins
// });

// app.use('/api/', limiter);
// app.use('/api/auth/login', authLimiter);
// app.use('/api/auth/me', rateLimit({
//   windowMs: 1 * 60 * 1000, // 1 minute
//   max: process.env.NODE_ENV === 'production' ? 30 : 200, // More lenient for /me endpoint
//   message: 'Too many requests, please try again later.',
// }));

// Initialize database
async function initializeDatabase() {
  try {
    // Ensure database directory exists (use root database folder)
    const dbDir = path.resolve(__dirname, '../../database');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      console.log('Created database directory:', dbDir);
    }
    
    // Log the database path being used
    const dbPath = process.env.DB_PATH || path.resolve(__dirname, '../../database/pms.db');
    console.log('Using database path:', dbPath);

    const quoteIdent = (value) => `"${String(value).replace(/"/g, '""')}"`;
    const normalizeLegacyPrimaryKeyConstraints = async () => {
      if (!process.env.DATABASE_URL) return;

      try {
        const legacyPkConstraints = await db.all(`
          SELECT
            con.conname AS constraint_name,
            rel.relname AS table_name
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
          WHERE con.contype = 'p'
            AND nsp.nspname = 'public'
            AND con.conname LIKE '%\\_new_pkey' ESCAPE '\\'
        `);

        for (const row of legacyPkConstraints) {
          const oldName = row.constraint_name;
          const tableName = row.table_name;
          const expectedName = `${tableName}_pkey`;
          if (!oldName || !tableName || oldName === expectedName) continue;

          const existingExpected = await db.get(`
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE con.contype = 'p'
              AND nsp.nspname = 'public'
              AND rel.relname = ?
              AND con.conname = ?
          `, [tableName, expectedName]);

          if (existingExpected) continue;

          await db.run(
            `ALTER TABLE ${quoteIdent(tableName)} RENAME CONSTRAINT ${quoteIdent(oldName)} TO ${quoteIdent(expectedName)}`
          );
          console.log(`✓ Renamed legacy primary key constraint: ${oldName} -> ${expectedName}`);
        }
      } catch (err) {
        console.warn('PostgreSQL PK-constraint normalization skipped:', err.message);
      }
    };

    try {
    await db.connect();
    console.log('Database connected successfully');
    await normalizeLegacyPrimaryKeyConstraints();
    } catch (dbError) {
      // If PostgreSQL connection fails, provide helpful error and exit
      if (process.env.DATABASE_URL) {
        console.error('\n❌ Database connection failed!');
        console.error('The system cannot start without a valid database connection.');
        console.error('\n💡 Quick Fix:');
        console.error('1. Go to Render Dashboard → Your PostgreSQL Database');
        console.error('2. Copy the "Internal Database URL" (complete URL)');
        console.error('3. Go to Backend Service → Environment → Update DATABASE_URL');
        console.error('4. Save and redeploy\n');
        throw dbError; // Exit with error so user knows to fix it
      } else {
        // SQLite connection failure
        throw dbError;
      }
    }

    // Check if database is empty (no users table or no data)
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
    
    // Define migration paths (used in both if and else blocks)
      const migrationPath = path.join(__dirname, '../database/migrations/001_initial_schema.sql');
      const seedPath = path.join(__dirname, '../database/migrations/002_seed_data.sql');
      const supportTicketsPath = path.join(__dirname, '../database/migrations/003_support_tickets.sql');
      const communicationsPath = path.join(__dirname, '../database/migrations/004_communications_enhancement.sql');
      const progressReportPath = path.join(__dirname, '../database/migrations/005_progress_report_fields.sql');
      const progressReportsTablePath = path.join(__dirname, '../database/migrations/006_progress_reports_table.sql');
    const payrollManagementPath = path.join(__dirname, '../database/migrations/010_payroll_management.sql');
    const staffEnhancementsPath = path.join(__dirname, 'database/migrations/007_staff_enhancements.sql');
    const staffClientReportsPath = path.join(__dirname, 'database/migrations/008_staff_client_reports.sql');
    const addAttachmentsToReportsPath = path.join(__dirname, 'database/migrations/009_add_attachments_to_reports.sql');
    const academyEnhancementsPath = path.join(__dirname, 'database/migrations/011_academy_enhancements.sql');
    const financeModulesPath = path.join(__dirname, 'database/migrations/012_finance_modules.sql');
    const departmentReportsApprovalPath = path.join(__dirname, 'database/migrations/013_department_reports_approval_workflow.sql');
    const financeApprovalWorkflowPath = path.join(__dirname, 'database/migrations/014_finance_approval_workflow.sql');
    const callMemosPath = path.join(__dirname, 'database/migrations/015_call_memos.sql');
    const proposalsPath = path.join(__dirname, 'database/migrations/016_proposals.sql');
    const meetingsPath = path.join(__dirname, 'database/migrations/017_meetings.sql');
    const archivedDocumentsPath = path.join(__dirname, 'database/migrations/018_archived_documents.sql');
    const staffAttendancePath = path.join(__dirname, 'database/migrations/019_staff_attendance.sql');
    const requisitionsPath = path.join(__dirname, 'database/migrations/020_requisitions.sql');
    const targetsPath = path.join(__dirname, 'database/migrations/021_targets_system.sql');
    const departmentHeadFieldsPath = path.join(__dirname, '../database/migrations/022_add_department_head_fields.sql');
    const addMissingColumnsPath = path.join(__dirname, 'database/migrations/023_add_missing_columns.sql');
    const appraisalsSystemPath = path.join(__dirname, 'database/migrations/024_appraisals_system.sql');
    const academyCohortsPath = path.join(__dirname, 'database/migrations/025_academy_cohorts.sql');
    const studentPaymentTransactionsPath = path.join(__dirname, 'database/migrations/026_student_payment_transactions.sql');
    const studentInvoicesPath = path.join(__dirname, 'database/migrations/027_student_invoices.sql');
    const gradeSubmissionsPath = path.join(__dirname, 'database/migrations/028_grade_submissions.sql');
    const attendanceGeoCoordsPath = path.join(__dirname, 'database/migrations/029_attendance_office_geocoords.sql');
    const certificateAccessWindowsPath = path.join(__dirname, 'database/migrations/030_certificate_access_windows.sql');
    
    if (tables.length === 0) {
      console.log('Initializing database schema...');
      
      // Read and execute migration files

      if (fs.existsSync(migrationPath)) {
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        // Execute SQL statements one by one
        const statements = migrationSQL.split(';').filter(s => s.trim().length > 0);
        for (const statement of statements) {
          if (statement.trim()) {
            try {
              await db.run(statement);
            } catch (stmtError) {
              // Ignore errors for IF NOT EXISTS statements
              if (!stmtError.message.includes('already exists')) {
                console.error('Error executing statement:', stmtError.message);
              }
            }
          }
        }
        console.log('Database schema initialized');
      } else {
        console.error('Migration file not found:', migrationPath);
      }

      if (fs.existsSync(seedPath)) {
        const seedSQL = fs.readFileSync(seedPath, 'utf8');
        const statements = seedSQL.split(';').filter(s => s.trim().length > 0);
        for (const statement of statements) {
          if (statement.trim()) {
            try {
              await db.run(statement);
            } catch (stmtError) {
              // Ignore errors for INSERT OR IGNORE statements
              if (!stmtError.message.includes('UNIQUE constraint')) {
                console.error('Error executing seed statement:', stmtError.message);
              }
            }
          }
        }
        console.log('Seed data loaded');
        
        // Verify admin user was created (check both emails)
        let adminUser = await db.get('SELECT id, email, role FROM users WHERE email = ?', ['admin@prinstinegroup.org']);
        if (!adminUser) {
          adminUser = await db.get('SELECT id, email, role FROM users WHERE email = ?', ['admin@prinstine.com']);
        }
        if (adminUser) {
          console.log('✓ Admin user created successfully:', adminUser.email);
        } else {
          console.error('✗ Admin user was not created!');
        }
      } else {
        console.error('Seed file not found:', seedPath);
      }

      // Run support tickets migration if table doesn't exist
      const ticketsTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='support_tickets'");
      if (!ticketsTableExists && fs.existsSync(supportTicketsPath)) {
        console.log('Creating support_tickets table...');
        const ticketsSQL = fs.readFileSync(supportTicketsPath, 'utf8');
        const ticketsStatements = ticketsSQL.split(';').filter(s => s.trim().length > 0);
        for (const statement of ticketsStatements) {
          if (statement.trim()) {
            try {
              await db.run(statement);
            } catch (stmtError) {
              if (!stmtError.message.includes('already exists')) {
                console.error('Error executing ticket statement:', stmtError.message);
              }
            }
          }
        }
        console.log('✓ Support tickets table created');
      }

      // Run communications enhancement migration
      if (fs.existsSync(communicationsPath)) {
        console.log('Running communications enhancement migration...');
        const commSQL = fs.readFileSync(communicationsPath, 'utf8');
        const commStatements = commSQL.split(';').filter(s => s.trim().length > 0);
        for (const statement of commStatements) {
          if (statement.trim()) {
            try {
              await db.run(statement);
            } catch (stmtError) {
              // Ignore errors for columns that already exist
              if (!stmtError.message.includes('duplicate column') && 
                  !stmtError.message.includes('already exists')) {
                console.error('Error executing communications statement:', stmtError.message);
              }
            }
          }
        }
        console.log('✓ Communications enhancement migration completed');
      }
      
      // Run add missing columns migration after initial schema
      if (fs.existsSync(addMissingColumnsPath)) {
        const clientsTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='clients'");
        if (clientsTableExists) {
          const clientsTableInfo = await db.all("PRAGMA table_info(clients)");
          const clientsColumnNames = clientsTableInfo.map(col => col.name);
          const needsMigration = !clientsColumnNames.includes('category') || 
                                !clientsColumnNames.includes('progress_status') ||
                                !clientsColumnNames.includes('created_by');
          
          if (needsMigration) {
            console.log('Adding missing columns to clients table (category, progress_status, created_by)...');
            const missingColumnsSQL = fs.readFileSync(addMissingColumnsPath, 'utf8');
            const missingColumnsStatements = missingColumnsSQL.split(';').filter(s => s.trim().length > 0);
            for (const statement of missingColumnsStatements) {
              if (statement.trim()) {
                try {
                  await db.run(statement);
                } catch (stmtError) {
                  // Ignore errors for columns that already exist
                  if (!stmtError.message.includes('duplicate column') && 
                      !stmtError.message.includes('already exists')) {
                    console.error('Error executing missing columns migration statement:', stmtError.message);
                  }
                }
              }
            }
            console.log('✓ Missing columns migration completed');
          }
        }
      }
      
      // Run all other table migrations during initial setup
      // Run staff attendance migration
      const staffAttendanceTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='staff_attendance'");
      if (!staffAttendanceTableExists && fs.existsSync(staffAttendancePath)) {
        console.log('Creating staff_attendance table...');
        const staffAttendanceSQL = fs.readFileSync(staffAttendancePath, 'utf8');
        const staffAttendanceStatements = staffAttendanceSQL.split(';').filter(s => s.trim().length > 0);
        for (const statement of staffAttendanceStatements) {
          if (statement.trim()) {
            try {
              await db.run(statement);
            } catch (stmtError) {
              if (!stmtError.message.includes('already exists')) {
                console.error('Error executing staff attendance statement:', stmtError.message);
              }
            }
          }
        }
        console.log('✓ Staff attendance table created');
      }
      
      // Run requisitions migration
      const requisitionsTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='requisitions'");
      if (!requisitionsTableExists && fs.existsSync(requisitionsPath)) {
        console.log('Creating requisitions table...');
        const requisitionsSQL = fs.readFileSync(requisitionsPath, 'utf8');
        const requisitionsStatements = requisitionsSQL.split(';').filter(s => s.trim().length > 0);
        for (const statement of requisitionsStatements) {
          if (statement.trim()) {
            try {
              await db.run(statement);
            } catch (stmtError) {
              if (!stmtError.message.includes('already exists')) {
                console.error('Error executing requisitions statement:', stmtError.message);
              }
            }
          }
        }
        console.log('✓ Requisitions table created');
      }
      
      // Run archived documents migration
      const archivedDocumentsTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='archived_documents'");
      if (!archivedDocumentsTableExists && fs.existsSync(archivedDocumentsPath)) {
        console.log('Creating archived_documents table...');
        const archivedDocumentsSQL = fs.readFileSync(archivedDocumentsPath, 'utf8');
        const archivedDocumentsStatements = archivedDocumentsSQL.split(';').filter(s => s.trim().length > 0);
        for (const statement of archivedDocumentsStatements) {
          if (statement.trim()) {
            try {
              await db.run(statement);
            } catch (stmtError) {
              if (!stmtError.message.includes('already exists')) {
                console.error('Error executing archived documents statement:', stmtError.message);
              }
            }
          }
        }
        console.log('✓ Archived documents table created');
      }
      
      // Run meetings migration
      const meetingsTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='meetings'");
      if (!meetingsTableExists && fs.existsSync(meetingsPath)) {
        console.log('Creating meetings tables...');
        const meetingsSQL = fs.readFileSync(meetingsPath, 'utf8');
        const meetingsStatements = meetingsSQL.split(';').filter(s => s.trim().length > 0);
        for (const statement of meetingsStatements) {
          if (statement.trim()) {
            try {
              await db.run(statement);
            } catch (stmtError) {
              if (!stmtError.message.includes('already exists')) {
                console.error('Error executing meetings statement:', stmtError.message);
              }
            }
          }
        }
        console.log('✓ Meetings tables created');
      }
      
      // Run targets system migration
      if (fs.existsSync(targetsPath)) {
        const targetsTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='targets'");
        const progressReportsTableInfo = await db.all("PRAGMA table_info(progress_reports)");
        const progressReportsColumnNames = progressReportsTableInfo.map(col => col.name);
        const needsAmountColumn = !progressReportsColumnNames.includes('amount');
        
        if (!targetsTableExists || needsAmountColumn) {
          console.log('Running targets system migration...');
          const targetsSQL = fs.readFileSync(targetsPath, 'utf8');
          const targetsStatements = targetsSQL.split(';').filter(s => s.trim().length > 0);
          for (const statement of targetsStatements) {
            if (statement.trim()) {
              try {
                await db.run(statement);
              } catch (stmtError) {
                // Ignore errors for columns/tables that already exist
                if (!stmtError.message.includes('already exists') && 
                    !stmtError.message.includes('duplicate column')) {
                  console.error('Error executing targets migration statement:', stmtError.message);
                }
              }
            }
          }
          console.log('✓ Targets system migration completed');
        }
      }
      
      // Run staff enhancements migration
      if (fs.existsSync(staffEnhancementsPath)) {
        const tableInfo = await db.all("PRAGMA table_info(staff)");
        const columnNames = tableInfo.map(col => col.name);
        const needsMigration = !columnNames.includes('date_of_birth') || 
                              !columnNames.includes('place_of_birth') ||
                              !columnNames.includes('nationality');
        
        if (needsMigration) {
          console.log('Running staff enhancements migration...');
          const staffSQL = fs.readFileSync(staffEnhancementsPath, 'utf8');
          const staffStatements = staffSQL.split(';').filter(s => s.trim().length > 0);
          for (const statement of staffStatements) {
            if (statement.trim()) {
              try {
                await db.run(statement);
              } catch (stmtError) {
                // Ignore errors for columns that already exist
                if (!stmtError.message.includes('duplicate column') && 
                    !stmtError.message.includes('already exists')) {
                  console.error('Error executing staff enhancement statement:', stmtError.message);
                }
              }
            }
          }
          console.log('✓ Staff enhancements migration completed');
        }
      }
      
      // Run department head fields migration
      if (fs.existsSync(departmentHeadFieldsPath)) {
        const departmentsTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='departments'");
        if (departmentsTableExists) {
          const departmentsTableInfo = await db.all("PRAGMA table_info(departments)");
          const departmentsColumnNames = departmentsTableInfo.map(col => col.name);
          const needsMigration = !departmentsColumnNames.includes('head_name') || 
                                !departmentsColumnNames.includes('head_email') ||
                                !departmentsColumnNames.includes('head_phone');
          
          if (needsMigration) {
            console.log('Adding head_name, head_email, and head_phone columns to departments table...');
            const deptHeadSQL = fs.readFileSync(departmentHeadFieldsPath, 'utf8');
            const deptHeadStatements = deptHeadSQL.split(';').filter(s => s.trim().length > 0);
            for (const statement of deptHeadStatements) {
              if (statement.trim()) {
                try {
                  await db.run(statement);
                } catch (stmtError) {
                  // Ignore errors for columns that already exist
                  if (!stmtError.message.includes('duplicate column') && 
                      !stmtError.message.includes('already exists')) {
                    console.error('Error executing department head fields migration statement:', stmtError.message);
                  }
                }
              }
            }
            console.log('✓ Department head fields migration completed');
          }
        }
      }
    } else {
      console.log('Database already initialized');
      
      // Check and create support_tickets table if it doesn't exist
      const ticketsTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='support_tickets'");
      if (!ticketsTableExists && fs.existsSync(supportTicketsPath)) {
        console.log('Creating support_tickets table...');
        const ticketsSQL = fs.readFileSync(supportTicketsPath, 'utf8');
        const ticketsStatements = ticketsSQL.split(';').filter(s => s.trim().length > 0);
        for (const statement of ticketsStatements) {
          if (statement.trim()) {
            try {
              await db.run(statement);
            } catch (stmtError) {
              if (!stmtError.message.includes('already exists')) {
                console.error('Error executing ticket statement:', stmtError.message);
              }
            }
          }
        }
        console.log('✓ Support tickets table created');
      }

      // Run communications enhancement migration if needed
      if (fs.existsSync(communicationsPath)) {
        // Check if columns already exist
        const tableInfo = await db.all("PRAGMA table_info(notifications)");
        const columnNames = tableInfo.map(col => col.name);
        const needsMigration = !columnNames.includes('sender_id') || 
                              !columnNames.includes('parent_id') || 
                              !columnNames.includes('attachments') ||
                              !columnNames.includes('is_acknowledged');
        
        if (needsMigration) {
          console.log('Running communications enhancement migration...');
          const commSQL = fs.readFileSync(communicationsPath, 'utf8');
          const commStatements = commSQL.split(';').filter(s => s.trim().length > 0);
          for (const statement of commStatements) {
            if (statement.trim()) {
              try {
                await db.run(statement);
              } catch (stmtError) {
                // Ignore errors for columns that already exist
                if (!stmtError.message.includes('duplicate column') && 
                    !stmtError.message.includes('already exists')) {
                  console.error('Error executing communications statement:', stmtError.message);
                }
              }
            }
          }
          console.log('✓ Communications enhancement migration completed');
        }
      }

      // Run progress report fields migration if needed
      if (fs.existsSync(progressReportPath)) {
        const tableInfo = await db.all("PRAGMA table_info(clients)");
        const columnNames = tableInfo.map(col => col.name);
        const needsMigration = !columnNames.includes('category') || 
                              !columnNames.includes('progress_status') ||
                              !columnNames.includes('created_by');
        
        if (needsMigration) {
          console.log('Running progress report fields migration...');
          const progressSQL = fs.readFileSync(progressReportPath, 'utf8');
          const progressStatements = progressSQL.split(';').filter(s => s.trim().length > 0);
          for (const statement of progressStatements) {
            if (statement.trim()) {
              try {
                await db.run(statement);
              } catch (stmtError) {
                // Ignore errors for columns that already exist
                if (!stmtError.message.includes('duplicate column') && 
                    !stmtError.message.includes('already exists')) {
                  console.error('Error executing progress report statement:', stmtError.message);
                }
              }
            }
          }
          console.log('✓ Progress report fields migration completed');
        }
      }

      // Run progress reports table migration if needed
      if (fs.existsSync(progressReportsTablePath)) {
        const progressReportsTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='progress_reports'");
        if (!progressReportsTableExists) {
          console.log('Creating progress_reports table...');
          const progressReportsSQL = fs.readFileSync(progressReportsTablePath, 'utf8');
          const progressReportsStatements = progressReportsSQL.split(';').filter(s => s.trim().length > 0);
          for (const statement of progressReportsStatements) {
            if (statement.trim()) {
              try {
                await db.run(statement);
              } catch (stmtError) {
                if (!stmtError.message.includes('already exists')) {
                  console.error('Error executing progress reports table statement:', stmtError.message);
                }
              }
            }
          }
          console.log('✓ Progress reports table created');
        }
      }

      // Run staff enhancements migration if needed
      if (fs.existsSync(staffEnhancementsPath)) {
        const tableInfo = await db.all("PRAGMA table_info(staff)");
        const columnNames = tableInfo.map(col => col.name);
        const needsMigration = !columnNames.includes('date_of_birth') || 
                              !columnNames.includes('place_of_birth') ||
                              !columnNames.includes('nationality');
        
        if (needsMigration) {
          console.log('Running staff enhancements migration...');
          const staffSQL = fs.readFileSync(staffEnhancementsPath, 'utf8');
          const staffStatements = staffSQL.split(';').filter(s => s.trim().length > 0);
          for (const statement of staffStatements) {
            if (statement.trim()) {
              try {
                await db.run(statement);
              } catch (stmtError) {
                // Ignore errors for columns that already exist
                if (!stmtError.message.includes('duplicate column') && 
                    !stmtError.message.includes('already exists')) {
                  console.error('Error executing staff enhancement statement:', stmtError.message);
                }
              }
            }
          }
          console.log('✓ Staff enhancements migration completed');
        }
      }

      // Run staff client reports migration if needed
      if (fs.existsSync(staffClientReportsPath)) {
        const staffClientReportsTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='staff_client_reports'");
        if (!staffClientReportsTableExists) {
          console.log('Creating staff_client_reports table...');
          const staffClientReportsSQL = fs.readFileSync(staffClientReportsPath, 'utf8');
          const staffClientReportsStatements = staffClientReportsSQL.split(';').filter(s => s.trim().length > 0);
          for (const statement of staffClientReportsStatements) {
            if (statement.trim()) {
              try {
                await db.run(statement);
              } catch (stmtError) {
                if (!stmtError.message.includes('already exists')) {
                  console.error('Error executing staff client reports table statement:', stmtError.message);
                }
              }
            }
          }
          console.log('✓ Staff client reports table created');
        }
      }

      // Run add attachments to reports migration if needed
      if (fs.existsSync(addAttachmentsToReportsPath)) {
        const tableInfo = await db.all("PRAGMA table_info(department_reports)");
        const columnNames = tableInfo.map(col => col.name);
        const needsMigration = !columnNames.includes('attachments');
        
        if (needsMigration) {
          console.log('Adding attachments column to department_reports table...');
          const attachmentsSQL = fs.readFileSync(addAttachmentsToReportsPath, 'utf8');
          const attachmentsStatements = attachmentsSQL.split(';').filter(s => s.trim().length > 0);
          for (const statement of attachmentsStatements) {
            if (statement.trim()) {
              try {
                await db.run(statement);
              } catch (stmtError) {
                // Ignore errors for columns that already exist
                if (!stmtError.message.includes('duplicate column') && 
                    !stmtError.message.includes('already exists')) {
                  console.error('Error executing attachments migration statement:', stmtError.message);
                }
              }
            }
          }
          console.log('✓ Attachments column added to department_reports');
        }
      }

      // Run academy enhancements migration if needed
      if (fs.existsSync(academyEnhancementsPath)) {
        // Check if courses table exists and add columns if needed
        const coursesTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='courses'");
        if (coursesTableExists) {
          const coursesTableInfo = await db.all("PRAGMA table_info(courses)");
          const coursesColumnNames = coursesTableInfo.map(col => col.name);
          const needsCoursesMigration = !coursesColumnNames.includes('course_fee') || 
                                       !coursesColumnNames.includes('fee_approved') ||
                                       !coursesColumnNames.includes('created_by');
          
          if (needsCoursesMigration) {
            console.log('Adding course fees and approval fields to courses table...');
            try {
              if (!coursesColumnNames.includes('course_fee')) {
                await db.run('ALTER TABLE courses ADD COLUMN course_fee REAL DEFAULT 0');
              }
              if (!coursesColumnNames.includes('fee_approved')) {
                await db.run('ALTER TABLE courses ADD COLUMN fee_approved INTEGER DEFAULT 0');
              }
              if (!coursesColumnNames.includes('approved_by')) {
                await db.run('ALTER TABLE courses ADD COLUMN approved_by INTEGER');
              }
              if (!coursesColumnNames.includes('approved_at')) {
                await db.run('ALTER TABLE courses ADD COLUMN approved_at DATETIME');
              }
              if (!coursesColumnNames.includes('admin_notes')) {
                await db.run('ALTER TABLE courses ADD COLUMN admin_notes TEXT');
              }
              if (!coursesColumnNames.includes('created_by')) {
                await db.run('ALTER TABLE courses ADD COLUMN created_by INTEGER');
              }
              console.log('✓ Course fees and approval fields added');
            } catch (stmtError) {
              if (!stmtError.message.includes('duplicate column') && 
                  !stmtError.message.includes('already exists')) {
                console.error('Error adding course fields:', stmtError.message);
              }
            }
          }
        }

        // Check if students table exists and add approval fields
        const studentsTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='students'");
        if (studentsTableExists) {
          const studentsTableInfo = await db.all("PRAGMA table_info(students)");
          const studentsColumnNames = studentsTableInfo.map(col => col.name);
          const needsStudentsMigration = !studentsColumnNames.includes('approved') || 
                                        !studentsColumnNames.includes('created_by');
          
          if (needsStudentsMigration) {
            console.log('Adding approval fields to students table...');
            try {
              if (!studentsColumnNames.includes('approved')) {
                await db.run('ALTER TABLE students ADD COLUMN approved INTEGER DEFAULT 0');
              }
              if (!studentsColumnNames.includes('approved_by')) {
                await db.run('ALTER TABLE students ADD COLUMN approved_by INTEGER');
              }
              if (!studentsColumnNames.includes('approved_at')) {
                await db.run('ALTER TABLE students ADD COLUMN approved_at DATETIME');
              }
              if (!studentsColumnNames.includes('admin_notes')) {
                await db.run('ALTER TABLE students ADD COLUMN admin_notes TEXT');
              }
              if (!studentsColumnNames.includes('created_by')) {
                await db.run('ALTER TABLE students ADD COLUMN created_by INTEGER');
              }
              console.log('✓ Student approval fields added');
            } catch (stmtError) {
              if (!stmtError.message.includes('duplicate column') && 
                  !stmtError.message.includes('already exists')) {
                console.error('Error adding student fields:', stmtError.message);
              }
            }
          }
        }

        // Check if instructors table exists and add approval fields
        const instructorsTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='instructors'");
        if (instructorsTableExists) {
          const instructorsTableInfo = await db.all("PRAGMA table_info(instructors)");
          const instructorsColumnNames = instructorsTableInfo.map(col => col.name);
          const needsInstructorsMigration = !instructorsColumnNames.includes('approved');
          
          if (needsInstructorsMigration) {
            console.log('Adding approval fields to instructors table...');
            try {
              if (!instructorsColumnNames.includes('approved')) {
                await db.run('ALTER TABLE instructors ADD COLUMN approved INTEGER DEFAULT 0');
              }
              if (!instructorsColumnNames.includes('approved_by')) {
                await db.run('ALTER TABLE instructors ADD COLUMN approved_by INTEGER');
              }
              if (!instructorsColumnNames.includes('approved_at')) {
                await db.run('ALTER TABLE instructors ADD COLUMN approved_at DATETIME');
              }
              if (!instructorsColumnNames.includes('admin_notes')) {
                await db.run('ALTER TABLE instructors ADD COLUMN admin_notes TEXT');
              }
              console.log('✓ Instructor approval fields added');
            } catch (stmtError) {
              if (!stmtError.message.includes('duplicate column') && 
                  !stmtError.message.includes('already exists')) {
                console.error('Error adding instructor fields:', stmtError.message);
              }
            }
          }
        }

        // Run the academy enhancements migration for new tables
        const studentPaymentsTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='student_payments'");
        if (!studentPaymentsTableExists) {
          console.log('Running academy enhancements migration for new tables...');
          const academySQL = fs.readFileSync(academyEnhancementsPath, 'utf8');
          const academyStatements = academySQL.split(';').filter(s => s.trim().length > 0);
          for (const statement of academyStatements) {
            if (statement.trim()) {
              try {
                await db.run(statement);
              } catch (stmtError) {
                if (!stmtError.message.includes('already exists')) {
                  console.error('Error executing academy enhancement statement:', stmtError.message);
                }
              }
            }
          }
          console.log('✓ Academy enhancements migration completed');
        }
      }

      // Run finance modules migration if needed
      if (fs.existsSync(financeModulesPath)) {
        const pettyCashLedgerTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='petty_cash_ledgers'");
        if (!pettyCashLedgerTableExists) {
          console.log('Creating finance modules tables (Petty Cash Ledger & Asset Registry)...');
          const financeSQL = fs.readFileSync(financeModulesPath, 'utf8');
          const financeStatements = financeSQL.split(';').filter(s => s.trim().length > 0);
          for (const statement of financeStatements) {
            if (statement.trim()) {
              try {
                await db.run(statement);
              } catch (stmtError) {
                if (!stmtError.message.includes('already exists')) {
                  console.error('Error executing finance modules statement:', stmtError.message);
                }
              }
            }
          }
          console.log('✓ Finance modules (Petty Cash Ledger & Asset Registry) migration completed');
        }
      }

      // Run department reports approval workflow migration if needed
      if (fs.existsSync(departmentReportsApprovalPath)) {
        const tableInfo = await db.all("PRAGMA table_info(department_reports)");
        const columnNames = tableInfo.map(col => col.name);
        const needsMigration = !columnNames.includes('dept_head_reviewed_by') || 
                              !columnNames.includes('dept_head_status') ||
                              !columnNames.includes('dept_head_notes');
        
        if (needsMigration) {
          console.log('Adding department head approval workflow columns to department_reports table...');
          const approvalSQL = fs.readFileSync(departmentReportsApprovalPath, 'utf8');
          const approvalStatements = approvalSQL.split(';').filter(s => s.trim().length > 0);
          for (const statement of approvalStatements) {
            if (statement.trim()) {
              try {
                await db.run(statement);
              } catch (stmtError) {
                if (!stmtError.message.includes('duplicate column') && 
                    !stmtError.message.includes('already exists')) {
                  console.error('Error executing approval workflow statement:', stmtError.message);
                }
              }
            }
          }
          console.log('✓ Department reports approval workflow migration completed');
        }
      }

      // Run finance approval workflow migration if needed
      if (fs.existsSync(financeApprovalWorkflowPath)) {
        // Check if petty_cash_ledgers table exists and if new columns are missing
        const pettyCashLedgerTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='petty_cash_ledgers'");
        if (pettyCashLedgerTableExists) {
          const pettyCashInfo = await db.all("PRAGMA table_info(petty_cash_ledgers)");
          const pettyCashColumns = pettyCashInfo.map(col => col.name);
          const needsPettyCashMigration = !pettyCashColumns.includes('dept_head_approved_by') || 
                                        !pettyCashColumns.includes('dept_head_status');
          
          // Check if assets table exists and if new columns are missing
          const assetsTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='assets'");
          let needsAssetsMigration = false;
          if (assetsTableExists) {
            const assetsInfo = await db.all("PRAGMA table_info(assets)");
            const assetsColumns = assetsInfo.map(col => col.name);
            needsAssetsMigration = !assetsColumns.includes('dept_head_approved_by') || 
                                   !assetsColumns.includes('dept_head_status');
          }
          
          if (needsPettyCashMigration || needsAssetsMigration) {
            console.log('Adding finance approval workflow columns to petty_cash_ledgers and assets tables...');
            const financeApprovalSQL = fs.readFileSync(financeApprovalWorkflowPath, 'utf8');
            const financeApprovalStatements = financeApprovalSQL.split(';').filter(s => s.trim().length > 0);
            for (const statement of financeApprovalStatements) {
              if (statement.trim()) {
                try {
                  await db.run(statement);
                } catch (stmtError) {
                  if (!stmtError.message.includes('duplicate column') && 
                      !stmtError.message.includes('already exists')) {
                    console.error('Error executing finance approval workflow statement:', stmtError.message);
                  }
                }
              }
            }
            console.log('✓ Finance approval workflow migration completed');
          }
          
          // Update petty_cash_ledgers approval_status constraint for PostgreSQL
          const USE_POSTGRESQL = !!process.env.DATABASE_URL;
          if (USE_POSTGRESQL && pettyCashLedgerTableExists) {
            try {
              // Find and drop the existing constraint
              const constraint = await db.get(`
                SELECT constraint_name 
                FROM information_schema.table_constraints 
                WHERE table_name = 'petty_cash_ledgers' 
                AND constraint_type = 'CHECK'
                AND constraint_name LIKE '%approval_status%'
              `);
              
              if (constraint) {
                await db.run(`ALTER TABLE petty_cash_ledgers DROP CONSTRAINT ${constraint.constraint_name}`);
                console.log(`✓ Dropped existing constraint: ${constraint.constraint_name}`);
              } else {
                // Try common constraint names
                const constraintNames = ['petty_cash_ledgers_approval_status_check', 'petty_cash_ledgers_approval_status_chk', 'check_approval_status'];
                for (const constraintName of constraintNames) {
                  try {
                    await db.run(`ALTER TABLE petty_cash_ledgers DROP CONSTRAINT IF EXISTS ${constraintName}`);
                  } catch (e) {
                    // Ignore if doesn't exist
                  }
                }
              }
              
              // Add new constraint with all status values including workflow statuses
              await db.run(`
                ALTER TABLE petty_cash_ledgers 
                ADD CONSTRAINT petty_cash_ledgers_approval_status_check 
                CHECK (approval_status IN ('Draft', 'Pending Review', 'Pending Approval', 'Approved', 'Locked', 'Pending_DeptHead', 'Pending_Admin', 'Rejected'))
              `);
              console.log('✓ Updated petty_cash_ledgers approval_status constraint to include workflow statuses');
            } catch (constraintError) {
              console.error('Error updating petty_cash_ledgers constraint (non-fatal):', constraintError.message);
              // Continue even if constraint update fails
            }
          }
        }
      }

      // Run call memos migration if table doesn't exist
      const callMemosTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='call_memos'");
      if (!callMemosTableExists && fs.existsSync(callMemosPath)) {
        console.log('Creating call_memos table...');
        const callMemosSQL = fs.readFileSync(callMemosPath, 'utf8');
        const callMemosStatements = callMemosSQL.split(';').filter(s => s.trim().length > 0);
        for (const statement of callMemosStatements) {
          if (statement.trim()) {
            try {
              await db.run(statement);
            } catch (stmtError) {
              if (!stmtError.message.includes('already exists')) {
                console.error('Error executing call memos statement:', stmtError.message);
              }
            }
          }
        }
        console.log('✓ Call memos table created');
      }

      // Run proposals migration if table doesn't exist
      const proposalsTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='proposals'");
      if (!proposalsTableExists && fs.existsSync(proposalsPath)) {
        console.log('Creating proposals table...');
        const proposalsSQL = fs.readFileSync(proposalsPath, 'utf8');
        const proposalsStatements = proposalsSQL.split(';').filter(s => s.trim().length > 0);
        for (const statement of proposalsStatements) {
          if (statement.trim()) {
            try {
              await db.run(statement);
            } catch (stmtError) {
              if (!stmtError.message.includes('already exists')) {
                console.error('Error executing proposals statement:', stmtError.message);
              }
            }
          }
        }
        console.log('✓ Proposals table created');
      }

      // Run meetings migration if table doesn't exist
      const meetingsTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='meetings'");
      if (!meetingsTableExists) {
        if (fs.existsSync(meetingsPath)) {
          console.log('Creating meetings tables...');
          const meetingsSQL = fs.readFileSync(meetingsPath, 'utf8');
          const meetingsStatements = meetingsSQL.split(';').filter(s => s.trim().length > 0);
          for (const statement of meetingsStatements) {
            if (statement.trim()) {
              try {
                await db.run(statement);
              } catch (stmtError) {
                if (!stmtError.message.includes('already exists')) {
                  console.error('Error executing meetings statement:', stmtError.message);
                }
              }
            }
          }
          console.log('✓ Meetings tables created');
        } else {
          console.error('⚠️ meetings migration file not found:', meetingsPath);
        }
      }

      // Run archived documents migration if table doesn't exist
      const archivedDocumentsTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='archived_documents'");
      if (!archivedDocumentsTableExists) {
        if (fs.existsSync(archivedDocumentsPath)) {
          console.log('Creating archived_documents table...');
          const archivedDocumentsSQL = fs.readFileSync(archivedDocumentsPath, 'utf8');
          const archivedDocumentsStatements = archivedDocumentsSQL.split(';').filter(s => s.trim().length > 0);
          for (const statement of archivedDocumentsStatements) {
            if (statement.trim()) {
              try {
                await db.run(statement);
              } catch (stmtError) {
                if (!stmtError.message.includes('already exists')) {
                  console.error('Error executing archived documents statement:', stmtError.message);
                }
              }
            }
          }
          console.log('✓ Archived documents table created');
        } else {
          console.error('⚠️ archived_documents migration file not found:', archivedDocumentsPath);
        }
      }

      // Run staff attendance migration if table doesn't exist
      const staffAttendanceTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='staff_attendance'");
      if (!staffAttendanceTableExists) {
        if (fs.existsSync(staffAttendancePath)) {
          console.log('Creating staff_attendance table...');
          const staffAttendanceSQL = fs.readFileSync(staffAttendancePath, 'utf8');
          const staffAttendanceStatements = staffAttendanceSQL.split(';').filter(s => s.trim().length > 0);
          for (const statement of staffAttendanceStatements) {
            if (statement.trim()) {
              try {
                await db.run(statement);
              } catch (stmtError) {
                if (!stmtError.message.includes('already exists')) {
                  console.error('Error executing staff attendance statement:', stmtError.message);
                }
              }
            }
          }
          console.log('✓ Staff attendance table created');
        } else {
          console.error('⚠️ staff_attendance migration file not found:', staffAttendancePath);
        }
      }

      // Run requisitions migration if table doesn't exist
      const requisitionsTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='requisitions'");
      if (!requisitionsTableExists) {
        if (fs.existsSync(requisitionsPath)) {
          console.log('Creating requisitions table...');
          const requisitionsSQL = fs.readFileSync(requisitionsPath, 'utf8');
          const requisitionsStatements = requisitionsSQL.split(';').filter(s => s.trim().length > 0);
          for (const statement of requisitionsStatements) {
            if (statement.trim()) {
              try {
                await db.run(statement);
              } catch (stmtError) {
                if (!stmtError.message.includes('already exists')) {
                  console.error('Error executing requisitions statement:', stmtError.message);
                }
              }
            }
          }
          console.log('✓ Requisitions table created');
        } else {
          console.error('⚠️ requisitions migration file not found:', requisitionsPath);
        }
      }

      // Run targets system migration if needed
      if (fs.existsSync(targetsPath)) {
        const targetsTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='targets'");
        const progressReportsTableInfo = await db.all("PRAGMA table_info(progress_reports)");
        const progressReportsColumnNames = progressReportsTableInfo.map(col => col.name);
        const needsAmountColumn = !progressReportsColumnNames.includes('amount');
        
        if (!targetsTableExists || needsAmountColumn) {
          console.log('Running targets system migration...');
          const targetsSQL = fs.readFileSync(targetsPath, 'utf8');
          const targetsStatements = targetsSQL.split(';').filter(s => s.trim().length > 0);
          for (const statement of targetsStatements) {
            if (statement.trim()) {
              try {
                await db.run(statement);
              } catch (stmtError) {
                // Ignore errors for columns/tables that already exist
                if (!stmtError.message.includes('already exists') && 
                    !stmtError.message.includes('duplicate column')) {
                  console.error('Error executing targets migration statement:', stmtError.message);
                }
              }
            }
          }
          console.log('✓ Targets system migration completed');
        }
      }

      // Run department head fields migration if needed
      if (fs.existsSync(departmentHeadFieldsPath)) {
        const departmentsTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='departments'");
        if (departmentsTableExists) {
          const departmentsTableInfo = await db.all("PRAGMA table_info(departments)");
          const departmentsColumnNames = departmentsTableInfo.map(col => col.name);
          const needsMigration = !departmentsColumnNames.includes('head_name') || 
                                !departmentsColumnNames.includes('head_email') ||
                                !departmentsColumnNames.includes('head_phone');
          
          if (needsMigration) {
            console.log('Adding head_name, head_email, and head_phone columns to departments table...');
            const deptHeadSQL = fs.readFileSync(departmentHeadFieldsPath, 'utf8');
            const deptHeadStatements = deptHeadSQL.split(';').filter(s => s.trim().length > 0);
            for (const statement of deptHeadStatements) {
              if (statement.trim()) {
                try {
                  await db.run(statement);
                } catch (stmtError) {
                  // Ignore errors for columns that already exist
                  if (!stmtError.message.includes('duplicate column') && 
                      !stmtError.message.includes('already exists')) {
                    console.error('Error executing department head fields migration statement:', stmtError.message);
                  }
                }
              }
            }
            console.log('✓ Department head fields migration completed');
          }
        }
      }

      // Run add missing columns migration if needed
      if (fs.existsSync(addMissingColumnsPath)) {
        const clientsTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='clients'");
        if (clientsTableExists) {
          const clientsTableInfo = await db.all("PRAGMA table_info(clients)");
          const clientsColumnNames = clientsTableInfo.map(col => col.name);
          const needsMigration = !clientsColumnNames.includes('category') || 
                                !clientsColumnNames.includes('progress_status') ||
                                !clientsColumnNames.includes('created_by');
          
          if (needsMigration) {
            console.log('Adding missing columns to clients table (category, progress_status, created_by)...');
            const missingColumnsSQL = fs.readFileSync(addMissingColumnsPath, 'utf8');
            const missingColumnsStatements = missingColumnsSQL.split(';').filter(s => s.trim().length > 0);
            for (const statement of missingColumnsStatements) {
              if (statement.trim()) {
                try {
                  await db.run(statement);
                } catch (stmtError) {
                  // Ignore errors for columns that already exist
                  if (!stmtError.message.includes('duplicate column') && 
                      !stmtError.message.includes('already exists')) {
                    console.error('Error executing missing columns migration statement:', stmtError.message);
                  }
                }
              }
            }
            console.log('✓ Missing columns migration completed');
          }
        }
      }
      
      // Fix users table role constraint to include DepartmentHead
      try {
        // SQLite doesn't support ALTER TABLE to modify CHECK constraints
        // We need to recreate the table with the updated constraint
        console.log('Checking users table role constraint...');
        
        // Test if DepartmentHead role is allowed by trying to query the constraint
        // Since we can't directly check constraints, we'll recreate the table if needed
        const testUser = await db.get("SELECT role FROM users LIMIT 1");
        
        if (testUser) {
          // Check if we can insert DepartmentHead (this will fail if constraint doesn't allow it)
          // Instead, we'll recreate the table with the correct constraint
          console.log('Updating users table to support DepartmentHead role...');
          
          // Get all users data
          const allUsers = await db.all('SELECT * FROM users');
          
          // Create new table with updated constraint
          await db.run('BEGIN TRANSACTION');
          
          try {
            // Create temporary table with new constraint
            await db.run(`
              CREATE TABLE users_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                username TEXT UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('Admin', 'Staff', 'Instructor', 'Student', 'Client', 'Partner', 'DepartmentHead')),
                name TEXT NOT NULL,
                phone TEXT,
                profile_image TEXT,
                is_active INTEGER DEFAULT 1,
                email_verified INTEGER DEFAULT 0,
                email_verification_token TEXT,
                password_reset_token TEXT,
                password_reset_expires DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
              )
            `);
            
            // Copy data from old table
            for (const user of allUsers) {
              await db.run(`
                INSERT INTO users_new (id, email, username, password_hash, role, name, phone, profile_image, 
                  is_active, email_verified, email_verification_token, password_reset_token, 
                  password_reset_expires, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `, [
                user.id, user.email, user.username, user.password_hash, user.role, user.name, 
                user.phone, user.profile_image, user.is_active, user.email_verified,
                user.email_verification_token, user.password_reset_token, 
                user.password_reset_expires, user.created_at, user.updated_at
              ]);
            }
            
            // Drop old table - handle foreign key constraints
            // For SQLite: disable foreign keys temporarily
            // For PostgreSQL: use CASCADE to drop dependent objects
            const USE_POSTGRESQL = !!process.env.DATABASE_URL;
            if (USE_POSTGRESQL) {
              // PostgreSQL: Drop with CASCADE to handle foreign key dependencies
              try {
                await db.run('DROP TABLE IF EXISTS users CASCADE');
              } catch (dropError) {
                // If CASCADE fails, try dropping foreign key constraints first
                if (dropError.message.includes('depends on') || dropError.message.includes('cannot drop')) {
                  console.log('Attempting to drop foreign key constraints first...');
                  try {
                    // Get all foreign key constraints referencing users table
                    const fkConstraints = await db.all(`
                      SELECT 
                        conname, 
                        conrelid::regclass::text as table_name
                      FROM pg_constraint
                      WHERE confrelid = 'users'::regclass::oid
                      AND contype = 'f'
                    `);
                    
                    for (const fk of fkConstraints) {
                      try {
                        await db.run(`ALTER TABLE ${fk.table_name} DROP CONSTRAINT IF EXISTS ${fk.conname}`);
                      } catch (fkError) {
                        console.warn(`Could not drop constraint ${fk.conname}:`, fkError.message);
                      }
                    }
                    
                    // Try dropping table again
                    await db.run('DROP TABLE IF EXISTS users');
                  } catch (fkError) {
                    console.warn('Could not drop foreign key constraints, trying CASCADE again:', fkError.message);
                    // Last resort: try CASCADE again
                    await db.run('DROP TABLE IF EXISTS users CASCADE');
                  }
                } else {
                  throw dropError;
                }
              }
            } else {
              // SQLite: Disable foreign keys temporarily
              await db.run('PRAGMA foreign_keys = OFF');
              await db.run('DROP TABLE IF EXISTS users');
              await db.run('PRAGMA foreign_keys = ON');
            }
            
            // Rename new table
            await db.run('ALTER TABLE users_new RENAME TO users');
            
            await db.run('COMMIT');
            console.log('✓ Users table updated to support DepartmentHead role');
          } catch (tableError) {
            await db.run('ROLLBACK');
            // Check if error is because constraint already allows DepartmentHead
            if (tableError.message.includes('already exists') || tableError.message.includes('no such table')) {
              console.log('Users table may already support DepartmentHead role');
            } else {
              throw tableError;
            }
          }
        }
      } catch (error) {
        console.error('Error updating users table:', error.message);
        console.log('Note: Users table constraint update skipped');
      }
      
      // Ensure departments table exists (for databases created before departments were added)
      const deptTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='departments'");
      if (!deptTableExists) {
        console.log('Creating missing departments table...');
        await db.run(`
          CREATE TABLE IF NOT EXISTS departments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            description TEXT,
            head_name TEXT NOT NULL,
            head_phone TEXT,
            head_email TEXT UNIQUE NOT NULL,
            manager_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE SET NULL
          )
        `);
        console.log('✓ Departments table created');
      } else {
        // Add new columns if they don't exist
        // Check if columns exist first (PostgreSQL doesn't support IF NOT EXISTS for ALTER TABLE)
        const deptColumns = await db.all("SELECT column_name FROM information_schema.columns WHERE table_name = 'departments' AND table_schema = 'public'");
        const deptColumnNames = deptColumns.map(col => col.column_name);
        
        if (!deptColumnNames.includes('head_name')) {
        try {
          await db.run('ALTER TABLE departments ADD COLUMN head_name TEXT');
          } catch (e) {
            if (!e.message.includes('already exists')) {
              console.error('Error adding head_name column:', e.message);
            }
          }
        }
        if (!deptColumnNames.includes('head_phone')) {
        try {
          await db.run('ALTER TABLE departments ADD COLUMN head_phone TEXT');
          } catch (e) {
            if (!e.message.includes('already exists')) {
              console.error('Error adding head_phone column:', e.message);
            }
          }
        }
        if (!deptColumnNames.includes('head_email')) {
        try {
          await db.run('ALTER TABLE departments ADD COLUMN head_email TEXT');
          } catch (e) {
            if (!e.message.includes('already exists')) {
              console.error('Error adding head_email column:', e.message);
            }
          }
        }
        try {
          // Add unique constraint separately if needed
          await db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_head_email ON departments(head_email) WHERE head_email IS NOT NULL');
        } catch (e) { /* Index may already exist */ }
      }

      // Create department_reports table
      const reportsTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='department_reports'");
      if (!reportsTableExists) {
        console.log('Creating department_reports table...');
        await db.run(`
          CREATE TABLE IF NOT EXISTS department_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            department_id INTEGER NOT NULL,
            submitted_by INTEGER NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            attachments TEXT,
            status TEXT DEFAULT 'Pending' CHECK(status IN ('Pending', 'Approved', 'Rejected')),
            admin_notes TEXT,
            reviewed_by INTEGER,
            reviewed_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
            FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
          )
        `);
        console.log('✓ Department reports table created');
      }

      // Ensure certificates table has new columns
      const certTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='certificates'");
      if (certTableExists) {
        // Check if columns exist first (PostgreSQL doesn't support IF NOT EXISTS for ALTER TABLE)
        const certColumns = await db.all("SELECT column_name FROM information_schema.columns WHERE table_name = 'certificates' AND table_schema = 'public'");
        const certColumnNames = certColumns.map(col => col.column_name);
        
        if (!certColumnNames.includes('file_path')) {
        try {
          await db.run('ALTER TABLE certificates ADD COLUMN file_path TEXT');
        } catch (e) {
            if (!e.message.includes('already exists')) {
              console.error('Error adding file_path column:', e.message);
        }
          }
        }
        if (!certColumnNames.includes('file_type')) {
        try {
          await db.run('ALTER TABLE certificates ADD COLUMN file_type TEXT');
        } catch (e) {
            if (!e.message.includes('already exists')) {
              console.error('Error adding file_type column:', e.message);
        }
          }
        }
        if (!certColumnNames.includes('completion_date')) {
        try {
          await db.run('ALTER TABLE certificates ADD COLUMN completion_date DATE');
        } catch (e) {
            if (!e.message.includes('already exists')) {
              console.error('Error adding completion_date column:', e.message);
        }
          }
        }
        if (!certColumnNames.includes('updated_at')) {
        try {
            await db.run('ALTER TABLE certificates ADD COLUMN updated_at TIMESTAMP DEFAULT NOW()');
        } catch (e) {
            if (!e.message.includes('already exists')) {
              console.error('Error adding updated_at column:', e.message);
            }
          }
        }
      }
      
      // Verify admin user exists, create if missing
      let adminUser = await db.get('SELECT id, email, role, is_active FROM users WHERE email = ?', ['admin@prinstinegroup.org']);
      if (!adminUser) {
        // Try the old email
        adminUser = await db.get('SELECT id, email, role, is_active FROM users WHERE email = ?', ['admin@prinstine.com']);
        if (adminUser) {
          // Update to new email
          await db.run('UPDATE users SET email = ? WHERE id = ?', ['admin@prinstinegroup.org', adminUser.id]);
          console.log('✓ Admin email updated to admin@prinstinegroup.org');
        }
      }
      
      if (!adminUser) {
        // Create admin user if it doesn't exist
        console.log('Creating admin user...');
        const bcrypt = require('bcrypt');
        const passwordHash = await bcrypt.hash('Admin@123', 10);
        
        try {
          const result = await db.run(
            `INSERT INTO users (email, username, password_hash, role, name, is_active, email_verified)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ['admin@prinstinegroup.org', 'admin', passwordHash, 'Admin', 'System Administrator', 1, 1]
          );
          console.log('✓ Admin user created: admin@prinstinegroup.org');
          
          // Verify
          adminUser = await db.get('SELECT id, email, role, is_active FROM users WHERE email = ?', ['admin@prinstinegroup.org']);
        } catch (createError) {
          console.error('Error creating admin user:', createError.message);
        }
      }
      
      if (adminUser) {
        console.log('✓ Admin user found:', adminUser.email, '- Active:', adminUser.is_active);
      } else {
        console.warn('⚠ Admin user not found in database!');
      }
    }
    
    // FINAL CHECK: Ensure all critical tables exist (runs after both if and else blocks)
    console.log('\n=== Running final table verification ===');
    const requiredTables = [
      { name: 'staff_attendance', path: staffAttendancePath },
      { name: 'requisitions', path: requisitionsPath },
      { name: 'meetings', path: meetingsPath },
      { name: 'archived_documents', path: archivedDocumentsPath },
      { name: 'targets', path: targetsPath },
      { name: 'call_memos', path: callMemosPath },
      { name: 'proposals', path: proposalsPath },
      { name: 'progress_reports', path: progressReportsTablePath },
      { name: 'department_reports', path: null }, // Created in initial schema
      { name: 'payroll_records', path: payrollManagementPath }
    ];
    
      for (const table of requiredTables) {
        console.log(`Checking table: ${table.name}...`);
        if (table.path) {
          console.log(`Migration path: ${table.path}`);
          console.log(`File exists: ${fs.existsSync(table.path)}`);
        } else {
          console.log(`No migration path (table created in initial schema)`);
        }
        
        const tableExists = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [table.name]);
        if (!tableExists) {
          console.log(`⚠️ Table ${table.name} does not exist. Attempting to create...`);
          if (table.path && fs.existsSync(table.path)) {
          try {
            console.log(`Reading migration file: ${table.path}`);
            const migrationSQL = fs.readFileSync(table.path, 'utf8');
            console.log(`Migration SQL length: ${migrationSQL.length} characters`);
            const statements = migrationSQL.split(';').filter(s => s.trim().length > 0);
            console.log(`Found ${statements.length} SQL statements`);
            
            for (let i = 0; i < statements.length; i++) {
              const statement = statements[i].trim();
              if (statement) {
                try {
                  console.log(`Executing statement ${i + 1}/${statements.length} for ${table.name}...`);
                  await db.run(statement);
                  console.log(`✓ Statement ${i + 1} executed successfully`);
                } catch (stmtError) {
                  if (!stmtError.message.includes('already exists') && 
                      !stmtError.message.includes('duplicate column') &&
                      !stmtError.message.includes('duplicate index')) {
                    console.error(`✗ Error executing statement ${i + 1} for ${table.name}:`, stmtError.message);
                    console.error(`Statement was: ${statement.substring(0, 100)}...`);
                  } else {
                    console.log(`⚠ Statement ${i + 1} skipped (already exists): ${stmtError.message}`);
                  }
                }
              }
            }
            
            // Verify table was created
            const verifyTable = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [table.name]);
            if (verifyTable) {
              console.log(`✓ ${table.name} table created and verified`);
            } else {
              console.error(`✗ ${table.name} table creation failed - table still does not exist after migration`);
            }
          } catch (error) {
            console.error(`Failed to create ${table.name} table:`, error.message);
            console.error(`Error stack:`, error.stack);
          }
        } else {
          console.error(`⚠️ Migration file not found for ${table.name}:`, table.path);
          console.error(`Current working directory: ${process.cwd()}`);
          console.error(`__dirname: ${__dirname}`);
          
          // Fallback: Create table directly with SQL if migration file not found
          console.log(`Attempting to create ${table.name} table directly...`);
          try {
            if (table.name === 'staff_attendance') {
              await db.run(`
                CREATE TABLE IF NOT EXISTS staff_attendance (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  user_id INTEGER NOT NULL,
                  user_name TEXT,
                  attendance_date DATE NOT NULL,
                  sign_in_time DATETIME,
                  sign_out_time DATETIME,
                  sign_in_late BOOLEAN DEFAULT 0,
                  sign_in_late_reason TEXT,
                  sign_out_early BOOLEAN DEFAULT 0,
                  sign_out_early_reason TEXT,
                  status TEXT DEFAULT 'Pending' CHECK(status IN ('Pending', 'Approved', 'Rejected')),
                  approved_by INTEGER,
                  approved_at DATETIME,
                  admin_notes TEXT,
                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
                  UNIQUE(user_id, attendance_date)
                )
              `);
              await db.run(`CREATE INDEX IF NOT EXISTS idx_staff_attendance_user_id ON staff_attendance(user_id)`);
              await db.run(`CREATE INDEX IF NOT EXISTS idx_staff_attendance_date ON staff_attendance(attendance_date)`);
              await db.run(`CREATE INDEX IF NOT EXISTS idx_staff_attendance_status ON staff_attendance(status)`);
              await db.run(`CREATE INDEX IF NOT EXISTS idx_staff_attendance_approved_by ON staff_attendance(approved_by)`);
              console.log(`✓ ${table.name} table created directly`);
            } else if (table.name === 'requisitions') {
              await db.run(`
                CREATE TABLE IF NOT EXISTS requisitions (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  user_id INTEGER NOT NULL,
                  department_id INTEGER,
                  title TEXT NOT NULL,
                  description TEXT,
                  amount DECIMAL(10, 2) NOT NULL,
                  status TEXT DEFAULT 'Pending_DeptHead' CHECK(status IN ('Pending_DeptHead', 'DeptHead_Approved', 'DeptHead_Rejected', 'Pending_Admin', 'Admin_Approved', 'Admin_Rejected', 'Approved')),
                  dept_head_reviewed_by INTEGER,
                  dept_head_reviewed_at DATETIME,
                  dept_head_notes TEXT,
                  admin_reviewed_by INTEGER,
                  admin_reviewed_at DATETIME,
                  admin_notes TEXT,
                  attachments TEXT,
                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
                  FOREIGN KEY (dept_head_reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
                  FOREIGN KEY (admin_reviewed_by) REFERENCES users(id) ON DELETE SET NULL
                )
              `);
              console.log(`✓ ${table.name} table created directly`);
            } else if (table.name === 'meetings') {
              await db.run(`
                CREATE TABLE IF NOT EXISTS meetings (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  title TEXT NOT NULL,
                  description TEXT,
                  meeting_date DATETIME NOT NULL,
                  location TEXT,
                  organizer_id INTEGER NOT NULL,
                  status TEXT DEFAULT 'Scheduled' CHECK(status IN ('Scheduled', 'Completed', 'Cancelled', 'Postponed')),
                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (organizer_id) REFERENCES users(id) ON DELETE CASCADE
                )
              `);
              await db.run(`
                CREATE TABLE IF NOT EXISTS meeting_participants (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  meeting_id INTEGER NOT NULL,
                  user_id INTEGER NOT NULL,
                  status TEXT DEFAULT 'Invited' CHECK(status IN ('Invited', 'Accepted', 'Declined', 'Attended', 'Absent')),
                  response_at DATETIME,
                  notes TEXT,
                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
                  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                  UNIQUE(meeting_id, user_id)
                )
              `);
              console.log(`✓ ${table.name} tables created directly`);
            } else if (table.name === 'archived_documents') {
              await db.run(`
                CREATE TABLE IF NOT EXISTS archived_documents (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  title TEXT NOT NULL,
                  description TEXT,
                  file_path TEXT NOT NULL,
                  file_type TEXT,
                  file_size INTEGER,
                  uploaded_by INTEGER NOT NULL,
                  source_type TEXT,
                  source_id INTEGER,
                  department_id INTEGER,
                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE,
                  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
                )
              `);
              console.log(`✓ ${table.name} table created directly`);
            } else if (table.name === 'call_memos') {
              await db.run(`
                CREATE TABLE IF NOT EXISTS call_memos (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  client_id INTEGER NOT NULL,
                  client_name TEXT NOT NULL,
                  participants TEXT NOT NULL,
                  subject TEXT NOT NULL,
                  call_date DATE NOT NULL,
                  discussion TEXT NOT NULL,
                  service_needed TEXT NOT NULL CHECK(service_needed IN ('Consultancy', 'Training (Academy)', 'Web Development', 'System Development', 'Audit', 'Others')),
                  service_other TEXT,
                  department_needed TEXT,
                  next_visitation_date DATE,
                  created_by INTEGER NOT NULL,
                  created_by_name TEXT,
                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
                  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
                )
              `);
              await db.run(`CREATE INDEX IF NOT EXISTS idx_call_memos_client_id ON call_memos(client_id)`);
              await db.run(`CREATE INDEX IF NOT EXISTS idx_call_memos_created_by ON call_memos(created_by)`);
              await db.run(`CREATE INDEX IF NOT EXISTS idx_call_memos_call_date ON call_memos(call_date)`);
              await db.run(`CREATE INDEX IF NOT EXISTS idx_call_memos_service_needed ON call_memos(service_needed)`);
              console.log(`✓ ${table.name} table created directly`);
            } else if (table.name === 'proposals') {
              await db.run(`
                CREATE TABLE IF NOT EXISTS proposals (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  client_id INTEGER,
                  client_name TEXT NOT NULL,
                  proposal_date DATE NOT NULL,
                  document_path TEXT,
                  document_name TEXT,
                  status TEXT DEFAULT 'Pending_Marketing' CHECK(status IN ('Pending_Marketing', 'Marketing_Approved', 'Marketing_Rejected', 'Pending_Admin', 'Approved', 'Rejected')),
                  marketing_reviewed_by INTEGER,
                  marketing_reviewed_at DATETIME,
                  marketing_notes TEXT,
                  admin_reviewed_by INTEGER,
                  admin_reviewed_at DATETIME,
                  admin_notes TEXT,
                  created_by INTEGER NOT NULL,
                  created_by_name TEXT,
                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
                  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
                  FOREIGN KEY (marketing_reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
                  FOREIGN KEY (admin_reviewed_by) REFERENCES users(id) ON DELETE SET NULL
                )
              `);
              await db.run(`CREATE INDEX IF NOT EXISTS idx_proposals_client_id ON proposals(client_id)`);
              await db.run(`CREATE INDEX IF NOT EXISTS idx_proposals_created_by ON proposals(created_by)`);
              await db.run(`CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status)`);
              await db.run(`CREATE INDEX IF NOT EXISTS idx_proposals_proposal_date ON proposals(proposal_date)`);
              console.log(`✓ ${table.name} table created directly`);
            } else if (table.name === 'targets') {
              await db.run(`
                CREATE TABLE IF NOT EXISTS targets (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  user_id INTEGER NOT NULL,
                  target_amount DECIMAL(10, 2) NOT NULL,
                  target_type TEXT DEFAULT 'Employee' CHECK(target_type IN ('Employee', 'Client_Consultancy', 'Client_Audit', 'Student', 'Others')),
                  status TEXT DEFAULT 'Signed_Contract' CHECK(status IN ('Signed_Contract', 'Pipeline_Client', 'Submitted')),
                  start_date DATE,
                  end_date DATE,
                  created_by INTEGER NOT NULL,
                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
                )
              `);
              await db.run(`
                CREATE TABLE IF NOT EXISTS target_progress (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  target_id INTEGER NOT NULL,
                  progress_amount DECIMAL(10, 2) NOT NULL,
                  progress_date DATE NOT NULL,
                  notes TEXT,
                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (target_id) REFERENCES targets(id) ON DELETE CASCADE
                )
              `);
              await db.run(`
                CREATE TABLE IF NOT EXISTS fund_sharing (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  from_user_id INTEGER NOT NULL,
                  to_user_id INTEGER NOT NULL,
                  amount DECIMAL(10, 2) NOT NULL,
                  reason TEXT,
                  status TEXT DEFAULT 'Active' CHECK(status IN ('Active', 'Reversed')),
                  reversed_by INTEGER,
                  reversed_at DATETIME,
                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
                  FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE,
                  FOREIGN KEY (reversed_by) REFERENCES users(id) ON DELETE SET NULL
                )
              `);
              // Add amount column to progress_reports if it doesn't exist
              try {
                await db.run(`ALTER TABLE progress_reports ADD COLUMN amount DECIMAL(10, 2) DEFAULT 0`);
              } catch (e) {
                // Column may already exist
              }
              console.log(`✓ ${table.name} tables created directly`);
            } else if (table.name === 'progress_reports') {
              await db.run(`
                CREATE TABLE IF NOT EXISTS progress_reports (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  name TEXT NOT NULL,
                  date DATE NOT NULL,
                  category TEXT NOT NULL CHECK(category IN ('Student', 'Client for Consultancy', 'Client for Audit', 'Others')),
                  status TEXT NOT NULL CHECK(status IN ('Pending', 'Signed Contract', 'Pipeline Client', 'Submitted', 'Approved', 'Rejected')),
                  department_id INTEGER,
                  department_name TEXT,
                  created_by INTEGER NOT NULL,
                  created_by_name TEXT NOT NULL,
                  created_by_email TEXT,
                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  amount DECIMAL(10, 2) DEFAULT 0,
                  admin_notes TEXT,
                  admin_reviewed_by INTEGER,
                  admin_reviewed_at DATETIME,
                  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
                  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
                  FOREIGN KEY (admin_reviewed_by) REFERENCES users(id) ON DELETE SET NULL
                )
              `);
              
              await db.run(`CREATE INDEX IF NOT EXISTS idx_progress_reports_created_by ON progress_reports(created_by)`);
              await db.run(`CREATE INDEX IF NOT EXISTS idx_progress_reports_department_id ON progress_reports(department_id)`);
              await db.run(`CREATE INDEX IF NOT EXISTS idx_progress_reports_date ON progress_reports(date)`);
              await db.run(`CREATE INDEX IF NOT EXISTS idx_progress_reports_category ON progress_reports(category)`);
              await db.run(`CREATE INDEX IF NOT EXISTS idx_progress_reports_status ON progress_reports(status)`);
              
              // Update existing table to support new status values and approval fields
              try {
                const USE_POSTGRESQL = !!process.env.DATABASE_URL;
                
                // Check if table exists and has old constraint
                let tableExists = false;
                if (USE_POSTGRESQL) {
                  const check = await db.get(
                    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'progress_reports'"
                  );
                  tableExists = !!check;
                } else {
                  const check = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='progress_reports'");
                  tableExists = !!check;
                }
                
                if (tableExists) {
                  // Add approval columns if they don't exist
                  let hasAdminNotes = false;
                  let hasAdminReviewedBy = false;
                  
                  if (USE_POSTGRESQL) {
                    const adminNotesCheck = await db.get(
                      "SELECT column_name FROM information_schema.columns WHERE table_name = 'progress_reports' AND column_name = 'admin_notes'"
                    );
                    hasAdminNotes = !!adminNotesCheck;
                    
                    const adminReviewedByCheck = await db.get(
                      "SELECT column_name FROM information_schema.columns WHERE table_name = 'progress_reports' AND column_name = 'admin_reviewed_by'"
                    );
                    hasAdminReviewedBy = !!adminReviewedByCheck;
                  } else {
                    const tableInfo = await db.all("PRAGMA table_info(progress_reports)");
                    hasAdminNotes = tableInfo.some(col => col.name === 'admin_notes');
                    hasAdminReviewedBy = tableInfo.some(col => col.name === 'admin_reviewed_by');
                  }
                  
                  if (!hasAdminNotes) {
                    await db.run('ALTER TABLE progress_reports ADD COLUMN admin_notes TEXT');
                  }
                  if (!hasAdminReviewedBy) {
                    await db.run('ALTER TABLE progress_reports ADD COLUMN admin_reviewed_by INTEGER');
                    await db.run('ALTER TABLE progress_reports ADD COLUMN admin_reviewed_at DATETIME');
                  }
                  
                  // For PostgreSQL, we need to drop and recreate the constraint
                  if (USE_POSTGRESQL) {
                    try {
                      // Drop old constraint if it exists (try different possible constraint names)
                      const constraintNames = [
                        'progress_reports_status_check',
                        'progress_reports_status_chk',
                        'check_status'
                      ];
                      
                      for (const constraintName of constraintNames) {
                        try {
                          await db.run(`ALTER TABLE progress_reports DROP CONSTRAINT IF EXISTS ${constraintName}`);
                        } catch (e) {
                          // Try to find the actual constraint name
                          const constraint = await db.get(`
                            SELECT constraint_name 
                            FROM information_schema.table_constraints 
                            WHERE table_name = 'progress_reports' 
                            AND constraint_type = 'CHECK'
                            AND constraint_name LIKE '%status%'
                          `);
                          if (constraint) {
                            await db.run(`ALTER TABLE progress_reports DROP CONSTRAINT ${constraint.constraint_name}`);
                            break;
                          }
                        }
                      }
                      
                      // Add new constraint with all status values
                      await db.run(`
                        ALTER TABLE progress_reports 
                        ADD CONSTRAINT progress_reports_status_check 
                        CHECK (status IN ('Pending', 'Signed Contract', 'Pipeline Client', 'Submitted', 'Approved', 'Rejected'))
                      `);
                      console.log('✓ Updated progress_reports status constraint to include Pending, Approved, Rejected');
                    } catch (constraintError) {
                      console.log('Note: Could not update status constraint (may already be updated):', constraintError.message);
                    }
                  }
                  // SQLite doesn't support ALTER TABLE for CHECK constraints, but new tables will have the correct constraint
                }
              } catch (alterError) {
                console.log('Note: Could not alter progress_reports table:', alterError.message);
              }
              
              console.log(`✓ ${table.name} table created directly`);
            } else if (table.name === 'requisitions') {
              // Update requisitions status constraint to include 'Approved' for work_support
              if (USE_POSTGRESQL) {
                try {
                  const requisitionsConstraint = await db.get(`
                    SELECT constraint_name 
                    FROM information_schema.table_constraints 
                    WHERE table_name = 'requisitions' 
                    AND constraint_type = 'CHECK'
                    AND constraint_name LIKE '%status%'
                  `);
                  
                  if (requisitionsConstraint) {
                    // Check if constraint already includes 'Approved'
                    const constraintDef = await db.get(`
                      SELECT check_clause 
                      FROM information_schema.check_constraints 
                      WHERE constraint_name = ?
                    `, [requisitionsConstraint.constraint_name]);
                    
                    if (constraintDef && !constraintDef.check_clause.includes("'Approved'")) {
                      // Drop old constraint
                      await db.run(`ALTER TABLE requisitions DROP CONSTRAINT ${requisitionsConstraint.constraint_name}`);
                      
                      // Add new constraint with 'Approved' included
                      await db.run(`
                        ALTER TABLE requisitions 
                        ADD CONSTRAINT requisitions_status_check 
                        CHECK (status IN ('Pending_DeptHead', 'DeptHead_Approved', 'DeptHead_Rejected', 'Pending_Admin', 'Admin_Approved', 'Admin_Rejected', 'Approved'))
                      `);
                      console.log('✓ Updated requisitions status constraint to include Approved');
                    }
                  }
                } catch (requisitionsConstraintError) {
                  console.log('Note: Could not update requisitions constraint (may already be updated):', requisitionsConstraintError.message);
                }
              }
              console.log(`✓ ${table.name} table constraint checked/updated`);
            } else if (table.name === 'department_reports') {
              await db.run(`
                CREATE TABLE IF NOT EXISTS department_reports (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  department_id INTEGER NOT NULL,
                  submitted_by INTEGER NOT NULL,
                  title TEXT NOT NULL,
                  content TEXT NOT NULL,
                  attachments TEXT,
                  status TEXT DEFAULT 'Pending' CHECK(status IN ('Pending', 'Approved', 'Rejected')),
                  admin_notes TEXT,
                  reviewed_by INTEGER,
                  reviewed_at DATETIME,
                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
                  FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE CASCADE,
                  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
                )
              `);
              console.log(`✓ ${table.name} table created directly`);
            } else if (table.name === 'payroll_records') {
              await db.run(`
                CREATE TABLE IF NOT EXISTS payroll_records (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  staff_id INTEGER NOT NULL,
                  user_id INTEGER NOT NULL,
                  payroll_period_start DATE NOT NULL,
                  payroll_period_end DATE NOT NULL,
                  gross_salary REAL NOT NULL,
                  deductions REAL DEFAULT 0,
                  net_salary REAL NOT NULL,
                  bonus REAL DEFAULT 0,
                  allowances REAL DEFAULT 0,
                  tax_deductions REAL DEFAULT 0,
                  other_deductions REAL DEFAULT 0,
                  notes TEXT,
                  status TEXT DEFAULT 'Draft' CHECK(status IN ('Draft', 'Submitted', 'Admin_Approved', 'Admin_Rejected', 'Processed', 'Paid')),
                  submitted_by INTEGER,
                  submitted_at DATETIME,
                  approved_by INTEGER,
                  approved_at DATETIME,
                  admin_notes TEXT,
                  processed_at DATETIME,
                  payment_date DATE,
                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE,
                  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                  FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL,
                  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
                )
              `);
              await db.run(`CREATE INDEX IF NOT EXISTS idx_payroll_records_staff_id ON payroll_records(staff_id)`);
              await db.run(`CREATE INDEX IF NOT EXISTS idx_payroll_records_user_id ON payroll_records(user_id)`);
              await db.run(`CREATE INDEX IF NOT EXISTS idx_payroll_records_status ON payroll_records(status)`);
              await db.run(`CREATE INDEX IF NOT EXISTS idx_payroll_records_period ON payroll_records(payroll_period_start, payroll_period_end)`);
              await db.run(`CREATE INDEX IF NOT EXISTS idx_payroll_records_submitted_by ON payroll_records(submitted_by)`);
              await db.run(`CREATE INDEX IF NOT EXISTS idx_payroll_records_approved_by ON payroll_records(approved_by)`);
              console.log(`✓ ${table.name} table created directly`);
            }
            
            // Verify table was created
            const verifyTable = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [table.name]);
            if (verifyTable) {
              console.log(`✓ ${table.name} table verified after direct creation`);
            }
          } catch (fallbackError) {
            console.error(`✗ Failed to create ${table.name} table directly:`, fallbackError.message);
          }
        }
      } else {
        console.log(`✓ ${table.name} table exists`);
      }
    }
    console.log('=== Table verification complete ===\n');
    
    // FINAL CHECK: Ensure all required columns exist in academy tables
    console.log('=== Running column verification for academy tables ===');
    
    // Check students table columns
    const studentsTableCheck = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='students'");
    if (studentsTableCheck) {
      const studentsInfo = await db.all("PRAGMA table_info(students)");
      const studentsColumns = studentsInfo.map(col => col.name);
      const requiredStudentColumns = ['approved', 'approved_by', 'approved_at', 'admin_notes', 'created_by'];
      
      for (const col of requiredStudentColumns) {
        if (!studentsColumns.includes(col)) {
          console.log(`Adding missing column '${col}' to students table...`);
          try {
            if (col === 'approved') {
              await db.run('ALTER TABLE students ADD COLUMN approved INTEGER DEFAULT 0');
            } else if (col === 'approved_by') {
              await db.run('ALTER TABLE students ADD COLUMN approved_by INTEGER');
            } else if (col === 'approved_at') {
              await db.run('ALTER TABLE students ADD COLUMN approved_at DATETIME');
            } else if (col === 'admin_notes') {
              await db.run('ALTER TABLE students ADD COLUMN admin_notes TEXT');
            } else if (col === 'created_by') {
              await db.run('ALTER TABLE students ADD COLUMN created_by INTEGER');
            }
            console.log(`✓ Added '${col}' to students table`);
          } catch (e) {
            if (!e.message.includes('duplicate column') && !e.message.includes('already exists')) {
              console.error(`Error adding '${col}' to students:`, e.message);
            }
          }
        }
      }
    }
    
    // Check instructors table columns
    const instructorsTableCheck = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='instructors'");
    if (instructorsTableCheck) {
      const instructorsInfo = await db.all("PRAGMA table_info(instructors)");
      const instructorsColumns = instructorsInfo.map(col => col.name);
      const requiredInstructorColumns = ['approved', 'approved_by', 'approved_at', 'admin_notes'];
      
      for (const col of requiredInstructorColumns) {
        if (!instructorsColumns.includes(col)) {
          console.log(`Adding missing column '${col}' to instructors table...`);
          try {
            if (col === 'approved') {
              await db.run('ALTER TABLE instructors ADD COLUMN approved INTEGER DEFAULT 0');
            } else if (col === 'approved_by') {
              await db.run('ALTER TABLE instructors ADD COLUMN approved_by INTEGER');
            } else if (col === 'approved_at') {
              await db.run('ALTER TABLE instructors ADD COLUMN approved_at DATETIME');
            } else if (col === 'admin_notes') {
              await db.run('ALTER TABLE instructors ADD COLUMN admin_notes TEXT');
            }
            console.log(`✓ Added '${col}' to instructors table`);
          } catch (e) {
            if (!e.message.includes('duplicate column') && !e.message.includes('already exists')) {
              console.error(`Error adding '${col}' to instructors:`, e.message);
            }
          }
        }
      }
    }
    
    // Check courses table columns
    const coursesTableCheck = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='courses'");
    if (coursesTableCheck) {
      const coursesInfo = await db.all("PRAGMA table_info(courses)");
      const coursesColumns = coursesInfo.map(col => col.name);
      const requiredCourseColumns = ['course_fee', 'fee_approved', 'approved_by', 'approved_at', 'admin_notes', 'created_by'];
      
      for (const col of requiredCourseColumns) {
        if (!coursesColumns.includes(col)) {
          console.log(`Adding missing column '${col}' to courses table...`);
          try {
            if (col === 'course_fee') {
              await db.run('ALTER TABLE courses ADD COLUMN course_fee REAL DEFAULT 0');
            } else if (col === 'fee_approved') {
              await db.run('ALTER TABLE courses ADD COLUMN fee_approved INTEGER DEFAULT 0');
            } else if (col === 'approved_by') {
              await db.run('ALTER TABLE courses ADD COLUMN approved_by INTEGER');
            } else if (col === 'approved_at') {
              await db.run('ALTER TABLE courses ADD COLUMN approved_at DATETIME');
            } else if (col === 'admin_notes') {
              await db.run('ALTER TABLE courses ADD COLUMN admin_notes TEXT');
            } else if (col === 'created_by') {
              await db.run('ALTER TABLE courses ADD COLUMN created_by INTEGER');
            }
            console.log(`✓ Added '${col}' to courses table`);
          } catch (e) {
            if (!e.message.includes('duplicate column') && !e.message.includes('already exists')) {
              console.error(`Error adding '${col}' to courses:`, e.message);
            }
          }
        }
      }
    }
    
    // Check progress_reports table for amount column
    const progressReportsTableCheck = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='progress_reports'");
    if (progressReportsTableCheck) {
      const progressReportsInfo = await db.all("PRAGMA table_info(progress_reports)");
      const progressReportsColumns = progressReportsInfo.map(col => col.name);
      
      if (!progressReportsColumns.includes('amount')) {
        console.log('Adding missing column \'amount\' to progress_reports table...');
        try {
          await db.run('ALTER TABLE progress_reports ADD COLUMN amount DECIMAL(10, 2) DEFAULT 0');
          console.log('✓ Added \'amount\' to progress_reports table');
        } catch (e) {
          if (!e.message.includes('duplicate column') && !e.message.includes('already exists')) {
            console.error('Error adding \'amount\' to progress_reports:', e.message);
          }
        }
      }
    }
    
    // Run academy cohorts migration if needed
    if (fs.existsSync(academyCohortsPath)) {
      const cohortsTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='cohorts'");
      if (!cohortsTableExists) {
        console.log('Creating cohorts table...');
        const cohortsSQL = fs.readFileSync(academyCohortsPath, 'utf8');
        const cohortsStatements = cohortsSQL.split(';').filter(s => s.trim().length > 0);
        for (const statement of cohortsStatements) {
          if (statement.trim()) {
            try {
              await db.run(statement);
            } catch (stmtError) {
              // Ignore errors for columns that already exist
              if (!stmtError.message.includes('duplicate column') && 
                  !stmtError.message.includes('already exists') &&
                  !stmtError.message.includes('no such table')) {
                console.error('Error executing cohorts migration statement:', stmtError.message);
              }
            }
          }
        }
        console.log('✓ Cohorts table and columns created');
      } else {
        // Table exists, but check if students table has cohort_id and period columns
        const studentsInfo = await db.all("PRAGMA table_info(students)");
        const studentsColumns = studentsInfo.map(col => col.name);
        const needsCohortColumn = !studentsColumns.includes('cohort_id');
        const needsPeriodColumn = !studentsColumns.includes('period');
        
        if (needsCohortColumn || needsPeriodColumn) {
          console.log('Adding cohort_id and period columns to students table...');
          if (needsCohortColumn) {
            try {
              await db.run('ALTER TABLE students ADD COLUMN cohort_id INTEGER');
              console.log('✓ Added cohort_id to students table');
            } catch (e) {
              if (!e.message.includes('duplicate column') && !e.message.includes('already exists')) {
                console.error('Error adding cohort_id to students:', e.message);
              }
            }
          }
          if (needsPeriodColumn) {
            try {
              await db.run('ALTER TABLE students ADD COLUMN period TEXT');
              console.log('✓ Added period to students table');
            } catch (e) {
              if (!e.message.includes('duplicate column') && !e.message.includes('already exists')) {
                console.error('Error adding period to students:', e.message);
              }
            }
          }
        }
      }
    }

    // Run student payment transactions migration if needed
    if (fs.existsSync(studentPaymentTransactionsPath)) {
      const tExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='student_payment_transactions'");
      if (!tExists) {
        console.log('Creating student_payment_transactions table...');
        const sql = fs.readFileSync(studentPaymentTransactionsPath, 'utf8');
        const stmts = sql.split(';').filter(s => s.trim().length > 0);
        for (const statement of stmts) {
          if (statement.trim()) {
            try {
              await db.run(statement);
            } catch (e) {
              if (!e.message.includes('already exists') && !e.message.includes('duplicate')) {
                console.error('Error executing student_payment_transactions migration:', e.message);
              }
            }
          }
        }
        console.log('✓ student_payment_transactions created');
      }
    }

    // Run student invoices migration if needed
    if (fs.existsSync(studentInvoicesPath)) {
      const invExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='student_invoices'");
      if (!invExists) {
        console.log('Creating student invoices tables...');
        const sql = fs.readFileSync(studentInvoicesPath, 'utf8');
        const stmts = sql.split(';').filter(s => s.trim().length > 0);
        for (const statement of stmts) {
          if (statement.trim()) {
            try {
              await db.run(statement);
            } catch (e) {
              if (!e.message.includes('already exists') && !e.message.includes('duplicate')) {
                console.error('Error executing student_invoices migration:', e.message);
              }
            }
          }
        }
        console.log('✓ student_invoices created');
      }
    }

    // Run grade submissions migration if needed
    if (fs.existsSync(gradeSubmissionsPath)) {
      const gExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='grade_submissions'");
      if (!gExists) {
        console.log('Creating grade_submissions table...');
        const sql = fs.readFileSync(gradeSubmissionsPath, 'utf8');
        const stmts = sql.split(';').filter(s => s.trim().length > 0);
        for (const statement of stmts) {
          if (statement.trim()) {
            try {
              await db.run(statement);
            } catch (e) {
              if (!e.message.includes('already exists') && !e.message.includes('duplicate')) {
                console.error('Error executing grade_submissions migration:', e.message);
              }
            }
          }
        }
        console.log('✓ grade_submissions created');
      }
    }

    // Attendance: office geolocation columns (sign-in / sign-out lat-lng audit)
    if (fs.existsSync(attendanceGeoCoordsPath)) {
      const geoSql = fs.readFileSync(attendanceGeoCoordsPath, 'utf8');
      const geoStmts = geoSql.split(';').filter((s) => s.trim().length > 0);
      let geoApplied = false;
      for (const statement of geoStmts) {
        if (statement.trim()) {
          try {
            await db.run(statement);
            geoApplied = true;
          } catch (e) {
            const msg = (e && e.message) || '';
            if (
              msg.includes('duplicate column') ||
              msg.includes('already exists') ||
              msg.includes('42701')
            ) {
              // Column already present (SQLite / PostgreSQL)
            } else {
              console.error('Error executing attendance geo columns migration:', msg);
            }
          }
        }
      }
      if (geoApplied) {
        console.log('✓ staff_attendance geolocation columns applied');
      }
    }

    // Cohort-based certificate access windows
    if (fs.existsSync(certificateAccessWindowsPath)) {
      const certWindowSql = fs.readFileSync(certificateAccessWindowsPath, 'utf8');
      const certWindowStmts = certWindowSql.split(';').filter((s) => s.trim().length > 0);
      let certWindowApplied = false;
      for (const statement of certWindowStmts) {
        if (!statement.trim()) continue;
        try {
          await db.run(statement);
          certWindowApplied = true;
        } catch (e) {
          const msg = (e && e.message) || '';
          if (
            msg.includes('duplicate column') ||
            msg.includes('already exists') ||
            msg.includes('42701')
          ) {
            // idempotent migration
          } else {
            console.error('Error executing certificate access migration:', msg);
          }
        }
      }
      if (certWindowApplied) {
        console.log('✓ cohort certificate access window columns applied');
      }
    }
    
    console.log('=== Column verification complete ===\n');
  } catch (error) {
    console.error('Database initialization error:', error);
    console.error('Error stack:', error.stack);
    process.exit(1);
  }
}

// Routes
app.use('/api/audit-logs', require('./routes/auditLogs'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/departments', require('./routes/departments'));
app.use('/api/department-reports', require('./routes/departmentReports'));
app.use('/api/reports', require('./routes/reportsHistory'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/partners', require('./routes/partners'));
app.use('/api/academy', require('./routes/academy'));
app.use('/api/certificates', require('./routes/certificates'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/my-reports-history', require('./routes/reportsHistory'));
app.use('/api/marketing', require('./routes/marketing'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/backup', require('./routes/backup'));
app.use('/api/call-memos', require('./routes/callMemos'));
app.use('/api/proposals', require('./routes/proposals'));
app.use('/api/meetings', require('./routes/meetings'));
const { router: archivedDocumentsRouter } = require('./routes/archivedDocuments');
app.use('/api/archived-documents', archivedDocumentsRouter);
app.use('/api/attendance', require('./routes/staffAttendance'));
app.use('/api/requisitions', require('./routes/requisitions'));
app.use('/api/targets', require('./routes/targets'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/support-tickets', require('./routes/supportTickets'));
app.use('/api/progress-reports', require('./routes/progressReports'));
app.use('/api/staff-client-reports', require('./routes/staffClientReports'));
app.use('/api/payroll', require('./routes/payroll'));
app.use('/api/student-payments', require('./routes/studentPayments'));
app.use('/api/finance', require('./routes/finance'));
app.use('/api/appraisals', require('./routes/appraisals'));

// Root route - API information
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'Prinstine Management System API',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      users: '/api/users',
      dashboard: '/api/dashboard',
      departments: '/api/departments',
      reports: '/api/department-reports',
      attendance: '/api/attendance',
      requisitions: '/api/requisitions',
      targets: '/api/targets',
      notifications: '/api/notifications'
    },
    documentation: 'All API routes are under /api/*'
  });
});

// Health check - MUST be before 404 handler
app.get('/api/health', (req, res) => {
  console.log('=== HEALTH CHECK HIT ===');
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Simple POST test endpoint (BEFORE body parser to test)
app.post('/api/test-post', (req, res) => {
  console.log('=== TEST POST HIT ===');
  res.status(200).json({ status: 'post-ok', body: req.body });
});

// Make io globally available for notifications
global.io = io;

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Join user-specific room when authenticated
  socket.on('authenticate', (userId) => {
    socket.join(`user_${userId}`);
    console.log(`User ${userId} joined their room`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Error handling middleware - MUST be after all routes
app.use((err, req, res, next) => {
  // Handle JSON parsing errors
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    console.error('JSON parsing error:', err.message);
    if (!res.headersSent) {
      return res.status(400).json({ error: 'Invalid JSON in request body' });
    }
  }
  
  console.error('Error:', err);
  if (!res.headersSent) {
    res.status(err.status || 500).json({
      error: err.message || 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
  }
});

// Serve static files from React app build directory (for production)
const buildPath = path.join(__dirname, '../client/build');

// Serve static files and handle SPA routing (for production)
if (fs.existsSync(buildPath)) {
  console.log('Frontend build found at:', buildPath);
  
  // Serve static files from build folder (CSS, JS, images, etc.)
  // This MUST come before the SPA catch-all route
  // Use fallthrough: true so that non-existent static files fall through to SPA handler
  app.use(express.static(buildPath, {
    // Don't automatically serve index.html - we'll handle that manually
    index: false,
    // Set proper cache headers for static assets
    maxAge: '1y',
    // Allow requests to fall through to next middleware if file not found
    fallthrough: true
  }));
  
  // Handle all non-API routes - serve index.html for SPA routing
  // This MUST be the last route to catch all client-side routes
  // Use app.all to handle all HTTP methods (GET, POST, etc.)
  app.all('*', (req, res, next) => {
    // Skip API routes - they should have been handled by route handlers above
    if (req.path.startsWith('/api/')) {
      // If we get here, it's an unmatched API route
      console.error('404 - API Route not found:', req.method, req.path);
      return res.status(404).json({ 
        error: 'Route not found',
        path: req.path,
        method: req.method
      });
    }
    
    // Skip uploads routes
    if (req.path.startsWith('/uploads/')) {
      return res.status(404).json({ 
        error: 'File not found',
        path: req.path
      });
    }
    
    // For all other routes, serve index.html
    // This includes:
    // - Client-side routes like /login, /dashboard, /academy
    // - Static file requests that don't exist (fallthrough from express.static)
    // React Router will handle the client-side routing
    
    const indexPath = path.join(buildPath, 'index.html');
    
    // Check if index.html exists
    if (!fs.existsSync(indexPath)) {
      console.error('index.html not found at:', indexPath);
      return res.status(500).json({ 
        error: 'Frontend application not properly built',
        path: req.path
      });
    }
    
    // Set proper headers
    res.setHeader('Content-Type', 'text/html');
    
    res.sendFile(indexPath, (err) => {
      if (err) {
        console.error('Error serving index.html:', err);
        if (!res.headersSent) {
          res.status(500).json({ 
            error: 'Failed to load application',
            path: req.path,
            message: err.message
          });
        }
      }
    });
  });
} else {
  console.warn('Frontend build not found at:', buildPath);
  
  // If build doesn't exist, handle routes appropriately
  app.all('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      // Unmatched API route
      console.error('404 - API Route not found:', req.method, req.path);
      return res.status(404).json({ 
        error: 'Route not found',
        path: req.path,
        method: req.method
      });
    }
    
    // Non-API route but no build
    res.status(503).json({ 
      error: 'Frontend build not found. Please ensure the React app is built.',
      path: req.path,
      buildPath: buildPath
    });
  });
}

/**
 * One-time sync: set target_progress.status = 'Approved' for any row linked to an
 * already-approved progress_report. Fixes historical data where the report was approved
 * but the target_progress row was left as Pending (so the target total did not increase).
 * Safe to run on every startup (idempotent).
 */
async function syncApprovedProgressReportsToTargets() {
  try {
    const USE_POSTGRESQL = !!process.env.DATABASE_URL;
    let tableExists;
    if (USE_POSTGRESQL) {
      tableExists = await db.get(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'target_progress'"
      );
    } else {
      tableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='target_progress'");
    }
    if (!tableExists) return;

    const result = await db.run(
      `UPDATE target_progress SET status = 'Approved'
       WHERE progress_report_id IN (SELECT id FROM progress_reports WHERE status = 'Approved')
       AND (status IS NULL OR TRIM(COALESCE(status, '')) <> 'Approved')`
    );
    const updated = result.changes || result.rowCount || 0;
    if (updated > 0) {
      console.log(`[sync] Updated ${updated} target_progress row(s) to Approved for already-approved progress reports`);
    }
  } catch (err) {
    console.error('[sync] Non-fatal: sync approved progress to targets failed:', err.message);
  }
}

// Start server
async function startServer() {
  try {
    await initializeDatabase();
    await syncApprovedProgressReportsToTargets();

    // Start periodic database checkpointing for data persistence
    startPeriodicCheckpoint();
    
    // Bind 0.0.0.0 so Render/cloud health checks can reach the app. Use HOST=127.0.0.1 locally if needed.
    const host = process.env.HOST || '0.0.0.0';
    server.listen(PORT, host, () => {
      console.log(`Server running on ${host}:${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`✓ Server is ready to accept requests`);
      
      // Schedule birthday notifications to run daily at 8:00 AM
      scheduleBirthdayNotifications();
    });
    
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Please stop the other server.`);
      } else {
        console.error('Server error:', err);
      }
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown with proper data persistence
async function gracefulShutdown(signal) {
  console.log(`${signal} received, shutting down gracefully...`);
  
  // Stop accepting new connections
  server.close(() => {
    console.log('HTTP server closed');
  });
  
  // Stop periodic checkpoint
  stopPeriodicCheckpoint();
  
  // Force final checkpoint before closing
  if (db.db) {
    console.log('Performing final database checkpoint...');
    await new Promise((resolve) => {
      db.db.run('PRAGMA wal_checkpoint(TRUNCATE)', (err) => {
        if (err && !err.message.includes('database is locked')) {
          console.warn('Final checkpoint warning:', err.message);
        } else {
          console.log('✓ Final database checkpoint completed - all data persisted');
        }
        resolve();
      });
    });
  }
  
  // Close database connection
  await db.close();
  
  console.log('Graceful shutdown completed');
  process.exit(0);
}

// Birthday notification scheduler
function scheduleBirthdayNotifications() {
  // Check birthdays immediately on server start
  checkAndSendBirthdayNotifications().catch(err => {
    console.error('Error checking birthdays on startup:', err);
  });
  
  // Schedule daily check at 8:00 AM
  const scheduleNextCheck = () => {
    const now = new Date();
    const nextCheck = new Date();
    nextCheck.setHours(8, 0, 0, 0);
    
    // If it's already past 8 AM today, schedule for tomorrow
    if (now > nextCheck) {
      nextCheck.setDate(nextCheck.getDate() + 1);
    }
    
    const msUntilNextCheck = nextCheck.getTime() - now.getTime();
    
    setTimeout(() => {
      checkAndSendBirthdayNotifications().catch(err => {
        console.error('Error checking birthdays:', err);
      });
      
      // Schedule next check (24 hours later)
      setInterval(() => {
        checkAndSendBirthdayNotifications().catch(err => {
          console.error('Error checking birthdays:', err);
        });
      }, 24 * 60 * 60 * 1000); // 24 hours
    }, msUntilNextCheck);
    
    console.log(`✓ Birthday notifications scheduled for ${nextCheck.toLocaleString()}`);
  };
  
  scheduleNextCheck();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

module.exports = { app, server, io };


