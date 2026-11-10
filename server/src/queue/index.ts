import Queue, { Job, JobOptions } from 'bull';
import { config } from '../config';

export type JobName = string;
export type JobHandler = (data: Record<string, unknown>) => Promise<void>;

const handlers = new Map<JobName, JobHandler>();
const activeMemoryJobs = new Set<string>();
let bullQueue: Queue.Queue | null = null;

function queue() {
  bullQueue ??= new Queue('opc-jobs', config.redisUrl, {
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  });
  return bullQueue;
}

function retryDelay(options: JobOptions, attempt: number) {
  const backoff = options.backoff;
  const base = typeof backoff === 'number' ? backoff : (backoff?.delay ?? 1_000);
  return base * 2 ** attempt;
}

async function runMemoryJob(name: JobName, data: Record<string, unknown>, options: JobOptions) {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`未注册任务处理器: ${name}`);
  const attempts = Math.max(Number(options.attempts ?? 3), 1);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await handler(data);
      return;
    } catch (error) {
      if (attempt === attempts - 1) {
        if (process.env.NODE_ENV !== 'test') {
          console.error('memory_job_failed', name, error instanceof Error ? error.message : 'unknown error');
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelay(options, attempt)));
    }
  }
}

export function registerJob(name: JobName, handler: JobHandler) {
  handlers.set(name, handler);
  if (config.queueDriver === 'bull' && config.runBackgroundJobs)
    queue().process(name, async (job: Job) => handler(job.data));
}

export async function enqueue(name: JobName, data: Record<string, unknown>, options: JobOptions = {}) {
  if (config.queueDriver === 'memory') {
    const id = String(options.jobId ?? `${name}-${Date.now()}`);
    if (activeMemoryJobs.has(id)) return { id };
    activeMemoryJobs.add(id);
    setImmediate(() => {
      void runMemoryJob(name, data, options).finally(() => activeMemoryJobs.delete(id));
    });
    return { id };
  }
  return queue().add(name, data, options);
}

export async function closeQueue() {
  if (bullQueue) await bullQueue.close();
  bullQueue = null;
}

/** Read only. Retained Bull jobs are not a complete daily execution history. */
export async function observeQueue(page = 1, pageSize = 20) {
  const observedAt = new Date().toISOString();
  if (config.queueDriver === 'memory') return {
    driver: 'memory' as const, observedAt, historyScope: 'current_process_in_flight' as const,
    counts: { inFlight: activeMemoryJobs.size, waiting: null, active: null, delayed: null, paused: null, completed: null, failed: null },
    total: activeMemoryJobs.size, page, pageSize,
    jobs: [...activeMemoryJobs].slice((page - 1) * pageSize, page * pageSize).map(id => ({ id, state: 'in_flight', queuedAt: null, startedAt: null, finishedAt: null, attempts: null, durationMs: null })),
    registeredHandlers: handlers.size, workerHeartbeatAvailable: false,
  };
  const current = queue();
  const counts = await current.getJobCounts();
  const paused = await current.getPausedCount();
  const jobs = await current.getJobs(['waiting', 'active', 'delayed', 'completed', 'failed', 'paused'], (page - 1) * pageSize, page * pageSize - 1, false);
  return {
    driver: 'bull' as const, observedAt, historyScope: 'retained_jobs_only' as const,
    counts: { inFlight: counts.waiting + counts.active + counts.delayed + paused, waiting: counts.waiting, active: counts.active, delayed: counts.delayed, paused, completed: counts.completed, failed: counts.failed },
    total: Object.values(counts).reduce((sum, count) => sum + count, 0), page, pageSize,
    jobs: await Promise.all(jobs.map(async job => ({ id: String(job.id), state: await job.getState(),
      queuedAt: new Date(job.timestamp).toISOString(), startedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
      finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null, attempts: job.attemptsMade,
      durationMs: job.finishedOn && job.processedOn ? Math.max(0, job.finishedOn - job.processedOn) : null }))),
    registeredHandlers: handlers.size, workerHeartbeatAvailable: false,
  };
}
