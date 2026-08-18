import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ALLIANCE_QUOTA_CONFIRM_SCRIPT,
  ALLIANCE_QUOTA_OPERATION_KEYS,
  ALLIANCE_QUOTA_RELEASE_SCRIPT,
  ALLIANCE_QUOTA_RESERVE_SCRIPT,
  AllianceQuotaConfigurationError,
  AllianceQuotaDeniedError,
  AllianceQuotaManager,
  AllianceQuotaStoreError,
  allianceQuotaAccountScope,
  allianceQuotaUtcDay,
  buildAllianceQuotaBucketKey,
  buildAllianceQuotaKey,
  createRedisAllianceQuotaManager,
  InMemoryAllianceQuotaStore,
  loadAllianceQuotaPolicy,
  parseAllianceQuotaPolicy,
  RedisAllianceQuotaStore,
  type AllianceQuotaPolicy,
  type AllianceQuotaRedisClient,
} from '../../src/zhihu/allianceQuota';
import { TEST_ALLIANCE_QUOTA_POLICY } from '../support/allianceQuotaFixture';

function policy(dailyBudget: number, cost = 1): AllianceQuotaPolicy {
  return parseAllianceQuotaPolicy({
    dailyBudget,
    costs: Object.fromEntries(ALLIANCE_QUOTA_OPERATION_KEYS.map((operationKey) => [operationKey, cost])),
  });
}

interface FakeReservation {
  bucketKey: string;
  cost: number;
  expiresAt: number;
  status: 'reserved' | 'confirmed' | 'released';
}

class FakeRedisClient implements AllianceQuotaRedisClient {
  readonly calls: Array<{ script: string; numberOfKeys: number; arguments_: string[] }> = [];
  readonly buckets = new Map<string, { used: number; reserved: number }>();
  readonly reservations = new Map<string, FakeReservation>();
  readonly leases = new Map<string, Map<string, number>>();
  unavailable = false;

  async eval(script: string, numberOfKeys: number, ...arguments_: string[]): Promise<unknown> {
    this.calls.push({ script, numberOfKeys, arguments_ });
    if (this.unavailable) throw new Error('redis://secret-account@internal.invalid:6379');

    const bucketKey = arguments_[0]!;
    const leasesKey = arguments_[1]!;
    const reservationKey = arguments_[2]!;
    const bucket = this.buckets.get(bucketKey) ?? { used: 0, reserved: 0 };
    const leases = this.leases.get(leasesKey) ?? new Map<string, number>();

    if (script === ALLIANCE_QUOTA_RESERVE_SCRIPT) {
      const dailyBudget = Number(arguments_[3]);
      const cost = Number(arguments_[4]);
      const reservationId = arguments_[5]!;
      const expiresAt = Number(arguments_[6]);
      const now = Number(arguments_[7]);

      for (const [expiredKey, expiry] of leases) {
        if (expiry > now) continue;
        const stale = this.reservations.get(expiredKey);
        if (stale?.status === 'reserved') bucket.reserved = Math.max(0, bucket.reserved - stale.cost);
        this.reservations.delete(expiredKey);
        leases.delete(expiredKey);
      }
      if (cost > dailyBudget - bucket.used - bucket.reserved) return [0];
      bucket.reserved += cost;
      this.buckets.set(bucketKey, bucket);
      this.leases.set(leasesKey, leases);
      this.reservations.set(reservationKey, { bucketKey, cost, expiresAt, status: 'reserved' });
      leases.set(reservationKey, expiresAt);
      return [1, reservationId, expiresAt];
    }

    const reservation = this.reservations.get(reservationKey);
    if (!reservation || reservation.status !== 'reserved') return 0;
    bucket.reserved = Math.max(0, bucket.reserved - reservation.cost);
    leases.delete(reservationKey);
    if (script === ALLIANCE_QUOTA_CONFIRM_SCRIPT && reservation.expiresAt > Number(arguments_[3])) {
      bucket.used += reservation.cost;
      reservation.status = 'confirmed';
      return 1;
    }
    if (script !== ALLIANCE_QUOTA_RELEASE_SCRIPT && script !== ALLIANCE_QUOTA_CONFIRM_SCRIPT) {
      throw new Error('unknown script');
    }
    reservation.status = 'released';
    return script === ALLIANCE_QUOTA_RELEASE_SCRIPT ? 1 : 0;
  }
}

class ReadyGateRedisClient extends FakeRedisClient {
  connected = false;
  connectCalls = 0;

  async connect(): Promise<void> {
    this.connectCalls += 1;
    await Promise.resolve();
    this.connected = true;
  }

  override async eval(script: string, numberOfKeys: number, ...arguments_: string[]): Promise<unknown> {
    if (!this.connected) throw new Error('redis EVAL raced readiness');
    return super.eval(script, numberOfKeys, ...arguments_);
  }
}

class RejectingReadyRedisClient extends FakeRedisClient {
  connectCalls = 0;

  async connect(): Promise<void> {
    this.connectCalls += 1;
    throw new Error('redis://secret-account@internal.invalid:6379');
  }
}

describe('联盟账号级 Quota', () => {
  it('P0007-R4-CONFIG-001 requires one exact explicit seven-operation policy', () => {
    expect(() => loadAllianceQuotaPolicy({})).toThrow(AllianceQuotaConfigurationError);
    expect(() => parseAllianceQuotaPolicy('{"dailyBudget":10,"dailyBudget":11,"costs":{}}')).toThrow(
      AllianceQuotaConfigurationError,
    );
    expect(() => parseAllianceQuotaPolicy({ dailyBudget: 10, costs: {}, extra: true })).toThrow(
      AllianceQuotaConfigurationError,
    );
    expect(() =>
      parseAllianceQuotaPolicy({
        dailyBudget: 10,
        costs: { ...TEST_ALLIANCE_QUOTA_POLICY.costs, 'GET /unknown': 1 },
      }),
    ).toThrow(AllianceQuotaConfigurationError);
    for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
      expect(() =>
        parseAllianceQuotaPolicy({
          dailyBudget: 10,
          costs: { ...TEST_ALLIANCE_QUOTA_POLICY.costs, 'POST /popularize_plan': invalid },
        }),
      ).toThrow(AllianceQuotaConfigurationError);
    }

    const raw = JSON.stringify(TEST_ALLIANCE_QUOTA_POLICY);
    expect(loadAllianceQuotaPolicy({ ALLIANCE_QUOTA_POLICY_JSON: raw })).toEqual(TEST_ALLIANCE_QUOTA_POLICY);
    expect(() =>
      loadAllianceQuotaPolicy({
        ALLIANCE_QUOTA_POLICY_JSON: raw,
        ZHIHU_ALLIANCE_QUOTA_POLICY_JSON: JSON.stringify(policy(999)),
      }),
    ).toThrow(AllianceQuotaConfigurationError);
  });

  it('P0007-R4-CONCURRENCY-001 atomically shares one daily budget across all operations', async () => {
    const now = Date.parse('2026-08-18T10:00:00.000Z');
    const store = new InMemoryAllianceQuotaStore();
    const manager = new AllianceQuotaManager({
      policy: policy(5, 3),
      store,
      accountToken: 'account-token',
      clock: () => now,
    });

    const attempts = await Promise.allSettled([
      manager.reserve('POST /popularize_plan'),
      manager.reserve('GET /popularize_compositions'),
    ]);
    const allowed = attempts.find((attempt) => attempt.status === 'fulfilled');
    const rejected = attempts.find((attempt) => attempt.status === 'rejected');
    expect(allowed?.status).toBe('fulfilled');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status === 'rejected') expect(rejected.reason).toBeInstanceOf(AllianceQuotaDeniedError);
    if (allowed?.status !== 'fulfilled') throw new Error('expected one reservation');

    const reservation = allowed.value;
    const bucketKey = buildAllianceQuotaBucketKey(reservation.scope, reservation.day);
    expect(store.snapshot(bucketKey)).toEqual({ used: 0, reserved: 3 });
    await manager.release(reservation);
    await manager.release(reservation);
    expect(store.snapshot(bucketKey)).toEqual({ used: 0, reserved: 0 });

    const confirmed = await manager.reserve('GET /popularize_compositions');
    await manager.confirm(confirmed);
    await manager.confirm(confirmed);
    await manager.release(confirmed);
    expect(store.snapshot(bucketKey)).toEqual({ used: 3, reserved: 0 });
  });

  it('P0007-R4-DAY-001 derives buckets only from UTC and restores the next day', async () => {
    let now = Date.parse('2026-08-18T23:59:59.999Z');
    const manager = new AllianceQuotaManager({
      policy: policy(1),
      store: new InMemoryAllianceQuotaStore(),
      accountToken: 'account-token',
      clock: () => now,
    });
    const first = await manager.reserve('POST /popularize_plan');
    await manager.confirm(first);
    await expect(manager.reserve('GET /popularize_compositions')).rejects.toBeInstanceOf(AllianceQuotaDeniedError);

    now = Date.parse('2026-08-19T00:00:00.000Z');
    const nextDay = await manager.reserve('GET /popularize_compositions');
    expect(first.day).toBe('2026-08-18');
    expect(nextDay.day).toBe('2026-08-19');
    expect(allianceQuotaUtcDay(Date.parse('2026-08-19T08:00:00+08:00'))).toBe('2026-08-19');
  });

  it('P0007-R4-LIFECYCLE-001 reclaims TTL leases after a simulated Redis process restart', async () => {
    const redis = new FakeRedisClient();
    let now = Date.parse('2026-08-18T12:00:00.000Z');
    const firstManager = new AllianceQuotaManager({
      policy: policy(1),
      store: new RedisAllianceQuotaStore({ client: redis }),
      accountToken: 'account-token',
      clock: () => now,
      leaseTtlMs: 1_000,
    });
    const abandoned = await firstManager.reserve('POST /popularize_plan');
    const bucketKey = buildAllianceQuotaBucketKey(abandoned.scope, abandoned.day);
    expect(redis.buckets.get(bucketKey)).toEqual({ used: 0, reserved: 1 });
    await firstManager.close();

    now += 1_001;
    const restartedManager = new AllianceQuotaManager({
      policy: policy(1),
      store: new RedisAllianceQuotaStore({ client: redis }),
      accountToken: 'account-token',
      clock: () => now,
      leaseTtlMs: 1_000,
    });
    const recovered = await restartedManager.reserve('GET /popularize_compositions');
    expect(redis.buckets.get(bucketKey)).toEqual({ used: 0, reserved: 1 });
    await restartedManager.confirm(recovered);
    await restartedManager.confirm(recovered);
    await restartedManager.release(recovered);
    expect(redis.buckets.get(bucketKey)).toEqual({ used: 1, reserved: 0 });
  });

  it('P0007-R4-CONFIG-001 waits for one Redis readiness flight before the first EVAL', async () => {
    const redis = new ReadyGateRedisClient();
    const manager = new AllianceQuotaManager({
      policy: policy(10),
      store: new RedisAllianceQuotaStore({ client: redis }),
      accountToken: 'account-token',
      clock: () => Date.parse('2026-08-18T12:00:00.000Z'),
    });

    const reservations = await Promise.all([
      manager.reserve('POST /popularize_plan'),
      manager.reserve('GET /popularize_compositions'),
    ]);

    expect(redis.connectCalls).toBe(1);
    expect(redis.calls.filter((call) => call.script === ALLIANCE_QUOTA_RESERVE_SCRIPT)).toHaveLength(2);
    await Promise.all(reservations.map((reservation) => manager.release(reservation)));
  });

  it('P0007-R4-CONFIG-001 fails closed when Redis readiness rejects before the first EVAL', async () => {
    const redis = new RejectingReadyRedisClient();
    const manager = new AllianceQuotaManager({
      policy: policy(10),
      store: new RedisAllianceQuotaStore({ client: redis }),
      accountToken: 'account-token',
      clock: () => Date.parse('2026-08-18T12:00:00.000Z'),
    });

    await expect(manager.reserve('POST /popularize_plan')).rejects.toEqual(new AllianceQuotaStoreError());
    expect(redis.connectCalls).toBe(1);
    expect(redis.calls).toHaveLength(0);
  });

  it('P0007-R4-LIFECYCLE-001 requires an explicit in-memory confirm result', async () => {
    let now = Date.parse('2026-08-18T12:00:00.000Z');
    const store = new InMemoryAllianceQuotaStore();
    const manager = new AllianceQuotaManager({
      policy: policy(10),
      store,
      accountToken: 'account-token',
      clock: () => now,
      leaseTtlMs: 1_000,
    });
    const confirmed = await manager.reserve('POST /popularize_plan');
    expect(await store.confirm(confirmed.id, now)).toBe(1);
    expect(await store.confirm(confirmed.id, now)).toBe(0);
    expect(await store.confirm('missing-reservation', now)).toBe(0);

    const expired = await manager.reserve('GET /popularize_compositions');
    now += 1_001;
    expect(await store.confirm(expired.id, now)).toBe(0);
    expect(store.snapshot(buildAllianceQuotaBucketKey(expired.scope, expired.day))).toEqual({ used: 1, reserved: 0 });
  });

  it('P0007-R4-CONFIG-001 fails closed on Redis/script errors without leaking details', async () => {
    const redis = new FakeRedisClient();
    redis.unavailable = true;
    const decisions: unknown[] = [];
    const manager = new AllianceQuotaManager({
      policy: policy(10),
      store: new RedisAllianceQuotaStore({ client: redis }),
      accountToken: 'raw-token-must-not-leak',
      decisionHook: (decision) => decisions.push(decision),
    });
    await expect(manager.reserve('POST /popularize_plan')).rejects.toEqual(new AllianceQuotaStoreError());
    expect(JSON.stringify(decisions)).not.toMatch(/raw-token|redis|internal\.invalid|6379/iu);
    expect(redis.calls).toHaveLength(1);
    expect(redis.calls[0]?.numberOfKeys).toBe(3);
  });

  it('P0007-R4-CONFIG-001 never selects the in-memory store for the production factory', async () => {
    const manager = createRedisAllianceQuotaManager({
      redisUrl: 'redis://127.0.0.1:1',
      accessToken: 'account-token',
      environment: { ALLIANCE_QUOTA_POLICY_JSON: JSON.stringify(TEST_ALLIANCE_QUOTA_POLICY) },
    });
    expect(manager.store).toBeInstanceOf(RedisAllianceQuotaStore);
    expect(manager.store).not.toBeInstanceOf(InMemoryAllianceQuotaStore);
    await manager.close();
  });

  it('P0007-R4-CONFIG-001 reserves 50320 exclusively for quota unavailability', () => {
    const source = [
      readFileSync(resolve(process.cwd(), 'src/routes/alliance.ts'), 'utf8'),
      readFileSync(resolve(process.cwd(), 'src/zhihu/allianceQuota.ts'), 'utf8'),
    ].join('\n');
    expect(source).toContain('50320');
    expect(source).toContain('知乎配额服务暂不可用');
    expect(source).not.toContain('50310');
  });

  it('P0007-R4-SCOPE-001 keys contain only version, account fingerprint, and UTC day', async () => {
    const token = 'token:super-secret';
    const scope = allianceQuotaAccountScope(token);
    const planKey = buildAllianceQuotaKey(scope, '2026-08-18', 'POST /popularize_plans');
    const compositionKey = buildAllianceQuotaKey(scope, '2026-08-18', 'POST /popularize_compositions/v2');
    expect(scope).toMatch(/^[a-f0-9]{64}$/u);
    expect(allianceQuotaAccountScope(token)).toBe(scope);
    expect(allianceQuotaAccountScope('another-token')).not.toBe(scope);
    expect(planKey).toBe(`alliance:quota:v1:${scope}:2026-08-18`);
    expect(compositionKey).toBe(planKey);
    expect(buildAllianceQuotaBucketKey(scope, '2026-08-18')).toBe(planKey);
    expect(planKey).not.toMatch(/popularize_|token:super-secret|127\.0\.0\.1|filename|request-body|signature/iu);

    const redis = new FakeRedisClient();
    const store = new RedisAllianceQuotaStore({ client: redis });
    const reservation = await store.reserve({
      id: 'scope-test',
      key: `${planKey}:POST /popularize_plans`,
      scope,
      operationKey: 'POST /popularize_plans',
      day: '2026-08-18',
      cost: 1,
      expiresAt: Date.parse('2026-08-18T12:00:01.000Z'),
      dailyBudget: 10,
      now: Date.parse('2026-08-18T12:00:00.000Z'),
    });
    if ('kind' in reservation) throw new Error('scope test reservation unexpectedly denied');
    expect(reservation.key).toBe(planKey);
    expect(redis.calls[0]?.arguments_[2]).toBe(`${planKey}:reservation:scope-test`);
    expect(redis.calls[0]?.arguments_[2]).not.toContain('popularize_');
  });

  it('P0007-R4-OBS-001 emits only the redacted quota lifecycle fields', async () => {
    const decisions: unknown[] = [];
    const manager = new AllianceQuotaManager({
      policy: policy(1),
      store: new InMemoryAllianceQuotaStore(),
      accountToken: 'private-access-token',
      decisionHook: (decision) => decisions.push(decision),
    });
    const reservation = await manager.reserve('POST /popularize_plan');
    await manager.release(reservation);
    await expect(manager.reserve('POST /popularize_plan')).resolves.toBeDefined();

    expect(decisions).toHaveLength(3);
    for (const decision of decisions) {
      expect(Object.keys(decision as Record<string, unknown>).sort()).toEqual(
        expect.arrayContaining(['action', 'cost', 'day', 'operationKey', 'result']),
      );
    }
    expect(JSON.stringify(decisions)).not.toMatch(/private-access-token|signature|secret|filename|body/iu);
  });
});
