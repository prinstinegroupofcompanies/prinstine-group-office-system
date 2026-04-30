const { Pool } = require('pg');
require('dotenv').config();

// PostgreSQL Database Connection
class PostgreSQLDatabase {
  constructor() {
    this.pool = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (!process.env.DATABASE_URL) {
        reject(new Error('DATABASE_URL environment variable is not set'));
        return;
      }

      try {
        // Parse and validate the connection string
        let connectionString = process.env.DATABASE_URL.trim();
        
        // Validate URL format
        if (!connectionString.startsWith('postgresql://') && !connectionString.startsWith('postgres://')) {
          console.error('\n❌ Invalid DATABASE_URL format!');
          console.error('URL must start with postgresql:// or postgres://');
          console.error('Current value:', connectionString.substring(0, 50) + '...');
          reject(new Error('Invalid DATABASE_URL format. Must start with postgresql://'));
          return;
        }
        
        // Parse URL to validate components
        try {
          const url = new URL(connectionString);
          if (!url.hostname || url.hostname === 'base' || url.hostname.length < 3) {
            console.error('\n❌ Invalid DATABASE_URL hostname!');
            console.error('Hostname is missing or invalid:', url.hostname);
            console.error('Make sure you copied the COMPLETE Internal Database URL from Render');
            console.error('It should look like: postgresql://user:pass@dpg-xxxxx-a.region-postgres.render.com:5432/dbname');
            reject(new Error('Invalid DATABASE_URL hostname. Check that you copied the complete URL.'));
            return;
          }
          
          if (!url.port || url.port === '') {
            console.warn('⚠️  No port specified in DATABASE_URL. Adding default port 5432.');
            // Fix the URL by adding port if missing
            // Pattern: postgresql://user:pass@host/db -> postgresql://user:pass@host:5432/db
            if (connectionString.match(/@([^:\/]+)\/([^\/\s]+)/)) {
              connectionString = connectionString.replace(/@([^:\/]+)\//, '@$1:5432/');
              console.log('✓ Fixed DATABASE_URL by adding port 5432');
            }
          } else if (url.port !== '5432') {
            console.warn('⚠️  Unexpected port in DATABASE_URL. Expected 5432, got:', url.port);
          }
          
          console.log('✓ DATABASE_URL format validated');
          console.log('  Hostname:', url.hostname);
          console.log('  Database:', url.pathname.replace('/', ''));
        } catch (urlError) {
          console.error('\n❌ Failed to parse DATABASE_URL!');
          console.error('Error:', urlError.message);
          console.error('Make sure the URL is complete and properly formatted');
          reject(new Error('Invalid DATABASE_URL format: ' + urlError.message));
          return;
        }
        
        // If the URL contains an IPv6 address, warn user
        if (connectionString.includes('[') || connectionString.match(/:\/\/([0-9a-f:]+):/i)) {
          console.warn('⚠️  IPv6 address detected in DATABASE_URL. This may cause connection issues.');
          console.warn('⚠️  Make sure you are using the INTERNAL Database URL from Render, not External.');
        }
        
        // Configure pool with better connection handling
        this.pool = new Pool({
          connectionString: connectionString,
          ssl: connectionString.includes('localhost') || connectionString.includes('127.0.0.1') ? false : {
            rejectUnauthorized: false
          },
          max: 20, // Maximum number of clients in the pool
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 10000, // Increased timeout for network issues
          // Force IPv4 if IPv6 is causing issues
          // Note: This is handled at the OS level, but we can add retry logic
        });

        // Test connection with retry logic
        const testConnection = (retries = 3) => {
          this.pool.query('SELECT NOW()', (err, result) => {
            if (err) {
              console.error('PostgreSQL connection error:', err.message);
              console.error('Error code:', err.code);
              
              // Provide helpful error messages
              if (err.code === 'ENETUNREACH' || err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
                console.error('\n❌ PostgreSQL Connection Failed!');
                console.error('Error code:', err.code);
                console.error('Error message:', err.message);
                console.error('\n📋 Common Issues & Solutions:');
                console.error('1. ❌ DATABASE_URL is malformed or incomplete');
                console.error('   ✅ Fix: Copy the COMPLETE Internal Database URL from Render');
                console.error('   ✅ It should look like: postgresql://user:pass@dpg-xxxxx-a.region-postgres.render.com:5432/dbname');
                console.error('');
                console.error('2. ❌ Using External Database URL instead of Internal');
                console.error('   ✅ Fix: Use the "Internal Database URL" (NOT External)');
                console.error('');
                console.error('3. ❌ URL was truncated or partially copied');
                console.error('   ✅ Fix: Make sure you copied the ENTIRE URL, including:');
                console.error('      - postgresql:// prefix');
                console.error('      - username:password');
                console.error('      - @hostname:5432');
                console.error('      - /database_name');
                console.error('');
                console.error('4. ❌ Database service not running');
                console.error('   ✅ Fix: Check Render dashboard - database should show "Available"');
                console.error('');
                console.error('5. ❌ Services in different regions');
                console.error('   ✅ Fix: Ensure backend and database are in the SAME region\n');
              }
              
              // Retry logic for transient errors
              if (retries > 0 && (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT')) {
                console.log(`Retrying connection... (${retries} attempts remaining)`);
                setTimeout(() => testConnection(retries - 1), 2000);
              } else {
                reject(err);
              }
            } else {
              console.log('✓ Connected to PostgreSQL database');
              console.log('✓ Database time:', result.rows[0].now);
              resolve(this.pool);
            }
          });
        };
        
        testConnection();
      } catch (error) {
        console.error('PostgreSQL initialization error:', error.message);
        reject(error);
      }
    });
  }

  close() {
    return new Promise((resolve) => {
      if (this.pool) {
        this.pool.end(() => {
          console.log('PostgreSQL connection pool closed');
          this.pool = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  // Execute a query and return all rows
  async all(sql, params = []) {
    if (!this.pool) {
      throw new Error('Database not connected');
    }

    try {
      // Convert SQLite syntax to PostgreSQL
      const pgSql = this.convertSQLiteToPostgres(sql, params);
      const result = await this.pool.query(pgSql, params);
      return result.rows;
    } catch (err) {
      // If table doesn't exist, return empty array instead of error
      if (err.message && err.message.includes('does not exist')) {
        console.warn(`Table may not exist yet: ${err.message}`);
        console.warn(`Query: ${sql.substring(0, 100)}...`);
        return [];
      }
      console.error('Database all() error:', err.message);
      throw err;
    }
  }

  // Execute a query and return first row
  async get(sql, params = []) {
    if (!this.pool) {
      throw new Error('Database not connected');
    }

    try {
      const pgSql = this.convertSQLiteToPostgres(sql);
      const result = await this.pool.query(pgSql, params);
      return result.rows[0] || null;
    } catch (err) {
      // If table doesn't exist, return null instead of error
      if (err.message && err.message.includes('does not exist')) {
        console.warn(`Table may not exist yet: ${err.message}`);
        console.warn(`Query: ${sql.substring(0, 100)}...`);
        return null;
      }
      console.error('Database get() error:', err.message);
      throw err;
    }
  }

  // Execute a query (INSERT, UPDATE, DELETE)
  async run(sql, params = []) {
    if (!this.pool) {
      throw new Error('Database not connected');
    }

    const resyncSequenceIfNeeded = async (error, pgSqlText, sqlParams) => {
      const message = error && error.message ? error.message : '';
      if (!message.includes('duplicate key value violates unique constraint')) {
        return null;
      }

      const constraintMatch = message.match(/unique constraint "([^"]+)"/i);
      const constraintName = constraintMatch ? constraintMatch[1] : null;
      if (!constraintName || !constraintName.endsWith('_pkey')) {
        return null;
      }

      const tableName = constraintName.replace(/_pkey$/i, '');
      if (!/^[A-Za-z0-9_]+$/.test(tableName)) {
        return null;
      }

      const insertRegex = new RegExp(`INSERT\\s+INTO\\s+${tableName}\\b`, 'i');
      if (!insertRegex.test(pgSqlText)) {
        return null;
      }

      try {
        await this.pool.query(
          `SELECT setval(pg_get_serial_sequence('${tableName}', 'id'), (SELECT COALESCE(MAX(id), 1) FROM ${tableName}))`
        );
      } catch (syncErr) {
        console.error(`❌ Failed to sync sequence for ${tableName}:`, syncErr.message);
        return null;
      }

      try {
        return await this.pool.query(pgSqlText, sqlParams);
      } catch (retryErr) {
        return null;
      }
    };

    try {
      const pgSql = this.convertSQLiteToPostgres(sql, params);
      
      // Log converted SQL only when DEBUG_SQL=1 (avoid log spam in production)
      if (process.env.DEBUG_SQL === '1' && (sql.toUpperCase().includes('CREATE TABLE') || sql.toUpperCase().includes('INSERT'))) {
        console.log('📝 Original SQL (first 150):', sql.substring(0, 150));
        console.log('📝 Converted SQL (first 150):', pgSql.substring(0, 150));
      }
      
      const result = await this.pool.query(pgSql, params);
      
      // Return format compatible with SQLite
      // For INSERT statements, PostgreSQL returns the inserted row via RETURNING clause
      let lastID = null;
      if (result.rows && result.rows.length > 0) {
        // Try to get id from returned row (PostgreSQL returns via RETURNING)
        lastID = result.rows[0].id || result.rows[0].ID || null;
      }
      
      return {
        lastID: lastID,
        changes: result.rowCount || 0
      };
    } catch (err) {
      const pgSql = this.convertSQLiteToPostgres(sql, params);
      const retryResult = await resyncSequenceIfNeeded(err, pgSql, params);
      if (retryResult) {
        let lastID = null;
        if (retryResult.rows && retryResult.rows.length > 0) {
          lastID = retryResult.rows[0].id || retryResult.rows[0].ID || null;
        }
        return {
          lastID: lastID,
          changes: retryResult.rowCount || 0
        };
      }
      console.error('❌ Database run() error:', err.message);
      if (process.env.DEBUG_SQL === '1') {
        console.error('📝 Original SQL (first 200):', sql.substring(0, 200));
        console.error('📝 Converted SQL (first 200):', this.convertSQLiteToPostgres(sql, params).substring(0, 200));
        console.error('📝 Params:', params);
      }
      throw err;
    }
  }

  // Convert SQLite syntax to PostgreSQL
  convertSQLiteToPostgres(sql, params = []) {
    let pgSql = sql.trim();
    
    // Skip empty statements
    if (!pgSql || pgSql.length < 10) {
      return pgSql;
    }

    // Convert sqlite_master queries FIRST (before parameter conversion)
    // This needs to happen before parameter conversion so we can handle ? placeholders correctly
    if (pgSql.includes('sqlite_master')) {
      // Convert: SELECT name FROM sqlite_master WHERE type='table' AND name=?
      if (pgSql.includes("type='table'") || pgSql.includes('type=\'table\'')) {
        // Check if there's a parameter placeholder (?)
        if (pgSql.includes('name=?')) {
          // Count how many ? placeholders exist before this point to determine the parameter number
          const beforeName = pgSql.substring(0, pgSql.indexOf('name=?'));
          const paramCount = (beforeName.match(/\?/g) || []).length;
          const paramNum = paramCount + 1;
          // Use parameter placeholder - will be converted to $1, $2, etc. later
          pgSql = `SELECT table_name as name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $${paramNum}`;
        } else {
          // Extract table name if it's a literal value
          const nameMatch = pgSql.match(/name\s*=\s*['"]?(\w+)['"]?/i);
          if (nameMatch) {
            const tableName = nameMatch[1];
            pgSql = `SELECT table_name as name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${tableName}'`;
          } else {
            // Get all tables
            pgSql = `SELECT table_name as name FROM information_schema.tables WHERE table_schema = 'public'`;
          }
        }
        return pgSql;
      }
    }

    // Convert SQLite parameter placeholders (?) to PostgreSQL ($1, $2, etc.)
    // This must be done AFTER sqlite_master conversion
    if (pgSql.includes('?')) {
      let paramIndex = 1;
      pgSql = pgSql.replace(/\?/g, () => `$${paramIndex++}`);
    }

    // Convert SQLite parameter placeholders (?) to PostgreSQL ($1, $2, etc.)
    // This must be done AFTER sqlite_master conversion
    if (pgSql.includes('?')) {
      let paramIndex = 1;
      pgSql = pgSql.replace(/\?/g, () => `$${paramIndex++}`);
    }

    // Convert PRAGMA table_info to PostgreSQL
    if (pgSql.includes('PRAGMA table_info')) {
      const tableName = pgSql.match(/table_info\(['"]?(\w+)['"]?\)/i)?.[1];
      if (tableName) {
        pgSql = `SELECT column_name as name, data_type as type, is_nullable, column_default as dflt_value 
                 FROM information_schema.columns 
                 WHERE table_name = '${tableName}' AND table_schema = 'public'`;
        return pgSql;
      }
    }

    // Skip other PRAGMA statements (they're SQLite-specific)
    if (pgSql.toUpperCase().startsWith('PRAGMA')) {
      return 'SELECT 1 WHERE 1=0'; // Return empty result
    }

    // Convert INSERT OR IGNORE to INSERT ... ON CONFLICT DO NOTHING
    if (pgSql.toUpperCase().includes('INSERT OR IGNORE')) {
      // Remove "OR IGNORE" from INSERT statement
      pgSql = pgSql.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');
      
      // Find the table name and column list
      const insertMatch = pgSql.match(/INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)/i);
      if (insertMatch) {
        const tableName = insertMatch[1];
        const columns = insertMatch[2];
        
        // Try to find the primary key column (usually 'id' or first column)
        // For now, use a generic approach - conflict on all columns or id
        let conflictColumns = 'id'; // Default to id
        if (columns.includes('id')) {
          conflictColumns = 'id';
        } else {
          // Use first column as fallback
          const firstCol = columns.split(',')[0].trim();
          conflictColumns = firstCol;
        }
        
        // Add ON CONFLICT clause
        if (pgSql.toUpperCase().includes('VALUES')) {
          // Insert before VALUES
          pgSql = pgSql.replace(/\s+VALUES\s+/i, ` ON CONFLICT (${conflictColumns}) DO NOTHING VALUES `);
        } else if (pgSql.toUpperCase().includes('SELECT')) {
          // Insert before SELECT
          pgSql = pgSql.replace(/\s+SELECT\s+/i, ` ON CONFLICT (${conflictColumns}) DO NOTHING SELECT `);
        } else {
          // Add at the end if neither VALUES nor SELECT
          pgSql += ` ON CONFLICT (${conflictColumns}) DO NOTHING`;
        }
      } else {
        // If no column list, try simpler pattern
        const simpleMatch = pgSql.match(/INSERT\s+INTO\s+(\w+)/i);
        if (simpleMatch) {
          pgSql = pgSql.replace(/\s+VALUES\s+/i, ' ON CONFLICT DO NOTHING VALUES ');
        }
      }
    }

    // Convert INTEGER PRIMARY KEY AUTOINCREMENT to SERIAL PRIMARY KEY
    // PostgreSQL doesn't support AUTOINCREMENT - use SERIAL instead
    // Must handle patterns in correct order
    
    // Pattern 1: id INTEGER PRIMARY KEY AUTOINCREMENT -> id SERIAL PRIMARY KEY
    // This must come first to match the full pattern with column name
    pgSql = pgSql.replace(/(\w+)\s+INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, '$1 SERIAL PRIMARY KEY');
    
    // Pattern 2: INTEGER PRIMARY KEY AUTOINCREMENT (without column name) -> SERIAL PRIMARY KEY
    pgSql = pgSql.replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
    
    // Pattern 3: Remove any remaining standalone AUTOINCREMENT keywords
    // PostgreSQL uses SERIAL or sequences, not AUTOINCREMENT
    pgSql = pgSql.replace(/\s+AUTOINCREMENT\b/gi, '');

    // Convert DATETIME to TIMESTAMP
    pgSql = pgSql.replace(/\bDATETIME\b/gi, 'TIMESTAMP');

    // Convert BOOLEAN DEFAULT 0/1 to BOOLEAN DEFAULT false/true
    pgSql = pgSql.replace(/BOOLEAN\s+DEFAULT\s+0\b/gi, 'BOOLEAN DEFAULT false');
    pgSql = pgSql.replace(/BOOLEAN\s+DEFAULT\s+1\b/gi, 'BOOLEAN DEFAULT true');

    // Convert INTEGER DEFAULT 0/1 for boolean-like columns to BOOLEAN
    // This is more complex, so we'll handle it case by case if needed

    // Convert CURRENT_TIMESTAMP to NOW() (but not in DEFAULT CURRENT_TIMESTAMP which becomes DEFAULT NOW())
    pgSql = pgSql.replace(/\bCURRENT_TIMESTAMP\b/gi, 'NOW()');
    
    // Convert CURRENT_DATE to CURRENT_DATE (PostgreSQL supports this)
    // No change needed

    // Convert SQLite square bracket column names [references] to PostgreSQL double quotes "references"
    // This handles reserved keyword escaping differences between SQLite and PostgreSQL
    pgSql = pgSql.replace(/\[references\]/gi, '"references"');
    pgSql = pgSql.replace(/\[(\w+)\]/g, '"$1"'); // Convert any other [column] to "column"

    // Handle RETURNING clause for INSERT (PostgreSQL feature)
    // Only add if not already present and if it's an INSERT statement
    if (pgSql.toUpperCase().includes('INSERT INTO') && 
        !pgSql.toUpperCase().includes('RETURNING') &&
        !pgSql.toUpperCase().includes('ON CONFLICT')) {
      const insertMatch = pgSql.match(/INSERT\s+INTO\s+(\w+)/i);
      if (insertMatch && pgSql.toUpperCase().includes('VALUES')) {
        // Add RETURNING id at the end (before semicolon if present)
        if (pgSql.endsWith(';')) {
          pgSql = pgSql.slice(0, -1) + ' RETURNING id;';
        } else {
          pgSql += ' RETURNING id';
        }
      }
    }

    return pgSql;
  }
}

module.exports = new PostgreSQLDatabase();

