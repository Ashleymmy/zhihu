import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { rows, withTransaction } from '../db';
import { AppError } from '../middleware/errors';
import { AuthUser } from '../types';
import { writeAudit } from './audit.service';

interface McnAccountRow extends RowDataPacket {
  id: string;
  account_key: string;
  account_name: string;
  owner_user_id: string;
  status: 'active' | 'suspended' | 'archived';
  created_at: Date;
  updated_at: Date;
}

interface UserRow extends RowDataPacket {
  id: string;
  is_active: number;
}

const publicAccount = (row: McnAccountRow) => ({
  id: String(row.id),
  accountKey: row.account_key,
  accountName: row.account_name,
  ownerUserId: String(row.owner_user_id),
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function listMcnAccounts() {
  const accounts = await rows<McnAccountRow>('SELECT * FROM mcn_accounts ORDER BY id');
  return accounts.map(publicAccount);
}

export async function createMcnAccount(
  user: AuthUser,
  input: { accountKey: string; accountName: string; ownerUserId?: string },
  ip?: string,
) {
  const ownerUserId = input.ownerUserId ?? user.sub;
  const [owner] = await rows<UserRow>('SELECT id, is_active FROM users WHERE id = ? LIMIT 1', [ownerUserId]);
  if (!owner || !owner.is_active) throw new AppError(422, 42206, '账户负责人不存在或已停用');

  const id = await withTransaction(async (connection) => {
    const [existing] = await connection.query<RowDataPacket[]>(
      'SELECT id FROM mcn_accounts WHERE account_key = ? LIMIT 1 FOR UPDATE',
      [input.accountKey],
    );
    if (existing.length) throw new AppError(409, 40902, 'MCN 账户标识已存在');
    const [result] = await connection.query<ResultSetHeader>(
      'INSERT INTO mcn_accounts (account_key, account_name, owner_user_id) VALUES (?, ?, ?)',
      [input.accountKey, input.accountName, ownerUserId],
    );
    const accountId = String(result.insertId);
    await writeAudit(
      { userId: user.sub, action: 'mcn.create', resourceType: 'mcn_account', resourceId: accountId, ip },
      connection,
    );
    return accountId;
  });
  const [created] = await rows<McnAccountRow>('SELECT * FROM mcn_accounts WHERE id = ? LIMIT 1', [id]);
  return publicAccount(created);
}
