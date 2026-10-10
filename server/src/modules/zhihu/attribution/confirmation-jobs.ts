import type { PoolConnection } from 'mysql2/promise';
import type { AuthUser } from '../../../types';
import { withTransaction, db } from '../../../db';
import { config } from '../../../config';
import { assertDuty } from '../../../core/duties';
import { isRole } from '../../../auth/roles';
import { confirmEarningSource } from '../../../core/earnings';
import { audit, authorize, insert, json, mutate, scopeLock, select } from './store';
import { assertEngineWritable } from './routing';
import { fail, type Scope } from './domain';
import { overview, type Period } from './workbench';
import { confirmFinancialFact } from './statements';
import { projectEarnings } from './earning-lines';

export const CONFIRM_CHUNK = 100;
type Progress = {
  jobId: string | null;
  status: 'done' | 'pending' | 'failed';
  confirmed: number;
  waiting: number;
  total: number;
  remaining: number;
  skipped: number;
  error: string | null;
};
async function progress(c: PoolConnection, scope: Scope, id: string): Promise<Progress> {
  const [j] = await select(c, 'SELECT * FROM zh_confirmation_jobs WHERE id=? AND account_id=? AND project_id=?', [
    id,
    scope.accountId,
    scope.projectId,
  ]);
  if (!j) fail('账单处理记录不存在', 404);
  return {
    jobId: id,
    status: j.status as Progress['status'],
    confirmed: Number(j.confirmed),
    waiting: Number(j.waiting) + Number(j.skipped),
    total: Number(j.total),
    remaining: Number(j.total) - Number(j.confirmed) - Number(j.skipped),
    skipped: Number(j.skipped),
    error: j.last_error ? String(j.last_error) : null,
  };
}
async function chunk(c: PoolConnection, user: AuthUser, scope: Scope, id: string) {
  const [job] = await select(
    c,
    'SELECT * FROM zh_confirmation_jobs WHERE id=? AND account_id=? AND project_id=? FOR UPDATE',
    [id, scope.accountId, scope.projectId],
  );
  if (!job) fail('账单处理记录不存在', 404);
  if (job.status !== 'pending') return progress(c, scope, id);
  const [actor] = await select(c, 'SELECT role,admin_duty,is_active FROM users WHERE id=? FOR SHARE', [user.sub]);
  if (!actor || !actor.is_active || actor.role !== user.role) fail('经办人状态已变化，请由财务重新接手', 403);
  assertDuty({ ...user, adminDuty: actor.admin_duty as AuthUser['adminDuty'] }, 'finance');
  const items = await select(
    c,
    "SELECT CAST(fact_id AS CHAR) fact_id,review_token FROM zh_confirmation_items item WHERE job_id=? AND status='pending' ORDER BY item.fact_id LIMIT ? FOR UPDATE",
    [id, CONFIRM_CHUNK],
  );
  const view = items.length
    ? await overview(
        user,
        scope,
        json<Period>(job.period_json),
        c,
        items.map((i) => String(i.fact_id)),
      )
    : null;
  let confirmed = 0,
    skipped = 0;
  for (const item of items) {
    const entry = view!.entries.find((e) => e.factId === String(item.fact_id) && e.ready);
    if (!entry || entry.confirmationToken !== item.review_token) {
      await c.query(
        "UPDATE zh_confirmation_items SET status='skipped',reason='数据或处理状态已变化，请重新核对' WHERE job_id=? AND fact_id=?",
        [id, item.fact_id],
      );
      skipped++;
      continue;
    }
    const [route] = await select(
      c,
      'SELECT id,mode FROM zh_engine_routes WHERE account_id=? AND project_id=? FOR UPDATE',
      [scope.accountId, scope.projectId],
    );
    if (!route || route.mode === 'stopped') fail('业务已暂停，请恢复后重试', 409);
    if (route.mode === 'trial') {
      await c.query("UPDATE zh_engine_routes SET mode='enabled',sample_verified=1,reason=?,updated_by=? WHERE id=?", [
        '财务核对并确认账单',
        user.sub,
        route.id,
      ]);
      await audit(c, user, 'engine.finance-review', String(route.id), { jobId: id });
    }
    await confirmFinancialFact(c, user, scope, entry.factId, entry.resultId, entry.revisionId);
    await projectEarnings(c, scope, entry.factId);
    await confirmEarningSource(c, user, { ...scope, moduleId: 'zhihu' }, 'fact:' + entry.factId, entry.resultId);
    await c.query("UPDATE zh_confirmation_items SET status='confirmed' WHERE job_id=? AND fact_id=?", [
      id,
      item.fact_id,
    ]);
    confirmed++;
  }
  await c.query('UPDATE zh_confirmation_jobs SET confirmed=confirmed+?,skipped=skipped+?,last_error=NULL WHERE id=?', [
    confirmed,
    skipped,
    id,
  ]);
  await c.query("UPDATE zh_confirmation_jobs SET status=IF(confirmed+skipped=total,'done','pending') WHERE id=?", [id]);
  if (confirmed || skipped) await audit(c, user, 'workbench.confirm', id, { confirmed, skipped });
  return progress(c, scope, id);
}
export async function startConfirmation(
  user: AuthUser,
  scope: Scope,
  period: Period,
  key: string,
  reviewHash: string,
): Promise<Progress> {
  assertDuty(user, 'finance');
  period = { from: period.from, to: period.to, ...(period.metricType ? { metricType: period.metricType } : {}) };
  return mutate(user, scope, 'workbench.confirm', key, { period, reviewHash }, async (c) => {
    const view = await overview(user, scope, period, c);
    if (view.reviewHash !== reviewHash) fail('数据或审核状态已更新，请刷新后重新核对', 409);
    const ready = [...new Map(view.entries.filter((e) => e.ready).map((e) => [e.factId, e])).values()];
    const waiting = new Set(
      view.entries
        .filter((e) => !e.internal && !['confirmed', 'excluded'].includes(e.status) && !e.ready)
        .map((e) => e.factId || e.id),
    ).size;
    if (!ready.length)
      return { jobId: null, status: 'done', confirmed: 0, waiting, total: 0, remaining: 0, skipped: 0, error: null };
    const id = await insert(
      c,
      'INSERT INTO zh_confirmation_jobs(account_id,project_id,actor_id,period_json,total,waiting) VALUES(?,?,?,?,?,?)',
      [scope.accountId, scope.projectId, user.sub, JSON.stringify(period), ready.length, waiting],
    );
    for (let offset = 0; offset < ready.length; offset += 500) {
      await c.query('INSERT INTO zh_confirmation_items(job_id,fact_id,review_token) VALUES ?', [
        ready.slice(offset, offset + 500).map((e) => [id, e.factId, e.confirmationToken]),
      ]);
    }
    return chunk(c, user, scope, id);
  });
}
export async function confirmationStatus(user: AuthUser, scope: Scope, id: string) {
  assertDuty(user, 'finance');
  await authorize(user, scope);
  return withTransaction((c) => progress(c, scope, id));
}
export async function retryConfirmation(user: AuthUser, scope: Scope, id: string, key: string) {
  assertDuty(user, 'finance');
  return mutate(user, scope, 'workbench.confirm.retry', key, { id }, async (c) => {
    await progress(c, scope, id);
    // A fresh authorized finance actor may take over a failed task without changing its reviewed items.
    await c.query(
      "UPDATE zh_confirmation_jobs SET status='pending',actor_id=?,last_error=NULL WHERE id=? AND status='failed'",
      [user.sub, id],
    );
    return chunk(c, user, scope, id);
  });
}
export async function processConfirmation(scope: Scope, id: string) {
  if (!config.enabledModules.includes('zhihu')) fail('知乎模块已禁用', 403);
  try {
    return await withTransaction(async (c) => {
      await scopeLock(c, scope);
      await assertEngineWritable(c, scope);
      const [job] = await select(
        c,
        'SELECT actor_id FROM zh_confirmation_jobs WHERE id=? AND account_id=? AND project_id=?',
        [id, scope.accountId, scope.projectId],
      );
      if (!job) fail('账单处理记录不存在', 404);
      const [actor] = await select(
        c,
        'SELECT id,role,admin_duty,is_active,username,display_name FROM users WHERE id=? FOR SHARE',
        [job.actor_id],
      );
      if (!actor || !actor.is_active || !isRole(actor.role)) fail('经办人已停用，请由财务重新接手', 403);
      const user: AuthUser = {
        sub: String(actor.id),
        role: actor.role,
        adminDuty: actor.admin_duty as AuthUser['adminDuty'],
        username: String(actor.username),
        displayName: String(actor.display_name),
        parentId: null,
        jti: 'confirmation-worker',
      };
      assertDuty(user, 'finance');
      return chunk(c, user, scope, id);
    });
  } catch (error) {
    await db.query(
      "UPDATE zh_confirmation_jobs SET status='failed',last_error=? WHERE id=? AND account_id=? AND project_id=? AND status='pending'",
      [(error instanceof Error ? error.message : '账单处理失败').slice(0, 1000), id, scope.accountId, scope.projectId],
    );
    throw error;
  }
}
let recovering = false;
export async function recoverConfirmations() {
  if (!config.enabledModules.includes('zhihu') || recovering) return;
  recovering = true;
  try {
    const jobs = await withTransaction((c) =>
      select(
        c,
        "SELECT CAST(id AS CHAR) id,CAST(project_id AS CHAR) project_id,CAST(account_id AS CHAR) account_id FROM zh_confirmation_jobs WHERE status='pending' ORDER BY updated_at,id LIMIT 10",
      ),
    );
    for (const j of jobs) {
      try {
        await processConfirmation({ projectId: String(j.project_id), accountId: String(j.account_id) }, String(j.id));
      } catch {
        /* Persisted failed status is available to finance; no blind retry. */
      }
    }
  } finally {
    recovering = false;
  }
}
