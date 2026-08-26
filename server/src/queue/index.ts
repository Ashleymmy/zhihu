import Queue, { Job, JobOptions } from 'bull';
import { config } from '../config';

export type JobName = 'push-plan' | 'push-composition' | 'sync-metrics' | 'sync-channels' | 'sync-tasks' | 'settle-earnings';
export type JobHandler = (data: Record<string, unknown>) => Promise<void>;

const handlers = new Map<JobName, JobHandler>();
const activeMemoryJobs = new Set<string>();
let bullQueue: Queue.Queue | null = null;

function queue() {
  bullQueue ??= new Queue('zhihu-bff', config.redisUrl, {
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
  if (config.queueDriver === 'bull') queue().process(name, async (job: Job) => handler(job.data));
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
