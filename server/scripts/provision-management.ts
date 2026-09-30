/** Run only by a server operator. Creates a new account; never promotes or resets existing users.
 * node dist/scripts/provision-management.js developer developer 开发者 > /protected/credentials.json
 */
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { db, withTransaction } from '../src/db';
import { writeAudit } from '../src/services/audit.service';

async function main() {
  const [username, role, displayName] = process.argv.slice(2);
  if (
    !/^[a-zA-Z0-9_-]{2,64}$/.test(username ?? '') ||
    !['developer', 'operator'].includes(role) ||
    !displayName ||
    displayName.length > 64
  )
    throw new Error('Usage: provision-management <new-username> <developer|operator> <display-name>');
  const password = randomBytes(18).toString('base64url');
  const hash = await bcrypt.hash(password, 12);
  const id = await withTransaction(async (c) => {
    const [[existing]] = await c.query<RowDataPacket[]>('SELECT id FROM users WHERE username=?', [username]);
    if (existing) throw new Error('Account already exists; no changes made');
    const [r] = await c.query<ResultSetHeader>(
      'INSERT INTO users(username,password_hash,role,role_id,display_name,admin_duty,must_change_pwd) VALUES(?,?,?,(SELECT id FROM roles WHERE role_key=?),?,?,1)',
      [username, hash, role, role, displayName, role === 'operator' ? 'operations' : 'all'],
    );
    await writeAudit(
      {
        userId: String(r.insertId),
        action: 'staff.provision',
        resourceType: 'user',
        resourceId: String(r.insertId),
        detail: { role, source: 'server-cli' },
      },
      c,
    );
    return String(r.insertId);
  });
  process.stdout.write(
    JSON.stringify({ id, username, role, temporaryPassword: password, mustChangePassword: true }) + '\n',
  );
}
main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
