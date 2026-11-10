import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthUser } from '../types';
import { withTransaction } from '../db';
import { AppError } from '../middleware/errors';
import { observeQueue } from '../queue';
import { queryRows } from './insights-scope';

function developer(user: AuthUser) {
  if (user.role !== 'developer') throw new AppError(403, 40301, '此操作需要开发者权限');
}
const paging = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), days: z.coerce.number().int().min(1).max(366).optional() }).strict();
const capabilities = { queue: true, currentInspection: true, inspectionHistory: false, workerHeartbeats: false, dailyProcessingHistory: false };
const stateText: Record<string, string> = { waiting: '等待处理', active: '正在处理', in_flight: '等待或正在处理', delayed: '等待重试', completed: '已完成', failed: '处理失败', paused: '已暂停', stuck: '待检查' };
async function boundedRead<T>(read: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([read, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Current observation timed out')), 5000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
async function snapshot(page: number, pageSize: number) {
  try { return await boundedRead(observeQueue(page, pageSize)); }
  catch { throw new AppError(503, 50301, '暂时无法读取任务处理状态，请重试'); }
}
export async function readDeveloperInsights(user: AuthUser, name: string, query: unknown) {
  developer(user);
  const q = paging.parse(query), observedAt = new Date().toISOString();
  if (name === 'dev-inspections') return { status: 'ready', capabilities, canRun: true, observedAt, cards: [], records: [], historyAvailable: false, message: '可立即检查当前数据库和队列连通情况；尚无历史巡检记录' };
  if (name === 'dev-workers') return { status: 'unavailable', capabilities, list: [], observedAt, capability: { available: false, reason: '当前系统未保存处理进程心跳，队列连通不能证明全部处理进程健康' }, detail: { path: '/system/monitor' } };
  if (name === 'dev-daily') return { status: 'unavailable', capabilities, labels: [], values: [], observedAt, capability: { available: false, reason: '保留的队列任务不构成完整每日处理历史，当前不能生成可靠趋势' } };
  const state = await snapshot(q.page, q.pageSize);
  if (name === 'dev-summary') return { status: 'partial', capabilities, observedAt: state.observedAt, queueBacklog: state.counts.inFlight, queueCounts: state.counts,
    processedToday: null, syncTasks: null, patrols: null, failures24h: null, lastFailure: null, weekImports: null, weekPatrols: null, weekFixes: null,
    timeBasis: 'current_queue_observation', historyScope: state.historyScope, message: '队列数量来自当前实际状态；当日处理、巡检和失败历史尚无完整记录' };
  const rows = state.jobs.map(job => ({ task: '后台处理任务', type: '任务处理', status: stateText[job.state] ?? '待检查',
    at: job.finishedAt ?? job.startedAt ?? job.queuedAt, duration: job.durationMs === null ? '暂无耗时记录' : job.durationMs + ' 毫秒', ...job }));
  if (name === 'dev-activity') return { status: rows.length ? 'ready' : 'empty', capabilities, observedAt: state.observedAt, historyScope: state.historyScope, page: q.page, pageSize: q.pageSize, total: state.total,
    list: rows.map(row => ({ title: row.status, detail: row.at, tone: row.state === 'failed' ? 'danger' : row.state === 'completed' ? 'ok' : 'info', ...row })) };
  return { status: 'ready', capabilities, observedAt: state.observedAt, driver: state.driver, historyScope: state.historyScope, backlog: state.counts.inFlight, counts: state.counts, successRate: null,
    successRateReason: '自动清理后的任务集合不能计算完整成功率', rows, total: state.total, page: q.page, pageSize: q.pageSize };
}
export async function runCurrentInspection(user: AuthUser, body: unknown) {
  developer(user);
  z.object({ requestKey: z.string().regex(/^[\w.-]{8,128}$/).optional() }).strict().parse(body ?? {});
  const ranAt = new Date().toISOString(), runId = randomUUID();
  const checks: { id: string; time: string; item: string; duration: string; durationMs: number; result: string; status: string; diffs: null }[] = [];
  for (const [name, check] of [
    ['数据库连通', () => withTransaction(c => queryRows(c, 'SELECT 1 AS reachable'))],
    ['队列状态读取', () => observeQueue(1, 1)],
  ] as const) {
    const started = Date.now(); let succeeded = true;
    try { await boundedRead<unknown>(check()); } catch { succeeded = false; }
    const durationMs = Date.now() - started;
    checks.push({ id: runId + ':' + checks.length, time: new Date().toISOString(), item: name, duration: durationMs + ' 毫秒', durationMs, result: succeeded ? '当前可连接' : '当前无法连接，请重试', status: succeeded ? 'passed' : 'failed', diffs: null });
  }
  return { status: checks.every(c => c.status === 'passed') ? 'ready' : 'failed', runId, ranAt, records: checks, capabilities, saved: false, scope: 'current_connectivity_only', message: '本次只检查当前连通情况，不代表历史巡检或业务金额已核对' };
}
