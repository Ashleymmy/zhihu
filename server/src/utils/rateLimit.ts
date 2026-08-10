import Redis from 'ioredis';
import { config } from '../config';

const memory = new Map<string, number>();
let redis: Redis | null = null;

function acquireMemory(key: string, ttlSeconds: number): boolean {
  const expires = memory.get(key) ?? 0;
  if (expires > Date.now()) return false;
  memory.set(key, Date.now() + ttlSeconds * 1000);
  return true;
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
    return acquireMemory(key, ttlSeconds);
  }
}

export async function closeRateLimiter() {
  if (redis) await redis.quit().catch(() => undefined);
  redis = null;
}
