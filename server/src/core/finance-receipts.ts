import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { AuthUser } from '../types';
import type { FinanceScope } from './finance';
import { checksum } from './money';
import { AppError } from '../middleware/errors';

/** Caller holds the account lock; receipt and ledger change commit together. */
export async function financeReceipt<T>(
  c: PoolConnection,
  u: AuthUser,
  s: FinanceScope,
  operation: string,
  key: string | undefined,
  input: unknown,
  work: () => Promise<T>,
): Promise<T> {
  if (!key) return work();
  if (!/^[\w.-]{8,128}$/.test(key)) throw new AppError(422, 42200, '请提供有效的操作编号');
  const scope = { moduleId: s.moduleId, projectId: s.projectId, accountId: s.accountId },
    hash = checksum([scope, input]);
  const [rows] = await c.query<RowDataPacket[]>(
    'SELECT request_hash,response_json FROM opc_finance_requests WHERE module_id=? AND account_id=? AND actor_id=? AND operation=? AND request_key=? FOR UPDATE',
    [s.moduleId, s.accountId, u.sub, operation, key],
  );
  if (rows.length) {
    if (rows[0].request_hash !== hash) throw new AppError(409, 40900, '同一操作编号不能提交不同内容，请刷新核对');
    return (typeof rows[0].response_json === 'string' ? JSON.parse(rows[0].response_json) : rows[0].response_json) as T;
  }
  const result = await work();
  await c.query(
    'INSERT INTO opc_finance_requests(module_id,project_id,account_id,actor_id,operation,request_key,request_hash,response_json) VALUES(?,?,?,?,?,?,?,?)',
    [s.moduleId, s.projectId, s.accountId, u.sub, operation, key, hash, JSON.stringify(result)],
  );
  return result;
}
