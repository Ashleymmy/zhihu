import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnvironment } from '../../src/config';

const state = vi.hoisted(() => ({
  config: { queueDriver: 'bull', redisUrl: 'redis://localhost:6379', runBackgroundJobs: false, port: 3000 },
  add: vi.fn().mockResolvedValue({ id: 'queued' }),
  process: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
  start: vi.fn(),
  stop: vi.fn(),
}));

describe('后台任务发布配置', () => {
  it('默认保留现有单实例行为', () => {
    expect(parseEnvironment({}).RUN_BACKGROUND_JOBS).toBe('true');
  });

  it('候选实例只能使用持久队列，防止关闭任务后丢失内存任务', () => {
    expect(parseEnvironment({ RUN_BACKGROUND_JOBS: 'false', QUEUE_DRIVER: 'bull' }).RUN_BACKGROUND_JOBS).toBe('false');
    expect(() => parseEnvironment({ RUN_BACKGROUND_JOBS: 'false' })).toThrow('持久队列');
    expect(() => parseEnvironment({ RUN_BACKGROUND_JOBS: 'no', QUEUE_DRIVER: 'bull' })).toThrow();
  });
});

describe('蓝绿实例隔离', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    state.config.runBackgroundJobs = false;
    vi.doMock('../../src/config', () => ({ config: state.config }));
    vi.doMock('bull', () => ({
      default: class {
        add = state.add;
        process = state.process;
        close = state.close;
      },
    }));
  });

  afterEach(() => {
    vi.doUnmock('../../src/config');
    vi.doUnmock('bull');
    vi.doUnmock('../../src/app');
    vi.doUnmock('../../src/utils/logger');
    vi.doUnmock('../../src/db');
    vi.doUnmock('../../src/auth/revocation');
    vi.doUnmock('../../src/utils/rateLimit');
    vi.doUnmock('../../src/wechat/observability');
    vi.restoreAllMocks();
  });

  it('候选实例可持久化新任务，但不消费任何后台任务', async () => {
    const queue = await import('../../src/queue');
    const handler = vi.fn();
    queue.registerJob('zhihu.exclusive-import', handler);
    expect(state.process).not.toHaveBeenCalled();
    await queue.enqueue('zhihu.exclusive-import', { jobId: '5' }, { jobId: 'report-5' });
    expect(state.add).toHaveBeenCalledWith('zhihu.exclusive-import', { jobId: '5' }, { jobId: 'report-5' });
    expect(handler).not.toHaveBeenCalled();
    await queue.closeQueue();
  });

  it('启用后台任务的实例保留正常消费', async () => {
    state.config.runBackgroundJobs = true;
    const queue = await import('../../src/queue');
    const handler = vi.fn().mockResolvedValue(undefined);
    queue.registerJob('zhihu.exclusive-import', handler);
    const consumer = state.process.mock.calls[0][1];
    await consumer({ data: { jobId: '5' } });
    expect(handler).toHaveBeenCalledWith({ jobId: '5' });
    await queue.closeQueue();
  });

  it.each([false, true])('后台开关为 %s 时同步控制定时器与恢复扫描', async (enabled) => {
    state.config.runBackgroundJobs = enabled;
    vi.doMock('../../src/app', () => ({
      createApp: () => ({
        locals: { moduleRuntime: { start: state.start, stop: state.stop } },
        listen: (_port: number, callback: () => void) => {
          callback();
          return {};
        },
      }),
    }));
    vi.doMock('../../src/utils/logger', () => ({ logger: { info: vi.fn() } }));
    vi.doMock('../../src/db', () => ({ db: { end: vi.fn() } }));
    vi.doMock('../../src/auth/revocation', () => ({ revocationStore: { close: vi.fn() } }));
    vi.doMock('../../src/utils/rateLimit', () => ({ closeRateLimiter: vi.fn() }));
    vi.doMock('../../src/wechat/observability', () => ({ flushMiniObservations: vi.fn() }));
    vi.spyOn(process, 'once').mockReturnValue(process);
    await import('../../src/index');
    expect(state.start).toHaveBeenCalledTimes(enabled ? 1 : 0);
  });
});
