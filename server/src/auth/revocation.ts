import Redis from 'ioredis';
import { config } from '../config';

interface RevocationStore {
  register(userId: string, jti: string, ttlSeconds: number): Promise<void>;
  revoke(jti: string, ttlSeconds: number): Promise<void>;
  revokeUser(userId: string): Promise<void>;
  isRevoked(jti: string): Promise<boolean>;
  close(): Promise<void>;
}

class MemoryRevocationStore implements RevocationStore {
  private revoked = new Map<string, number>();
  private byUser = new Map<string, Map<string, number>>();

  async register(userId: string, jti: string, ttlSeconds: number) {
    const expires = Date.now() + ttlSeconds * 1000;
    const sessions = this.byUser.get(userId) ?? new Map<string, number>();
    sessions.set(jti, expires);
    this.byUser.set(userId, sessions);
  }

  async revoke(jti: string, ttlSeconds: number) {
    this.revoked.set(jti, Date.now() + Math.max(ttlSeconds, 1) * 1000);
  }

  async revokeUser(userId: string) {
    const sessions = this.byUser.get(userId);
    if (!sessions) return;
    for (const [jti, expires] of sessions) this.revoked.set(jti, expires);
    this.byUser.delete(userId);
  }

  async isRevoked(jti: string) {
    const expires = this.revoked.get(jti);
    if (!expires) return false;
    if (expires <= Date.now()) {
      this.revoked.delete(jti);
      return false;
    }
    return true;
  }

  async close() {}
}

class RedisRevocationStore implements RevocationStore {
  private redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 1_000,
    retryStrategy: () => null,
  });

  constructor() {
    this.redis.on('error', () => undefined);
  }

  private async ready() {
    if (this.redis.status === 'wait') await this.redis.connect();
  }

  async register(userId: string, jti: string, ttlSeconds: number) {
    await this.ready();
    const key = `auth:user:${userId}:jtis`;
    await this.redis.multi().sadd(key, jti).expire(key, ttlSeconds).exec();
  }

  async revoke(jti: string, ttlSeconds: number) {
    await this.ready();
    await this.redis.set(`auth:blacklist:${jti}`, '1', 'EX', Math.max(ttlSeconds, 1));
  }

  async revokeUser(userId: string) {
    await this.ready();
    const key = `auth:user:${userId}:jtis`;
    const jtis = await this.redis.smembers(key);
    const transaction = this.redis.multi();
    for (const jti of jtis) transaction.set(`auth:blacklist:${jti}`, '1', 'EX', 28_800);
    transaction.del(key);
    await transaction.exec();
  }

  async isRevoked(jti: string) {
    await this.ready();
    return (await this.redis.exists(`auth:blacklist:${jti}`)) === 1;
  }

  async close() {
    await this.redis.quit().catch(() => undefined);
  }
}

class ResilientRevocationStore implements RevocationStore {
  private readonly memory = new MemoryRevocationStore();
  private readonly redis = config.queueDriver === 'bull' ? new RedisRevocationStore() : null;

  async register(userId: string, jti: string, ttlSeconds: number) {
    await this.memory.register(userId, jti, ttlSeconds);
    await this.redis?.register(userId, jti, ttlSeconds).catch(() => undefined);
  }

  async revoke(jti: string, ttlSeconds: number) {
    await this.memory.revoke(jti, ttlSeconds);
    await this.redis?.revoke(jti, ttlSeconds).catch(() => undefined);
  }

  async revokeUser(userId: string) {
    await this.memory.revokeUser(userId);
    await this.redis?.revokeUser(userId).catch(() => undefined);
  }

  async isRevoked(jti: string) {
    if (await this.memory.isRevoked(jti)) return true;
    return (await this.redis?.isRevoked(jti).catch(() => false)) ?? false;
  }

  async close() {
    await this.redis?.close();
  }
}

export const revocationStore: RevocationStore = new ResilientRevocationStore();
