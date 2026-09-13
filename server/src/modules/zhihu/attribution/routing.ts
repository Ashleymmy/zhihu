import type { PoolConnection } from 'mysql2/promise';
import { fail, type Scope } from './domain';
import { select } from './store';
export async function gate(c: PoolConnection, exclusive = false) {
  const installed = await select(
    c,
    "SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='zh_engine_gate'",
  );
  if (installed.length)
    await select(c, `SELECT id FROM zh_engine_gate WHERE id=1 ${exclusive ? 'FOR UPDATE' : 'FOR SHARE'}`);
  return installed.length > 0;
}
export async function assertNewRoute(c: PoolConnection, scope: Scope, date: string, confirm = false) {
  await gate(c);
  const [r] = await select(
    c,
    "SELECT mode,DATE_FORMAT(exclusive_from,'%Y-%m-%d') start FROM zh_engine_routes WHERE account_id=? AND project_id=?",
    [scope.accountId, scope.projectId],
  );
  if (!r || date < String(r.start)) fail('该业务日期属于旧引擎，或尚未配置切换边界', 409);
  if (r.mode === 'stopped') fail('新引擎已停止写入', 409);
  if (confirm && r.mode !== 'enabled') fail('试算模式尚未启用对账确认', 409);
}
export async function legacyAllowed(c: PoolConnection, projectId: string | null, date: string | null) {
  if (!(await gate(c))) return true;
  const rows = await select(
    c,
    `SELECT id FROM zh_engine_routes WHERE (? IS NULL OR project_id=?) AND (? IS NULL OR exclusive_from<=?) LIMIT 1`,
    [projectId, projectId, date, date],
  );
  return rows.length === 0;
}
export async function assertLegacyRoute(c: PoolConnection, projectId: string | null, date: string | null) {
  if (!(await legacyAllowed(c, projectId, date))) fail('来源属于新引擎周期或无法证明旧来源范围，禁止旧流程确认', 409);
}
export async function assertEngineWritable(c: PoolConnection, scope: Scope) {
  if (!(await gate(c))) return;
  const stopped = await select(
    c,
    "SELECT id FROM zh_engine_routes WHERE account_id=? AND project_id=? AND mode='stopped'",
    [scope.accountId, scope.projectId],
  );
  if (stopped.length) fail('新引擎已停止写入', 409);
}
