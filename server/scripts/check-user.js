const db = require('../config/database');
const { comparePassword } = require('../utils/auth');

async function checkUser() {
  try {
    await db.connect();
    const email = process.argv[2] || 'jsieh@prinstinegroup.org' || 'marjorie@prinstinegroup.org';
    
    console.log(`=== Checking User: ${email} ===\n`);
    
    const normalizedEmail = email.toLowerCase().trim();
    
    // Try multiple lookup methods
    let user = await db.get(
      'SELECT id, email, username, password_hash, role, name, is_active, email_verified FROM users WHERE LOWER(TRIM(email)) = ?',
      [normalizedEmail]
    );
    
    if (!user) {
      user = await db.get(
        'SELECT id, email, username, password_hash, role, name, is_active, email_verified FROM users WHERE LOWER(email) = ?',
        [normalizedEmail]
      );
    }
    
    if (!user) {
      user = await db.get(
        'SELECT id, email, username, password_hash, role, name, is_active, email_verified FROM users WHERE email = ?',
        [email]
      );
    }
    
    if (!user) {
      console.log('❌ User not found!');
      console.log('\nSearching for similar emails...');
      const similar = await db.all(
        'SELECT email, role FROM users WHERE email LIKE ?',
        [`%${email.split('@')[0]}%`]
      );
      if (similar.length > 0) {
        console.log('Found similar emails:');
        similar.forEach(u => console.log(`  - ${u.email} (${u.role})`));
      }
      await db.close();
      return;
    }
    
    console.log('✅ User found:');
    console.log(`  ID: ${user.id}`);
    console.log(`  Email: ${user.email}`);
    console.log(`  Username: ${user.username}`);
    console.log(`  Role: ${user.role}`);
    console.log(`  Name: ${user.name}`);
    console.log(`  Is Active: ${user.is_active}`);
    console.log(`  Email Verified: ${user.email_verified}`);
    console.log(`  Password Hash: ${user.password_hash ? 'EXISTS (' + user.password_hash.substring(0, 20) + '...)' : 'MISSING!'}`);
    
    if (user.password_hash) {
      console.log(`  Hash Length: ${user.password_hash.length}`);
      console.log(`  Hash Format: ${user.password_hash.startsWith('$2') ? 'Valid bcrypt' : 'INVALID!'}`);
    }
    
    // Test password if provided
    if (process.argv[3]) {
      const testPassword = process.argv[3];
      console.log(`\n=== Testing Password ===`);
      if (user.password_hash) {
        const isValid = await comparePassword(testPassword, user.password_hash);
        console.log(`Password "${testPassword}": ${isValid ? '✅ MATCHES' : '❌ Does not match'}`);
      } else {
        console.log('❌ Cannot test password - hash is missing!');
      }
    }
    
    await db.close();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkUser();

