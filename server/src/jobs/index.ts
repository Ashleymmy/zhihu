import cron, { ScheduledTask } from 'node-cron';
import { config } from '../config';
import { enqueue, registerJob } from '../queue';
import { acquireRateLimit } from '../utils/rateLimit';
import { pushPlan } from './pushPlan';
import { pushComposition } from './pushComposition';
import { syncMetrics } from './syncMetrics';
import { syncChannels, syncTasks } from './syncCatalog';
import { settleEarnings } from './settleEarnings';
import { syncPlanStatus } from './syncPlanStatus';
import { syncCompositionStatus } from './syncCompositionStatus';

let task: ScheduledTask | null = null;
let settleTask: ScheduledTask | null = null;

export function registerJobs() {
  registerJob('push-plan', pushPlan);
  registerJob('push-composition', pushComposition);
  registerJob('sync-metrics', syncMetrics);
  registerJob('sync-channels', syncChannels);
  registerJob('sync-tasks', syncTasks);
  registerJob('settle-earnings', settleEarnings);
  registerJob('sync-plan-status', syncPlanStatus);
  registerJob('sync-composition-status', syncCompositionStatus);
}

export function startScheduler() {
  if (task) return;
  task = cron.schedule(
    '0 2 * * *',
    () => {
      void (async () => {
        const day = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(new Date());
        const acquired = await acquireRateLimit(`metrics-daily-lock:${day}`, 3_600);
        if (!acquired) return;
        await enqueue('sync-metrics', { source: 'cron' }, { jobId: `metrics-daily-${day}` });
        // 拉完数据后立即触发结算（结算昨天的数据）
        await enqueue('settle-earnings', { source: 'cron' }, { jobId: `settle-${day}` });
      })().catch((error) => {
        if (process.env.NODE_ENV !== 'test') {
          console.error('daily_metrics_enqueue_failed', error instanceof Error ? error.message : 'unknown error');
        }
      });
    },
    { timezone: config.timezone },
  );

  // 每天凌晨 3 点同步推广计划和作品的审核状态
  settleTask = cron.schedule(
    '0 3 * * *',
    () => {
      void (async () => {
        const day = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(new Date());
        await enqueue('sync-plan-status', { source: 'cron' }, { jobId: `sync-plan-status-${day}` });
        await enqueue('sync-composition-status', { source: 'cron' }, { jobId: `sync-composition-status-${day}` });
      })().catch((error) => {
        if (process.env.NODE_ENV !== 'test') {
          console.error('sync_status_enqueue_failed', error instanceof Error ? error.message : 'unknown error');
        }
      });
    },
    { timezone: config.timezone },
  );
}

export function stopScheduler() {
  task?.stop();
  task = null;
  settleTask?.stop();
  settleTask = null;
}
