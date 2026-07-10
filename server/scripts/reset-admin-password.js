#!/usr/bin/env node

const db = require('../config/database');
const bcrypt = require('bcrypt');

async function resetAdminPassword() {
  try {
    await db.connect();
    const password = 'Prinstine@2026!Secure#9';
    const hash = await bcrypt.hash(password, 10);

    const admins = await db.all(
      `SELECT id, email, username FROM users WHERE username = ? OR email IN (?, ?)`,
      ['admin', 'admin@prinstine.com', 'admin@prinstinegroup.org']
    );

    if (!admins || admins.length === 0) {
      console.error('No admin user found to update.');
      process.exit(1);
    }

    for (const admin of admins) {
      await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, admin.id]);
      console.log(`Updated admin password for ${admin.email} (${admin.username})`);
    }

    await db.close();
    console.log('Admin password reset completed.');
    process.exit(0);
  } catch (error) {
    console.error('Error resetting admin password:', error);
    process.exit(1);
  }
}

resetAdminPassword();
