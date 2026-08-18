import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { rows, withTransaction } from '../db';
import { AppError } from '../middleware/errors';
import { assertLegacyWithdrawalWritesBlocked } from '../middleware/financeGate';
import { AuthUser } from '../types';
import { maskAccount } from '../utils/maskSecret';
import { pageOffset } from '../utils/pagination';
import { scopeFilter } from '../utils/scopeFilter';
import { writeAudit } from './audit.service';

interface CountRow extends RowDataPacket {
  total: number;
}
interface AmountRow extends RowDataPacket {
  amount: number;
}
interface WithdrawalRow extends RowDataPacket {
  id: string;
  user_id: string;
  amount: number;
  status: string;
  pay_account: string;
}

export async function listEarnings(user: AuthUser, query: Record<string, unknown>) {
  const page = Number(query.page ?? 1),
    pageSize = Number(query.pageSize ?? 20);
  const scope = scopeFilter(user, 'e.user_id');
  const where = [scope.clause];
  const bindings: unknown[] = [...scope.bindings];
  if (query.status) {
    where.push('e.status=?');
    bindings.push(query.status);
  }
  const clause = where.join(' AND ');
  const [count] = await rows<CountRow>(`SELECT COUNT(*) total FROM earnings e WHERE ${clause}`, bindings);
  const list = await rows(
    `SELECT e.* FROM earnings e WHERE ${clause} ORDER BY e.settle_date DESC,e.id DESC LIMIT ? OFFSET ?`,
    [...bindings, pageSize, pageOffset(page, pageSize)],
  );
  return { list, total: Number(count?.total ?? 0), page, pageSize };
}

export async function earningsSummary(user: AuthUser) {
  const scope = scopeFilter(user, 'e.user_id');
  const [earning] = await rows<RowDataPacket & { pending: number; confirmed: number; paid: number }>(
    `SELECT SUM(CASE WHEN e.status='pending' THEN e.amount ELSE 0 END) pending,SUM(CASE WHEN e.status='confirmed' THEN e.amount ELSE 0 END) confirmed,SUM(CASE WHEN e.status='paid' THEN e.amount ELSE 0 END) paid FROM earnings e WHERE ${scope.clause}`,
    scope.bindings,
  );
  const wdScope = scopeFilter(user, 'w.user_id');
  const [withdrawal] = await rows<RowDataPacket & { withdrawn: number }>(
    `SELECT SUM(CASE WHEN w.status='approved' THEN w.amount ELSE 0 END) withdrawn FROM withdrawal_requests w WHERE ${wdScope.clause}`,
    wdScope.bindings,
  );
  return {
    pending: Number(earning?.pending ?? 0),
    confirmed: Number(earning?.confirmed ?? 0),
    paid: Number(earning?.paid ?? 0),
    withdrawn: Number(withdrawal?.withdrawn ?? 0),
  };
}

export async function listWithdrawals(user: AuthUser, query: Record<string, unknown>) {
  const page = Number(query.page ?? 1),
    pageSize = Number(query.pageSize ?? 20);
  const scope = scopeFilter(user, 'w.user_id');
  const where = [scope.clause];
  const bindings: unknown[] = [...scope.bindings];
  if (query.status) {
    where.push('w.status=?');
    bindings.push(query.status);
  }
  const clause = where.join(' AND ');
  const [count] = await rows<CountRow>(`SELECT COUNT(*) total FROM withdrawal_requests w WHERE ${clause}`, bindings);
  const list = await rows<WithdrawalRow>(
    `SELECT w.* FROM withdrawal_requests w WHERE ${clause} ORDER BY w.created_at DESC LIMIT ? OFFSET ?`,
    [...bindings, pageSize, pageOffset(page, pageSize)],
  );
  return {
    list: list.map((item) => ({ ...item, pay_account: maskAccount(item.pay_account) })),
    total: Number(count?.total ?? 0),
    page,
    pageSize,
  };
}

export async function createWithdrawal(
  user: AuthUser,
  input: { amount: number; payMethod: 'alipay' | 'wechat'; payAccount: string },
  ip?: string,
) {
  assertLegacyWithdrawalWritesBlocked();
  return withTransaction(async (connection) => {
    await connection.query('SELECT id FROM users WHERE id=? FOR UPDATE', [user.sub]);
    const [[income]] = await connection.query<AmountRow[]>(
      "SELECT COALESCE(SUM(amount),0) amount FROM earnings WHERE user_id=? AND status='confirmed'",
      [user.sub],
    );
    const [[reserved]] = await connection.query<AmountRow[]>(
      "SELECT COALESCE(SUM(amount),0) amount FROM withdrawal_requests WHERE user_id=? AND status IN ('pending','approved')",
      [user.sub],
    );
    const [[project]] = await connection.query<RowDataPacket[]>(
      "SELECT COALESCE(JSON_EXTRACT(config_json,'$.withdrawalMinAmount')+0,0) minimum FROM projects WHERE slug='zhihu' LIMIT 1",
    );
    const minimum = Number(project?.minimum ?? 0);
    const available = Number(income?.amount ?? 0) - Number(reserved?.amount ?? 0);
    if (input.amount < minimum) throw new AppError(422, 42205, `最低提现金额为 ${minimum} 元`);
    if (input.amount > available) throw new AppError(422, 42206, '可提现余额不足');
    const [result] = await connection.query<ResultSetHeader>(
      "INSERT INTO withdrawal_requests (user_id,amount,pay_method,pay_account,status) VALUES (?,?,?,?,'pending')",
      [user.sub, input.amount, input.payMethod, input.payAccount],
    );
    const id = String(result.insertId);
    await writeAudit(
      {
        userId: user.sub,
        action: 'withdraw.apply',
        resourceType: 'withdrawal',
        resourceId: id,
        detail: { amount: input.amount },
        ip,
      },
      connection,
    );
    return { id, status: 'pending', amount: input.amount };
  });
}

async function handleWithdrawal(
  user: AuthUser,
  id: string,
  status: 'approved' | 'rejected',
  remark: string | null,
  ip?: string,
) {
  assertLegacyWithdrawalWritesBlocked();
  return withTransaction(async (connection) => {
    const [[item]] = await connection.query<WithdrawalRow[]>(
      'SELECT * FROM withdrawal_requests WHERE id=? FOR UPDATE',
      [id],
    );
    if (!item) throw new AppError(404, 40401, '提现申请不存在');
    if (item.status !== 'pending') throw new AppError(409, 40903, '提现申请已处理');
    await connection.query(
      "UPDATE withdrawal_requests SET status=?,remark=?,handled_by=?,handled_at=NOW() WHERE id=? AND status='pending'",
      [status, remark, user.sub, id],
    );
    await writeAudit(
      {
        userId: user.sub,
        action: `withdraw.${status}`,
        resourceType: 'withdrawal',
        resourceId: id,
        detail: { remark },
        ip,
      },
      connection,
    );
    return { id, status };
  });
}
export const approveWithdrawal = (user: AuthUser, id: string, ip?: string) =>
  handleWithdrawal(user, id, 'approved', null, ip);
export const rejectWithdrawal = (user: AuthUser, id: string, remark: string, ip?: string) =>
  handleWithdrawal(user, id, 'rejected', remark, ip);
