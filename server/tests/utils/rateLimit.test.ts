import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { incrRateLimit, deleteRateLimit, closeRateLimiter } from '../../src/utils/rateLimit';

describe('incrRateLimit', () => {
  beforeEach(() => {
    process.env.QUEUE_DRIVER = 'memory';
  });

  afterAll(async () => {
    await closeRateLimiter();
  });

  it('第一次调用允许通过', async () => {
    const result = await incrRateLimit('test:counter:1', 5, 10);
    expect(result.allowed).toBe(true);
    expect(result.count).toBe(1);
  });

  it('在限制内递增计数', async () => {
    const key = 'test:counter:2';
    const r1 = await incrRateLimit(key, 3, 10);
    const r2 = await incrRateLimit(key, 3, 10);
    const r3 = await incrRateLimit(key, 3, 10);
    expect(r1).toEqual({ allowed: true, count: 1 });
    expect(r2).toEqual({ allowed: true, count: 2 });
    expect(r3).toEqual({ allowed: true, count: 3 });
  });

  it('超过限制后拒绝', async () => {
    const key = 'test:counter:3';
    await incrRateLimit(key, 2, 10);
    await incrRateLimit(key, 2, 10);
    const result = await incrRateLimit(key, 2, 10);
    expect(result.allowed).toBe(false);
    expect(result.count).toBe(3);
  });

  it('deleteRateLimit 清空计数后可重新开始', async () => {
    const key = 'test:counter:4';
    await incrRateLimit(key, 2, 10);
    await incrRateLimit(key, 2, 10);
    await deleteRateLimit(key);
    const result = await incrRateLimit(key, 2, 10);
    expect(result).toEqual({ allowed: true, count: 1 });
  });

  it('不同 key 的计数独立', async () => {
    const r1 = await incrRateLimit('test:counter:5a', 2, 10);
    const r2 = await incrRateLimit('test:counter:5b', 2, 10);
    expect(r1.count).toBe(1);
    expect(r2.count).toBe(1);
  });
});
