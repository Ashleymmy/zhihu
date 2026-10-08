import { isStaffRole } from '../../../auth/roles';
import type { PoolConnection } from 'mysql2/promise';
import type { AuthUser } from '../../../types';
import { withTransaction } from '../../../db';
import { day, fail, type Scope } from './domain';
import { audit, authorize, insert, scopeLock, select } from './store';
import { gate } from './routing';
export async function configureRoute(
  user: AuthUser,
  scope: Scope,
  input: { from: string; mode: 'trial' | 'enabled' | 'stopped'; reason: string; sampleVerified: boolean },
) {
  if (!['developer','admin'].includes(user.role)) fail('仅管理员可配置引擎边界', 403);
  await authorize(user, scope);
  day(input.from);
  return withTransaction(async (c) => {
    await gate(c, true);
    await scopeLock(c, scope, user);
    const [old] = await select(
      c,
      "SELECT *,DATE_FORMAT(exclusive_from,'%Y-%m-%d') start FROM zh_engine_routes WHERE account_id=? AND project_id=? FOR UPDATE",
      [scope.accountId, scope.projectId],
    );
    if (old && String(old.start) !== input.from) fail('已登记的日期边界不可移动；回退请停止新引擎', 409);
    if (!old) {
      if (input.mode !== 'trial') fail('首次配置必须先进入试算');
      const oldSources = await select(c, `SELECT id FROM earnings WHERE project_id=? AND settle_date>=? LIMIT 1`, [
        scope.projectId,
        input.from,
      ]);
      const oldImports = await select(
        c,
        "SELECT r.id FROM data_import_rows r JOIN data_import_batches b ON b.id=r.batch_id WHERE b.status='confirmed' AND r.validation_status='valid' AND (r.occurred_at IS NULL OR DATE(r.occurred_at)>=?) LIMIT 1",
        [input.from],
      );
      const oldMetrics = await select(c, 'SELECT id FROM daily_metrics WHERE project_id=? AND stat_date>=? LIMIT 1', [
        scope.projectId,
        input.from,
      ]);
      if (oldSources.length || oldImports.length || oldMetrics.length)
        fail('边界后已有旧来源或历史账，请选择未处理的业务周期', 409);
    }
    if (input.mode === 'enabled' && !input.sampleVerified) fail('启用确认前须完成真实样本口径核对');
    const id = old
      ? String(old.id)
      : await insert(
          c,
          'INSERT INTO zh_engine_routes(account_id,project_id,exclusive_from,mode,reason,updated_by) VALUES(?,?,?,?,?,?)',
          [scope.accountId, scope.projectId, input.from, 'trial', input.reason, user.sub],
        );
    await c.query('UPDATE zh_engine_routes SET mode=?,reason=?,sample_verified=?,updated_by=? WHERE id=?', [
      input.mode,
      input.reason,
      input.sampleVerified,
      user.sub,
      id,
    ]);
    await audit(c, user, 'engine.configure', id, { ...input, previous: old?.mode ?? null });
    return { id };
  });
}
export async function getRoute(user: AuthUser, scope: Scope) {
  await authorize(user, scope);
  return withTransaction(async (c) => {
    const [r] = await select(
      c,
      "SELECT CAST(id AS CHAR) id,DATE_FORMAT(exclusive_from,'%Y-%m-%d') exclusive_from,mode,reason,sample_verified FROM zh_engine_routes WHERE account_id=? AND project_id=?",
      [scope.accountId, scope.projectId],
    );
    return r ?? null;
  });
}
export async function extendRouteIfClean(c: PoolConnection, scope: Scope, earliestDate: string, user: AuthUser) {
  day(earliestDate);
  await gate(c, true);
  await scopeLock(c, scope, user);
  const [old] = await select(c, "SELECT id,DATE_FORMAT(exclusive_from,'%Y-%m-%d') start,mode FROM zh_engine_routes WHERE account_id=? AND project_id=? FOR UPDATE", [scope.accountId, scope.projectId]);
  if (old?.mode === 'stopped') fail('业务已暂停，运营：恢复项目后再上传报表', 409);
  if (!old) {
    // Keep the original first-cutover guard: old money must never be counted again.
    const sources = await select(c, 'SELECT id FROM earnings WHERE project_id=? AND settle_date>=? LIMIT 1', [scope.projectId, earliestDate]);
    const metrics = await select(c, 'SELECT id FROM daily_metrics WHERE project_id=? AND stat_date>=? LIMIT 1', [scope.projectId, earliestDate]);
    const imports = await select(c, "SELECT r.id FROM data_import_rows r JOIN data_import_batches b ON b.id=r.batch_id WHERE b.status='confirmed' AND r.validation_status='valid' AND (r.occurred_at IS NULL OR DATE(r.occurred_at)>=?) LIMIT 1", [earliestDate]);
    if (sources.length || metrics.length || imports.length) fail('这段日期已有旧系统数据，运营：核对已结算日期后设置项目开始日期', 409);
    const id = await insert(c, 'INSERT INTO zh_engine_routes(account_id,project_id,exclusive_from,mode,reason,updated_by) VALUES(?,?,?,\'trial\',?,?)', [scope.accountId, scope.projectId, earliestDate, '首次上传后自动计算，等待财务核对金额', user.sub]);
    await audit(c, user, 'engine.configure', id, { from: earliestDate, mode: 'trial', automatic: true });
    return earliestDate;
  }
  if (earliestDate >= String(old.start)) return String(old.start);
  const sources = await select(c, 'SELECT id FROM earnings WHERE project_id=? AND settle_date>=? AND settle_date<? LIMIT 1', [scope.projectId, earliestDate, old.start]);
  const metrics = await select(c, 'SELECT id FROM daily_metrics WHERE project_id=? AND stat_date>=? AND stat_date<? LIMIT 1', [scope.projectId, earliestDate, old.start]);
  const imports = await select(c, "SELECT r.id FROM data_import_rows r JOIN data_import_batches b ON b.id=r.batch_id WHERE b.status='confirmed' AND r.validation_status='valid' AND (r.occurred_at IS NULL OR (DATE(r.occurred_at)>=? AND DATE(r.occurred_at)<?)) LIMIT 1", [earliestDate, old.start]);
  if (sources.length || metrics.length || imports.length) return String(old.start);
  await c.query('UPDATE zh_engine_routes SET exclusive_from=?,updated_by=? WHERE id=?', [earliestDate, user.sub, old.id]);
  await audit(c, user, 'engine.extend-earlier', String(old.id), { previous: old.start, from: earliestDate });
  return earliestDate;
}
export async function legacyInventory(user: AuthUser, scope: Scope, page: number, pageSize: number) {
  if (!isStaffRole(user.role)) fail('历史盘点仅管理员可见', 403);
  await authorize(user, scope);
  return withTransaction(async (c) => {
    const list = await select(
      c,
      `SELECT CAST(p.id AS CHAR) plan_id,p.keyword,p.status,CAST(p.owner_id AS CHAR) owner_id,
      (SELECT COUNT(*) FROM plans x WHERE BINARY x.keyword=BINARY p.keyword) shared_count,
      (SELECT COUNT(*) FROM daily_metrics m WHERE m.plan_id=p.id) source_days,
      CAST(k.id AS CHAR) exclusive_keyword_id
      FROM plans p LEFT JOIN zh_keywords k ON k.plan_id=p.id WHERE p.project_id=? ORDER BY p.id LIMIT ? OFFSET ?`,
      [scope.projectId, pageSize, (page - 1) * pageSize],
    );
    const [total] = await select(c, 'SELECT COUNT(*) total FROM plans WHERE project_id=?', [scope.projectId]);
    return {
      list,
      total: Number(total.total),
      page,
      pageSize,
      policy: '历史词保留旧归属；共词与无来源不迁入新绑定，使用新词进入新周期。',
    };
  });
}
