import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { rows, withTransaction } from '../db';
import { AppError } from '../middleware/errors';
import { AuthUser } from '../types';
import { pageOffset } from '../utils/pagination';
import { writeAudit } from './audit.service';

/* ===== 类型 ===== */

interface WithdrawalRow extends RowDataPacket {
  id: string;
  user_id: string;
  amount: string;
  status: string;
  pay_account: string;
}

interface AppealRow extends RowDataPacket {
  id: string;
  user_id: string;
  status: string;
}

/** 高危标记（自动风控红线：高频提现 / 新账号大额 / 零数据大额） */
export const RISK_FLAGS = {
  high_freq: '高频提现',
  new_account_large: '新账号大额',
  zero_data_large: '零数据大额',
} as const;

/* ===== 提现申请（成员提交，自动风控标记；团长申请跳过初审直达终审）===== */

export async function applyWithdrawal(
  user: AuthUser,
  input: { amount: number; payMethod: 'alipay' | 'wechat'; payAccount: string },
  ip?: string,
) {
  return withTransaction(async (connection) => {
    await connection.query('SELECT id FROM users WHERE id=? FOR UPDATE', [user.sub]);

    // 余额校验（已确认收益 - 待审/已批提现）
    const [[income]] = await connection.query<RowDataPacket[]>(
      "SELECT COALESCE(SUM(amount),0) AS v FROM earnings WHERE user_id=? AND status='confirmed'",
      [user.sub],
    );
    const [[reserved]] = await connection.query<RowDataPacket[]>(
      "SELECT COALESCE(SUM(amount),0) AS v FROM withdrawal_requests WHERE user_id=? AND status IN ('pending','leader_approved','approved')",
      [user.sub],
    );
    const available = Number(income?.v ?? 0) - Number(reserved?.v ?? 0);
    if (input.amount > available) throw new AppError(422, 42206, '可提现余额不足');

    // 风控红线
    const flags: string[] = [];
    const [[freq]] = await connection.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM withdrawal_requests WHERE user_id=? AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)",
      [user.sub],
    );
    if (Number(freq?.n ?? 0) >= 2) flags.push('high_freq');
    const [[account]] = await connection.query<RowDataPacket[]>(
      'SELECT created_at FROM users WHERE id=?',
      [user.sub],
    );
    const ageMs = Date.now() - new Date(String(account?.created_at ?? 0)).getTime();
    if (ageMs < 30 * 86400000 && input.amount >= 100000) flags.push('new_account_large');
    const [[history]] = await connection.query<RowDataPacket[]>(
      "SELECT COALESCE(SUM(amount),0) AS v FROM earnings WHERE user_id=? AND status='confirmed' AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)",
      [user.sub],
    );
    if (Number(history?.v ?? 0) < 50000 && input.amount >= 100000) flags.push('zero_data_large');

    // 团长自身提现（团队分成）无需初审，直接进入管理员终审
    const initialStatus = user.role === 'leader' ? 'leader_approved' : 'pending';

    const [result] = await connection.query<ResultSetHeader>(
      'INSERT INTO withdrawal_requests (user_id, amount, pay_method, pay_account, status, risk_flags) VALUES (?,?,?,?,?,?)',
      [user.sub, input.amount, input.payMethod, input.payAccount, initialStatus, flags.length ? JSON.stringify(flags) : null],
    );
    await writeAudit(
      {
        userId: user.sub,
        action: 'withdraw.apply',
        resourceType: 'withdrawal',
        resourceId: String(result.insertId),
        detail: { amount: input.amount, payMethod: input.payMethod, riskFlags: flags, initialStatus },
        ip,
      },
      connection,
    );
    return { id: String(result.insertId), status: initialStatus, riskFlags: flags };
  });
}

/* ===== 成员撤销（团长初审前可自主撤销）===== */

export async function cancelWithdrawal(user: AuthUser, id: string, ip?: string) {
  await withTransaction(async (connection) => {
    const [[item]] = await connection.query<WithdrawalRow[]>(
      "SELECT * FROM withdrawal_requests WHERE id=? AND user_id=? AND status='pending' FOR UPDATE",
      [id, user.sub],
    );
    if (!item) throw new AppError(409, 40903, '只有待初审的申请可以撤销');
    await connection.query("UPDATE withdrawal_requests SET status='cancelled' WHERE id=?", [id]);
    await writeAudit(
      { userId: user.sub, action: 'withdraw.cancel', resourceType: 'withdrawal', resourceId: id, ip },
      connection,
    );
  });
}

/* ===== 团长初审（48h 内审核本团队成员申请）===== */

export async function reviewWithdrawal(user: AuthUser, id: string, action: 'approve' | 'reject', remark: string | null, ip?: string) {
  await withTransaction(async (connection) => {
    const [[item]] = await connection.query<(WithdrawalRow & { applicant_parent: string | null })[]>(
      `SELECT w.*, u.parent_id AS applicant_parent FROM withdrawal_requests w JOIN users u ON u.id = w.user_id
       WHERE w.id=? AND w.status='pending' FOR UPDATE`,
      [id],
    );
    if (!item) throw new AppError(409, 40903, '该申请不在待初审状态');
    if (String(item.applicant_parent) !== user.sub) throw new AppError(403, 40301, '只能初审本团队成员的申请');

    const next = action === 'approve' ? 'leader_approved' : 'rejected';
    await connection.query(
      'UPDATE withdrawal_requests SET status=?, leader_id=?, leader_remark=?, leader_handled_at=NOW() WHERE id=?',
      [next, user.sub, remark, id],
    );
    await writeAudit(
      {
        userId: user.sub,
        action: `withdraw.review_${action}`,
        resourceType: 'withdrawal',
        resourceId: id,
        detail: { remark },
        ip,
      },
      connection,
    );
  });
}

/* ===== 管理员终审 + 放款 ===== */

export async function decideWithdrawal(user: AuthUser, id: string, action: 'approve' | 'reject', remark: string | null, ip?: string) {
  await withTransaction(async (connection) => {
    const [[item]] = await connection.query<WithdrawalRow[]>(
      "SELECT * FROM withdrawal_requests WHERE id=? AND status='leader_approved' FOR UPDATE",
      [id],
    );
    if (!item) throw new AppError(409, 40903, '只有初审通过的申请可以终审');
    const next = action === 'approve' ? 'approved' : 'rejected';
    await connection.query(
      'UPDATE withdrawal_requests SET status=?, remark=?, handled_by=?, handled_at=NOW() WHERE id=?',
      [next, remark, user.sub, id],
    );
    await writeAudit(
      {
        userId: user.sub,
        action: `withdraw.final_${action}`,
        resourceType: 'withdrawal',
        resourceId: id,
        detail: { remark },
        ip,
      },
      connection,
    );
  });
}

/* ===== 角色分流列表 ===== */

export async function listWithdrawals(user: AuthUser, query: Record<string, unknown>) {
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 20);
  const where: string[] = ['1=1'];
  const bindings: unknown[] = [];
  if (user.role === 'creator') {
    where.push('w.user_id = ?');
    bindings.push(user.sub);
  } else if (user.role === 'leader') {
    // 团长：自己的 + 本团队成员的
    where.push('(w.user_id = ? OR u.parent_id = ?)');
    bindings.push(user.sub, user.sub);
  }
  if (query.status) {
    where.push('w.status = ?');
    bindings.push(query.status);
  }
  const clause = where.join(' AND ');
  const [count] = await rows<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) total FROM withdrawal_requests w JOIN users u ON u.id = w.user_id WHERE ${clause}`,
    bindings,
  );
  const list = await rows(
    `SELECT w.*, u.username AS applicant_username, u.display_name AS applicant_name, lu.display_name AS leader_name
     FROM withdrawal_requests w
     JOIN users u ON u.id = w.user_id
     LEFT JOIN users lu ON lu.id = w.leader_id
     WHERE ${clause} ORDER BY w.created_at DESC LIMIT ? OFFSET ?`,
    [...bindings, pageSize, pageOffset(page, pageSize)],
  );
  return { list, total: Number(count?.total ?? 0), page, pageSize };
}

/* ===== 财务申诉 ===== */

export async function submitAppeal(
  user: AuthUser,
  input: { kind: string; title: string; content: string; evidence?: string | null },
  ip?: string,
) {
  return withTransaction(async (connection) => {
    const [result] = await connection.query<ResultSetHeader>(
      'INSERT INTO finance_appeals (user_id, kind, title, content, evidence) VALUES (?,?,?,?,?)',
      [user.sub, input.kind, input.title, input.content, input.evidence ?? null],
    );
    await writeAudit(
      { userId: user.sub, action: 'appeal.submit', resourceType: 'finance_appeal', resourceId: String(result.insertId), detail: { kind: input.kind, title: input.title }, ip },
      connection,
    );
    return { id: String(result.insertId) };
  });
}

export async function cancelAppeal(user: AuthUser, id: string, ip?: string) {
  await withTransaction(async (connection) => {
    const [[item]] = await connection.query<AppealRow[]>(
      "SELECT * FROM finance_appeals WHERE id=? AND user_id=? AND status='pending' FOR UPDATE",
      [id, user.sub],
    );
    if (!item) throw new AppError(409, 40903, '只有待初审的申诉可以撤销');
    await connection.query("UPDATE finance_appeals SET status='cancelled' WHERE id=?", [id]);
    await writeAudit(
      { userId: user.sub, action: 'appeal.cancel', resourceType: 'finance_appeal', resourceId: id, ip },
      connection,
    );
  });
}

export async function reviewAppeal(user: AuthUser, id: string, action: 'approve' | 'reject', remark: string | null, ip?: string) {
  await withTransaction(async (connection) => {
    const [[item]] = await connection.query<(AppealRow & { applicant_parent: string | null })[]>(
      `SELECT a.*, u.parent_id AS applicant_parent FROM finance_appeals a JOIN users u ON u.id = a.user_id
       WHERE a.id=? AND a.status='pending' FOR UPDATE`,
      [id],
    );
    if (!item) throw new AppError(409, 40903, '该申诉不在待初审状态');
    if (String(item.applicant_parent) !== user.sub) throw new AppError(403, 40301, '只能初审本团队成员的申诉');
    const next = action === 'approve' ? 'leader_approved' : 'rejected';
    await connection.query(
      'UPDATE finance_appeals SET status=?, leader_id=?, leader_remark=?, leader_handled_at=NOW() WHERE id=?',
      [next, user.sub, remark, id],
    );
    await writeAudit(
      { userId: user.sub, action: `appeal.review_${action}`, resourceType: 'finance_appeal', resourceId: id, detail: { remark }, ip },
      connection,
    );
  });
}

/** 管理员终审：可附带调账金额（正=补发，负=扣款），通过后写入收益 */
export async function decideAppeal(
  user: AuthUser,
  id: string,
  action: 'approve' | 'reject',
  remark: string | null,
  adjustAmount: number | null,
  ip?: string,
) {
  await withTransaction(async (connection) => {
    const [[item]] = await connection.query<(AppealRow & { kind: string })[]>(
      "SELECT * FROM finance_appeals WHERE id=? AND status='leader_approved' FOR UPDATE",
      [id],
    );
    if (!item) throw new AppError(409, 40903, '只有初审通过的申诉可以终审');
    const next = action === 'approve' ? 'approved' : 'rejected';
    await connection.query(
      'UPDATE finance_appeals SET status=?, remark=?, handled_by=?, handled_at=NOW(), adjust_amount=? WHERE id=?',
      [next, remark, user.sub, action === 'approve' ? adjustAmount : null, id],
    );

    // 通过且指定调账金额 → 写入收益行（confirmed，可正可负）
    if (action === 'approve' && adjustAmount !== null && adjustAmount !== 0) {
      const [[project]] = await connection.query<RowDataPacket[]>(
        "SELECT id FROM projects WHERE slug='zhihu' LIMIT 1",
      );
      if (!project) throw new AppError(500, 50000, '缺少 zhihu 项目，无法调账');
      await connection.query(
        `INSERT INTO earnings (user_id, project_id, plan_id, settle_date, amount, status, source_ref)
         VALUES (?, ?, NULL, CURDATE(), ?, 'confirmed', ?)`,
        [item.user_id, String(project.id), adjustAmount, `appeal:${id}`],
      );
    }
    await writeAudit(
      {
        userId: user.sub,
        action: `appeal.final_${action}`,
        resourceType: 'finance_appeal',
        resourceId: id,
        detail: { remark, adjustAmount },
        ip,
      },
      connection,
    );
  });
}

export async function listAppeals(user: AuthUser, query: Record<string, unknown>) {
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 20);
  const where: string[] = ['1=1'];
  const bindings: unknown[] = [];
  if (user.role === 'creator') {
    where.push('a.user_id = ?');
    bindings.push(user.sub);
  } else if (user.role === 'leader') {
    where.push('(a.user_id = ? OR u.parent_id = ?)');
    bindings.push(user.sub, user.sub);
  }
  if (query.status) {
    where.push('a.status = ?');
    bindings.push(query.status);
  }
  const clause = where.join(' AND ');
  const [count] = await rows<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) total FROM finance_appeals a JOIN users u ON u.id = a.user_id WHERE ${clause}`,
    bindings,
  );
  const list = await rows(
    `SELECT a.*, u.username AS applicant_username, u.display_name AS applicant_name, lu.display_name AS leader_name
     FROM finance_appeals a
     JOIN users u ON u.id = a.user_id
     LEFT JOIN users lu ON lu.id = a.leader_id
     WHERE ${clause} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    [...bindings, pageSize, pageOffset(page, pageSize)],
  );
  return { list, total: Number(count?.total ?? 0), page, pageSize };
}
