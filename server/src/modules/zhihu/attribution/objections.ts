import type { PoolConnection } from 'mysql2/promise';
import type { AuthUser } from '../../../types';
import { withTransaction } from '../../../db';
import { assertDuty } from '../../../core/duties';
import { projectEarnings } from './earning-lines';
import { audit, authorize, insert, mutate, select } from './store';
import { fail, type Scope } from './domain';

export async function assertNoObjection(c: PoolConnection, scope: Scope, factId: string) {
  const rows = await select(
    c,
    "SELECT id FROM zh_member_objections WHERE account_id=? AND project_id=? AND fact_id=? AND status='open' LIMIT 1",
    [scope.accountId, scope.projectId, factId],
  );
  if (rows.length) fail('成员金额异议待回复，请处理后重新核对', 409);
}

export async function raiseObjection(
  user: AuthUser,
  scope: Scope,
  key: string,
  input: { factId?: string; earningLineId?: string; detail: string },
) {
  if (!['creator', 'leader'].includes(user.role)) fail('请使用成员账号提出金额异议', 403);
  const detail = input.detail.trim();
  if (!detail || detail.length > 1000 || !!input.factId === !!input.earningLineId) fail('请选择一条收益并填写问题');
  return mutate(user, scope, 'objection.raise', key, { ...input, detail }, async (c) => {
    const rows = await select(
      c,
      `SELECT s.source_key FROM opc_earning_lines l JOIN opc_earning_sources s ON s.id=l.source_id
      WHERE s.module_id='zhihu' AND s.project_id=? AND s.account_id=? AND l.payee_id=?
      AND l.source_version=s.current_version AND ${input.earningLineId ? 'l.id=?' : 's.source_key=?'} LIMIT 1`,
      [scope.projectId, scope.accountId, user.sub, input.earningLineId ?? 'fact:' + input.factId],
    );
    if (!rows.length || !/^fact:\d+$/.test(String(rows[0].source_key))) fail('只能对本人的收益提出异议', 403);
    const factId = String(rows[0].source_key).slice(5);
    const [fact] = await select(
      c,
      'SELECT id FROM zh_metric_facts WHERE id=? AND project_id=? AND account_id=? FOR UPDATE',
      [factId, scope.projectId, scope.accountId],
    );
    if (!fact) fail('收益来源不可查看', 403);
    if (
      (
        await select(c, "SELECT id FROM zh_member_objections WHERE fact_id=? AND payee_id=? AND status='open'", [
          factId,
          user.sub,
        ])
      ).length
    )
      fail('这条收益已有待回复的问题，请查看处理进度', 409);
    const id = await insert(
      c,
      'INSERT INTO zh_member_objections(account_id,project_id,fact_id,payee_id,raised_by,detail) VALUES(?,?,?,?,?,?)',
      [scope.accountId, scope.projectId, factId, user.sub, user.sub, detail],
    );
    await projectEarnings(c, scope, factId);
    await audit(c, user, 'objection.raise', id, { factId });
    return { id };
  });
}

export async function replyObjection(user: AuthUser, scope: Scope, id: string, key: string, reply: string) {
  assertDuty(user, 'finance');
  reply = reply.trim();
  if (!reply || reply.length > 1000) fail('请填写处理回复');
  return mutate(user, scope, 'objection.reply', key, { id, reply }, async (c) => {
    const [row] = await select(
      c,
      'SELECT id,status,CAST(fact_id AS CHAR) fact_id FROM zh_member_objections WHERE id=? AND project_id=? AND account_id=? FOR UPDATE',
      [id, scope.projectId, scope.accountId],
    );
    if (!row) fail('异议记录不存在', 404);
    if (row.status !== 'open') fail('该问题已回复，请刷新查看', 409);
    await c.query(
      "UPDATE zh_member_objections SET status='replied',reply=?,replied_by=?,replied_at=NOW(3) WHERE id=?",
      [reply, user.sub, id],
    );
    await projectEarnings(c, scope, String(row.fact_id));
    await audit(c, user, 'objection.reply', id);
    return { id };
  });
}

export async function listObjections(
  user: AuthUser,
  scope: Scope,
  input: { page: number; pageSize: number; status?: string },
  mine: boolean,
) {
  if (mine) {
    if (!['leader', 'creator'].includes(user.role)) fail('请使用成员账号查看本人异议', 403);
  } else assertDuty(user, 'finance');
  await authorize(user, scope);
  return withTransaction(async (c) => {
    const where = `o.project_id=? AND o.account_id=? ${mine ? 'AND o.raised_by=?' : ''} ${input.status ? 'AND o.status=?' : ''}`;
    const args = [
      scope.projectId,
      scope.accountId,
      ...(mine ? [user.sub] : []),
      ...(input.status ? [input.status] : []),
    ];
    const [count] = await select(c, `SELECT COUNT(*) total FROM zh_member_objections o WHERE ${where}`, args);
    const list = await select(
      c,
      `SELECT CAST(o.id AS CHAR) id,CAST(o.fact_id AS CHAR) fact_id,CAST(o.payee_id AS CHAR) payee_id,u.display_name,
      k.keyword,DATE_FORMAT(f.business_date,'%Y-%m-%d') business_date,f.metric_type,o.detail,o.status,o.reply,o.created_at,o.replied_at
      FROM zh_member_objections o JOIN zh_metric_facts f ON f.id=o.fact_id JOIN zh_keywords k ON k.id=f.keyword_id JOIN users u ON u.id=o.payee_id
      WHERE ${where} ORDER BY o.id DESC LIMIT ? OFFSET ?`,
      [...args, input.pageSize, (input.page - 1) * input.pageSize],
    );
    return { list, total: Number(count.total), page: input.page, pageSize: input.pageSize };
  });
}
