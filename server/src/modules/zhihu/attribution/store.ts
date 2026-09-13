import type { PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { withTransaction } from '../../../db';
import { assertDataScope } from '../../../core/accounts';
import type { AuthUser } from '../../../types';
import { writeAudit } from '../../../services/audit.service';
import { digest, fail, type Scope } from './domain';
import { assertEngineWritable } from './routing';

export type RecordRow = RowDataPacket & Record<string, unknown>;
export async function select(c: PoolConnection, sql: string, values: unknown[] = []): Promise<RecordRow[]> {
  const [result] = await c.query<RecordRow[]>(sql, values);
  return result;
}
export async function insert(c: PoolConnection, sql: string, values: unknown[]): Promise<string> {
  const [result] = await c.query<ResultSetHeader>(sql, values);
  return String(result.insertId);
}
export function json<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}
export async function authorize(user: AuthUser, scope: Scope) {
  await assertDataScope(user, scope.projectId, scope.accountId, 'zhihu');
}
export async function scopeLock(c: PoolConnection, scope: Scope, user?: AuthUser) {
  const records = await select(
    c,
    `SELECT a.id FROM integration_accounts a
    JOIN project_integrations pi ON pi.account_id=a.id JOIN projects p ON p.id=pi.project_id
    WHERE a.id=? AND pi.project_id=? AND a.module_id='zhihu' AND a.status='active' AND p.is_enabled=1 FOR SHARE`,
    [scope.accountId, scope.projectId],
  );
  if (!records.length) fail('账号或项目不可用', 403);
  if (user) {
    const [actor] = await select(c, 'SELECT id,role,is_active FROM users WHERE id=? FOR SHARE', [user.sub]);
    if (!actor || !actor.is_active || actor.role !== user.role) fail('用户状态已变化，请重新登录', 403);
    if (user.role !== 'admin') {
      const members = await select(
        c,
        'SELECT user_id FROM project_members WHERE project_id=? AND user_id=? AND left_at IS NULL FOR SHARE',
        [scope.projectId, user.sub],
      );
      if (!members.length) fail('不是有效项目成员', 403);
    }
  }
}
export async function audit(
  c: PoolConnection,
  user: AuthUser,
  action: string,
  id: string,
  detail?: Record<string, unknown>,
) {
  await writeAudit(
    { userId: user.sub, action: `zhihu.${action}`, resourceType: 'zh_attribution', resourceId: id, detail },
    c,
  );
}
export async function mutate<T>(
  user: AuthUser,
  scope: Scope,
  operation: string,
  key: string,
  input: unknown,
  work: (c: PoolConnection) => Promise<T>,
): Promise<T> {
  await authorize(user, scope);
  if (!/^[\w.-]{8,128}$/.test(key)) fail('请提供有效的 Idempotency-Key');
  return withTransaction(async (c) => {
    await scopeLock(c, scope, user);
    await assertEngineWritable(c, scope);
    const hash = digest([scope, input]);
    await c.query(
      `INSERT INTO zh_idempotency_requests(account_id,actor_id,operation,request_key,request_hash)
      VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`,
      [scope.accountId, user.sub, operation, key, hash],
    );
    const [receipt] = await select(
      c,
      'SELECT * FROM zh_idempotency_requests WHERE account_id=? AND actor_id=? AND operation=? AND request_key=? FOR UPDATE',
      [scope.accountId, user.sub, operation, key],
    );
    if (receipt.request_hash !== hash) fail('同一幂等键不能提交不同内容', 409);
    if (receipt.response_json !== null) return json<T>(receipt.response_json);
    const result = await work(c);
    await c.query('UPDATE zh_idempotency_requests SET response_json=? WHERE id=?', [
      JSON.stringify(result),
      receipt.id,
    ]);
    return result;
  });
}
export async function keywordLock(c: PoolConnection, scope: Scope, id: string) {
  const [word] = await select(
    c,
    'SELECT *, DATE_FORMAT(priority_until,"%Y-%m-%d %H:%i:%s") AS priority_text FROM zh_keywords WHERE id=? AND account_id=? AND project_id=? FOR UPDATE',
    [id, scope.accountId, scope.projectId],
  );
  if (!word) fail('关键词不存在', 404);
  return word;
}
export async function bindingLock(c: PoolConnection, scope: Scope, id: string) {
  const [ref] = await select(c, 'SELECT keyword_id FROM zh_keyword_bindings WHERE id=?', [id]);
  if (!ref) fail('绑定不存在', 404);
  const word = await keywordLock(c, scope, String(ref.keyword_id));
  const [binding] = await select(
    c,
    'SELECT *,DATE_FORMAT(activated_on,"%Y-%m-%d") AS activated_day FROM zh_keyword_bindings WHERE id=? FOR UPDATE',
    [id],
  );
  return { word, binding };
}
export function ownBinding(user: AuthUser, binding: RecordRow) {
  if (user.role !== 'admin' && String(binding.leader_id) !== user.sub && String(binding.executor_id) !== user.sub)
    fail('无权操作此绑定', 403);
}
