import Redis from 'ioredis';
import { config } from '../config';

const memory = new Map<string, number>();
const counters = new Map<string, { count: number; expires: number }>();
let redis: Redis | null = null;
let degraded = false;

function acquireMemory(key: string, ttlSeconds: number): boolean {
  const expires = memory.get(key) ?? 0;
  if (expires > Date.now()) return false;
  memory.set(key, Date.now() + ttlSeconds * 1000);
  return true;
}

function incrMemory(key: string, limit: number, windowSeconds: number): { allowed: boolean; count: number } {
  const now = Date.now();
  const entry = counters.get(key);
  if (entry && entry.expires > now) {
    entry.count++;
    return { allowed: entry.count <= limit, count: entry.count };
  }
  counters.set(key, { count: 1, expires: now + windowSeconds * 1000 });
  return { allowed: true, count: 1 };
}

export async function acquireRateLimit(key: string, ttlSeconds: number): Promise<boolean> {
  if (config.queueDriver === 'memory') return acquireMemory(key, ttlSeconds);
  try {
    redis ??= new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 1_000,
      retryStrategy: () => null,
    });
    redis.on('error', () => undefined);
    if (redis.status === 'wait') await redis.connect();
    return (await redis.set(`rate:${key}`, '1', 'EX', ttlSeconds, 'NX')) === 'OK';
  } catch {
    if (!degraded) {
      console.warn('[rateLimit] Redis 连接失败，降级为内存限流');
      degraded = true;
    }
    return acquireMemory(key, ttlSeconds);
  }
}

export async function incrRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; count: number }> {
  if (config.queueDriver === 'memory') return incrMemory(key, limit, windowSeconds);
  try {
    redis ??= new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 1_000,
      retryStrategy: () => null,
    });
    redis.on('error', () => undefined);
    if (redis.status === 'wait') await redis.connect();
    const count = await redis.incr(`rate:${key}`);
    if (count === 1) await redis.expire(`rate:${key}`, windowSeconds);
    return { allowed: count <= limit, count };
  } catch {
    if (!degraded) {
      console.warn('[rateLimit] Redis 连接失败，降级为内存限流');
      degraded = true;
    }
    return incrMemory(key, limit, windowSeconds);
  }
}

export async function deleteRateLimit(key: string): Promise<void> {
  if (config.queueDriver === 'memory') {
    counters.delete(key);
    return;
  }
  try {
    redis ??= new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 1_000,
      retryStrategy: () => null,
    });
    redis.on('error', () => undefined);
    if (redis.status === 'wait') await redis.connect();
    await redis.del(`rate:${key}`);
  } catch {
    if (!degraded) {
      console.warn('[rateLimit] Redis 连接失败，降级为内存限流');
      degraded = true;
    }
    counters.delete(key);
  }
}

export async function closeRateLimiter() {
  if (redis) await redis.quit().catch(() => undefined);
  redis = null;
}
