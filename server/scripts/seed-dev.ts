import bcrypt from 'bcryptjs';
import { db } from '../src/db';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('禁止在生产环境执行开发 seed');
  const username = process.env.DEV_ADMIN_USERNAME ?? 'admin';
  const password = process.env.DEV_ADMIN_PASSWORD;
  const displayName = process.env.DEV_ADMIN_DISPLAY_NAME ?? '系统管理员';
  if (!password || password.length < 8) throw new Error('DEV_ADMIN_PASSWORD 至少 8 位');
  const passwordHash = await bcrypt.hash(password, 12);
  await db.query(
    `INSERT INTO users (username, password_hash, role, display_name, is_active, must_change_pwd)
     VALUES (?, ?, 'admin', ?, 1, 0)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), display_name = VALUES(display_name), role = 'admin', is_active = 1`,
    [username, passwordHash, displayName],
  );
  console.log(`seeded ${username}`);
  await db.end();
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
