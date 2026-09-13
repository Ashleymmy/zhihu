import { randomUUID } from 'node:crypto';
import { db, withTransaction } from '../../../db';
import { config } from '../../../config';
import { enqueue, registerJob } from '../../../queue';
import { logger } from '../../../utils/logger';
import type { AuthUser } from '../../../types';
import { fail } from './domain';
import { scopeLock, select } from './store';
import { processBatch } from './facts';
import { enqueue as enqueueZhihu } from '../queue';

export async function processImportJob(data: Record<string, unknown>) {
  if (!config.enabledModules.includes('zhihu')) fail('知乎模块已禁用', 403);
  if (
    data.moduleId !== 'zhihu' ||
    ![data.accountId, data.projectId, data.jobId].every((x) => typeof x === 'string' && /^\d+$/.test(x))
  )
    fail('处理任务缺少明确范围');
  const token = randomUUID(),
    scope = { accountId: String(data.accountId), projectId: String(data.projectId) };
  const job = await withTransaction(async (c) => {
    await scopeLock(c, scope);
    const [j] = await select(
      c,
      `SELECT * FROM zh_processing_jobs WHERE id=? AND account_id=? AND project_id=? FOR UPDATE`,
      [data.jobId, scope.accountId, scope.projectId],
    );
    if (!j) fail('处理任务范围不匹配', 403);
    const [due] = await select(
      c,
      "SELECT (status<>'done' AND next_attempt_at<=NOW(3) AND (lease_until IS NULL OR lease_until<=NOW(3))) ready FROM zh_processing_jobs WHERE id=?",
      [j.id],
    );
    if (!Number(due.ready)) return null;
    await c.query(
      "UPDATE zh_processing_jobs SET status='running',attempts=attempts+1,lease_token=?,lease_until=TIMESTAMPADD(SECOND,120,NOW(3)) WHERE id=?",
      [token, j.id],
    );
    return j;
  });
  if (!job) return;
  try {
    const user: AuthUser = {
      sub: String(job.actor_id),
      role: 'admin',
      parentId: null,
      username: 'report-worker',
      displayName: '报告处理',
      jti: 'background',
    };
    const r = await processBatch(user, scope, String(job.batch_id));
    await db.query(
      'UPDATE zh_processing_jobs SET status=?,lease_token=NULL,lease_until=NULL,last_error=NULL,next_attempt_at=NOW(3) WHERE id=? AND lease_token=?',
      [r.remaining ? 'pending' : 'done', job.id, token],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : '报告处理失败';
    await db.query(
      "UPDATE zh_processing_jobs SET status='failed',lease_token=NULL,lease_until=NULL,last_error=?,next_attempt_at=TIMESTAMPADD(SECOND,LEAST(3600,POW(2,LEAST(attempts,10))*5),NOW(3)) WHERE id=? AND lease_token=?",
      [message.slice(0, 1000), job.id, token],
    );
    throw error;
  }
}
export async function recoverImports() {
  if (!config.enabledModules.includes('zhihu')) return;
  const jobs = await withTransaction((c) =>
    select(
      c,
      `SELECT CAST(j.id AS CHAR) id,CAST(j.account_id AS CHAR) account_id,CAST(j.project_id AS CHAR) project_id
    FROM zh_processing_jobs j JOIN integration_accounts a ON a.id=j.account_id JOIN projects p ON p.id=j.project_id
    WHERE j.status<>'done' AND j.next_attempt_at<=NOW(3) AND (j.lease_until IS NULL OR j.lease_until<=NOW(3)) AND a.status='active' AND p.is_enabled=1
    AND NOT EXISTS(SELECT 1 FROM zh_engine_routes r WHERE r.account_id=j.account_id AND r.project_id=j.project_id AND r.mode='stopped') ORDER BY j.next_attempt_at,j.id LIMIT 100`,
    ),
  );
  for (const j of jobs) {
    try {
      await enqueue(
        'zhihu.exclusive-import',
        { moduleId: 'zhihu', accountId: j.account_id, projectId: j.project_id, jobId: j.id },
        {
          jobId: `zhihu-import-${j.account_id}-${j.project_id}-${j.id}`,
          removeOnComplete: true,
          removeOnFail: true,
          attempts: 1,
        },
      );
    } catch (error) {
      logger.warn(
        { jobId: j.id, error: error instanceof Error ? error.message : 'queue unavailable' },
        'exclusive_import_delivery_failed',
      );
    }
  }
  // local 表示尚未向上游发出请求；syncing 的不确定结果留待人工核实，不盲目重放。
  const plans = await withTransaction((c) =>
    select(
      c,
      `SELECT CAST(p.id AS CHAR) id,CAST(k.account_id AS CHAR) account_id,CAST(k.project_id AS CHAR) project_id FROM zh_keywords k JOIN plans p ON p.id=k.plan_id
    JOIN integration_accounts a ON a.id=k.account_id JOIN projects pr ON pr.id=k.project_id WHERE p.sync_status='local' AND p.zhihu_plan_id IS NULL AND p.status<>'ended' AND a.status='active' AND pr.is_enabled=1
    AND NOT EXISTS(SELECT 1 FROM zh_engine_routes r WHERE r.account_id=k.account_id AND r.project_id=k.project_id AND r.mode='stopped') ORDER BY p.id LIMIT 100`,
    ),
  );
  for (const p of plans) {
    try {
      await enqueueZhihu(
        'push-plan',
        { projectId: p.project_id, accountId: p.account_id, planId: p.id },
        { jobId: `exclusive-plan-${p.id}`, removeOnComplete: true, removeOnFail: true },
      );
    } catch (error) {
      logger.warn({ planId: p.id, error: String(error) }, 'exclusive_plan_redelivery_failed');
    }
  }
}
let timer: ReturnType<typeof setInterval> | undefined;
export function registerAttributionJobs() {
  registerJob('zhihu.exclusive-import', processImportJob);
}
export function startAttributionWorker() {
  if (timer) return;
  const tick = () => {
    void recoverImports().catch((e) => logger.error({ error: String(e) }, 'exclusive_import_recovery_failed'));
  };
  timer = setInterval(tick, 10000);
  timer.unref();
  tick();
}
export function stopAttributionWorker() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
