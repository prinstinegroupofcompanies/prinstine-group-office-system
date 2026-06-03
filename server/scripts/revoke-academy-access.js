/**
 * Revoke stored academy permissions for one or more users by email.
 * Usage: node scripts/revoke-academy-access.js jsieh@prinstinegroup.org
 */
const db = require('../config/database');

async function revokeAcademyAccess(emails) {
  await db.connect();
  for (const raw of emails) {
    const email = raw.toLowerCase().trim();
    const user = await db.get(
      'SELECT id, email, role, name FROM users WHERE LOWER(TRIM(email)) = ?',
      [email]
    );
    if (!user) {
      console.log(`❌ Not found: ${raw}`);
      continue;
    }
    const result = await db.run('DELETE FROM staff_academy_permissions WHERE user_id = ?', [user.id]);
    console.log(
      `✅ Cleared academy permissions for ${user.name} (${user.email}, id=${user.id}, role=${user.role}) — rows deleted: ${result.changes ?? 0}`
    );
  }
  await db.close();
}

const emails = process.argv.slice(2);
if (!emails.length) {
  console.error('Usage: node scripts/revoke-academy-access.js <email> [email...]');
  process.exit(1);
}

revokeAcademyAccess(emails).catch((err) => {
  console.error(err);
  process.exit(1);
});
