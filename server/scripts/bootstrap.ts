import bcrypt from 'bcryptjs';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { db, withTransaction } from '../src/db';
import { assignUserId, isReservedUserId } from '../src/auth/user-id';
async function main() {
  const [users] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM users');
  if (Number(users[0]?.n ?? 0) === 0) {
    const password = process.env.ADMIN_PASSWORD;
    if (!password || password.length < 8) throw new Error('首次部署必须设置 ADMIN_PASSWORD（至少 8 位）');
    const username = process.env.ADMIN_USERNAME ?? 'admin';
    if (isReservedUserId(username)) throw new Error('管理员账号不能占用用户 ID');
    await withTransaction(async c => {
    const [created] = await c.query<ResultSetHeader>(
      "INSERT INTO users(username,password_hash,role,display_name,is_active,must_change_pwd) VALUES (?,?,'admin',?,1,1)",
      [
        username,
        await bcrypt.hash(password, 12),
        process.env.ADMIN_DISPLAY_NAME ?? '系统管理员',
      ],
    );
    await assignUserId(c, String(created.insertId));
    });
  }
  await db.end();
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Bootstrap failed');
  process.exitCode = 1;
  void db.end();
});
