import { createHash, randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import type { AllianceOperationKey } from './allianceContracts';

export const ALLIANCE_QUOTA_KEY_PREFIX = 'alliance:quota:v1' as const;
export const ALLIANCE_QUOTA_DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000;
const ALLIANCE_QUOTA_REDIS_READY_TIMEOUT_MS = 5_000;
const ALLIANCE_QUOTA_RETENTION_MS = 60 * 60 * 1000;

export const ALLIANCE_QUOTA_OPERATION_KEYS = Object.freeze([
  'POST /popularize_plan',
  'POST /popularize_plans',
  'POST /popularize_composition/v2',
  'POST /popularize_compositions/v2',
  'PUT /popularize_composition/v2/{composition_id}',
  'GET /popularize_compositions',
  'GET /data_report/real_time_data',
  'GET /data_report/daily_data',
] satisfies readonly AllianceOperationKey[]);

/** 配额只覆盖经联盟代理网关的端点；内容域只读端点（盐选/榜单等）不进配额 */
export type AllianceQuotaOperationKey = (typeof ALLIANCE_QUOTA_OPERATION_KEYS)[number];

const operationKeySet = new Set<string>(ALLIANCE_QUOTA_OPERATION_KEYS);
const reservationIdPattern = /^[A-Za-z0-9_-]{1,128}$/u;

export interface AllianceQuotaPolicy {
  readonly dailyBudget: number;
  readonly costs: Readonly<Record<AllianceQuotaOperationKey, number>>;
}

export interface AllianceQuotaReservation {
  readonly id: string;
  readonly key: string;
  readonly scope: string;
  readonly operationKey: AllianceOperationKey;
  readonly day: string;
  readonly cost: number;
  readonly expiresAt: number;
}

export interface AllianceQuotaDenied {
  readonly kind: 'denied';
  readonly reason: 'exhausted';
}

export type AllianceQuotaReserveResult = AllianceQuotaReservation | AllianceQuotaDenied;
export type AllianceQuotaSettlementResult = 0 | 1;

export interface AllianceQuotaStoreReserveInput extends AllianceQuotaReservation {
  readonly dailyBudget: number;
  readonly now: number;
}

export interface AllianceQuotaStore {
  reserve(input: AllianceQuotaStoreReserveInput): Promise<AllianceQuotaReserveResult>;
  confirm(reservationId: string, now?: number): Promise<AllianceQuotaSettlementResult>;
  release(reservationId: string, now?: number): Promise<AllianceQuotaSettlementResult>;
  close(): Promise<void>;
}

export type AllianceQuotaDecisionAction = 'reserve' | 'confirm' | 'release' | 'reject';

export interface AllianceQuotaDecision {
  readonly action: AllianceQuotaDecisionAction;
  readonly operationKey: AllianceOperationKey;
  readonly day: string;
  readonly cost: number;
  readonly result: 'allowed' | 'confirmed' | 'released' | 'exhausted' | 'failed';
  readonly reservationId?: string;
}

export type AllianceQuotaDecisionHook = (decision: AllianceQuotaDecision) => void;

export class AllianceQuotaConfigurationError extends Error {
  constructor() {
    super('alliance quota configuration is invalid');
  }
}

export class AllianceQuotaStoreError extends Error {
  constructor() {
    super('alliance quota store is unavailable');
  }
}

export class AllianceQuotaDeniedError extends Error {
  constructor(
    public readonly operationKey: AllianceOperationKey,
    public readonly day: string,
    public readonly cost: number,
  ) {
    super('alliance quota exhausted');
  }
}

function configurationError(): never {
  throw new AllianceQuotaConfigurationError();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactOwnKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function assertNoDuplicateJsonKeys(source: string): void {
  let offset = 0;

  const skipWhitespace = () => {
    while (/\s/u.test(source[offset] ?? '')) offset += 1;
  };

  const parseString = (): string => {
    const start = offset;
    if (source[offset] !== '"') configurationError();
    offset += 1;
    while (offset < source.length) {
      const character = source[offset];
      if (character === '\\') {
        offset += 2;
        continue;
      }
      offset += 1;
      if (character === '"') {
        try {
          return JSON.parse(source.slice(start, offset)) as string;
        } catch {
          configurationError();
        }
      }
    }
    configurationError();
  };

  const parsePrimitive = () => {
    const start = offset;
    while (offset < source.length && !/[\s,\]}]/u.test(source[offset] ?? '')) offset += 1;
    try {
      JSON.parse(source.slice(start, offset));
    } catch {
      configurationError();
    }
  };

  const parseValue = (): void => {
    skipWhitespace();
    const character = source[offset];
    if (character === '{') {
      offset += 1;
      skipWhitespace();
      const keys = new Set<string>();
      if (source[offset] === '}') {
        offset += 1;
        return;
      }
      while (offset < source.length) {
        skipWhitespace();
        const key = parseString();
        if (keys.has(key)) configurationError();
        keys.add(key);
        skipWhitespace();
        if (source[offset] !== ':') configurationError();
        offset += 1;
        parseValue();
        skipWhitespace();
        if (source[offset] === '}') {
          offset += 1;
          return;
        }
        if (source[offset] !== ',') configurationError();
        offset += 1;
      }
      configurationError();
    }
    if (character === '[') {
      offset += 1;
      skipWhitespace();
      if (source[offset] === ']') {
        offset += 1;
        return;
      }
      while (offset < source.length) {
        parseValue();
        skipWhitespace();
        if (source[offset] === ']') {
          offset += 1;
          return;
        }
        if (source[offset] !== ',') configurationError();
        offset += 1;
      }
      configurationError();
    }
    if (character === '"') {
      parseString();
      return;
    }
    parsePrimitive();
  };

  parseValue();
  skipWhitespace();
  if (offset !== source.length) configurationError();
}

function parseStrictJson(source: string): unknown {
  if (source.trim() === '') configurationError();
  assertNoDuplicateJsonKeys(source);
  try {
    return JSON.parse(source) as unknown;
  } catch {
    configurationError();
  }
}

export function parseAllianceQuotaPolicy(input: unknown): AllianceQuotaPolicy {
  const candidate = typeof input === 'string' ? parseStrictJson(input) : input;
  if (!isPlainRecord(candidate) || !exactOwnKeys(candidate, ['dailyBudget', 'costs'])) configurationError();
  if (!positiveSafeInteger(candidate.dailyBudget) || !isPlainRecord(candidate.costs)) configurationError();

  const costKeys = Object.keys(candidate.costs);
  if (
    costKeys.length !== ALLIANCE_QUOTA_OPERATION_KEYS.length ||
    costKeys.some((key) => !operationKeySet.has(key)) ||
    ALLIANCE_QUOTA_OPERATION_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(candidate.costs, key))
  ) {
    configurationError();
  }

  const costs = {} as Record<AllianceOperationKey, number>;
  for (const operationKey of ALLIANCE_QUOTA_OPERATION_KEYS) {
    const cost = candidate.costs[operationKey];
    if (!positiveSafeInteger(cost)) configurationError();
    costs[operationKey] = cost;
  }

  return Object.freeze({ dailyBudget: candidate.dailyBudget, costs: Object.freeze(costs) });
}

const policyEnvironmentKeys = [
  'ALLIANCE_QUOTA_POLICY_JSON',
  'ALLIANCE_QUOTA_POLICY',
  'ZHIHU_ALLIANCE_QUOTA_POLICY_JSON',
  'ZHIHU_ALLIANCE_QUOTA_POLICY',
] as const;

export function loadAllianceQuotaPolicy(environment: NodeJS.ProcessEnv = process.env): AllianceQuotaPolicy {
  const supplied = policyEnvironmentKeys
    .map((key) => environment[key])
    .filter((value): value is string => value !== undefined);
  if (supplied.length === 0 || supplied.some((value) => value.trim() === '')) configurationError();
  if (new Set(supplied).size !== 1) configurationError();
  return parseAllianceQuotaPolicy(supplied[0]);
}

export function isAllianceQuotaOperationKey(value: unknown): value is AllianceQuotaOperationKey {
  return typeof value === 'string' && operationKeySet.has(value);
}

export function allianceQuotaAccountScope(accessToken: unknown): string {
  if (typeof accessToken !== 'string' || accessToken.length === 0 || Buffer.byteLength(accessToken, 'utf8') > 16_384) {
    configurationError();
  }
  return createHash('sha256').update(accessToken, 'utf8').digest('hex');
}

export function allianceQuotaUtcDay(now: Date | number = Date.now()): string {
  const timestamp = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(timestamp) || !Number.isSafeInteger(timestamp)) configurationError();
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function buildAllianceQuotaKey(scope: string, day: string, operationKey: AllianceOperationKey): string {
  if (
    !/^[a-f0-9]{64}$/u.test(scope) ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(day) ||
    !isAllianceQuotaOperationKey(operationKey)
  ) {
    configurationError();
  }
  return `${ALLIANCE_QUOTA_KEY_PREFIX}:${scope}:${day}`;
}

export function buildAllianceQuotaBucketKey(scope: string, day: string): string {
  if (!/^[a-f0-9]{64}$/u.test(scope) || !/^\d{4}-\d{2}-\d{2}$/u.test(day)) configurationError();
  return `${ALLIANCE_QUOTA_KEY_PREFIX}:${scope}:${day}`;
}

function denied(): AllianceQuotaDenied {
  return Object.freeze({ kind: 'denied', reason: 'exhausted' });
}

export function isAllianceQuotaDenied(value: AllianceQuotaReserveResult): value is AllianceQuotaDenied {
  return 'kind' in value && value.kind === 'denied';
}

interface MemoryBucket {
  used: number;
  reserved: number;
}

interface MemoryReservation {
  readonly value: AllianceQuotaReservation;
  readonly bucketKey: string;
  status: 'reserved' | 'confirmed' | 'released';
}

export class InMemoryAllianceQuotaStore implements AllianceQuotaStore {
  private readonly buckets = new Map<string, MemoryBucket>();
  private readonly reservations = new Map<string, MemoryReservation>();

  private cleanup(now: number): void {
    for (const reservation of this.reservations.values()) {
      if (reservation.status !== 'reserved' || reservation.value.expiresAt > now) continue;
      const bucket = this.buckets.get(reservation.bucketKey);
      if (bucket) bucket.reserved = Math.max(0, bucket.reserved - reservation.value.cost);
      reservation.status = 'released';
    }
  }

  async reserve(input: AllianceQuotaStoreReserveInput): Promise<AllianceQuotaReserveResult> {
    this.cleanup(input.now);
    if (
      this.reservations.has(input.id) ||
      !positiveSafeInteger(input.cost) ||
      !positiveSafeInteger(input.dailyBudget) ||
      input.expiresAt <= input.now
    ) {
      throw new AllianceQuotaStoreError();
    }

    const bucketKey = buildAllianceQuotaBucketKey(input.scope, input.day);
    const key = buildAllianceQuotaKey(input.scope, input.day, input.operationKey);
    const bucket = this.buckets.get(bucketKey) ?? { used: 0, reserved: 0 };
    const available = input.dailyBudget - bucket.used - bucket.reserved;
    if (available < input.cost) return denied();

    bucket.reserved += input.cost;
    this.buckets.set(bucketKey, bucket);
    const value: AllianceQuotaReservation = Object.freeze({
      id: input.id,
      key,
      scope: input.scope,
      operationKey: input.operationKey,
      day: input.day,
      cost: input.cost,
      expiresAt: input.expiresAt,
    });
    this.reservations.set(input.id, { value, bucketKey, status: 'reserved' });
    return value;
  }

  async confirm(reservationId: string, now = Date.now()): Promise<AllianceQuotaSettlementResult> {
    this.cleanup(now);
    const reservation = this.reservations.get(reservationId);
    if (!reservation || reservation.status !== 'reserved') return 0;
    const bucket = this.buckets.get(reservation.bucketKey);
    if (!bucket) throw new AllianceQuotaStoreError();
    bucket.reserved = Math.max(0, bucket.reserved - reservation.value.cost);
    bucket.used += reservation.value.cost;
    reservation.status = 'confirmed';
    return 1;
  }

  async release(reservationId: string, now = Date.now()): Promise<AllianceQuotaSettlementResult> {
    this.cleanup(now);
    const reservation = this.reservations.get(reservationId);
    if (!reservation || reservation.status !== 'reserved') return 0;
    const bucket = this.buckets.get(reservation.bucketKey);
    if (bucket) bucket.reserved = Math.max(0, bucket.reserved - reservation.value.cost);
    reservation.status = 'released';
    return 1;
  }

  snapshot(key: string): Readonly<{ used: number; reserved: number }> {
    const bucket = this.buckets.get(key) ?? { used: 0, reserved: 0 };
    return Object.freeze({ ...bucket });
  }

  async close(): Promise<void> {
    this.buckets.clear();
    this.reservations.clear();
  }
}

export interface AllianceQuotaRedisClient {
  eval(script: string, numberOfKeys: number, ...arguments_: string[]): Promise<unknown>;
  on?(event: 'error', listener: (error: unknown) => void): unknown;
  connect?(): Promise<unknown>;
  readonly status?: string;
  quit?(): Promise<unknown>;
  disconnect?(): void;
}

export const ALLIANCE_QUOTA_RESERVE_SCRIPT = `
local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', ARGV[5])
for _, reservationKey in ipairs(expired) do
  local status = redis.call('HGET', reservationKey, 'status')
  if status == 'reserved' then
    local staleCost = tonumber(redis.call('HGET', reservationKey, 'cost') or '0')
    local reserved = tonumber(redis.call('HGET', KEYS[1], 'reserved') or '0')
    if staleCost > 0 then
      redis.call('HSET', KEYS[1], 'reserved', math.max(0, reserved - staleCost))
    end
  end
  redis.call('DEL', reservationKey)
  redis.call('ZREM', KEYS[2], reservationKey)
end

local budget = tonumber(ARGV[1])
local cost = tonumber(ARGV[2])
local used = tonumber(redis.call('HGET', KEYS[1], 'used') or '0')
local reserved = tonumber(redis.call('HGET', KEYS[1], 'reserved') or '0')
if not budget or not cost or budget <= 0 or cost <= 0 or not used or not reserved or used < 0 or reserved < 0 then
  return redis.error_reply('invalid alliance quota state')
end
if redis.call('EXISTS', KEYS[3]) == 1 then
  return redis.error_reply('duplicate alliance quota reservation')
end
if cost > budget - used - reserved then
  return {0}
end

redis.call('HSETNX', KEYS[1], 'used', 0)
redis.call('HINCRBY', KEYS[1], 'reserved', cost)
redis.call('HSET', KEYS[3], 'status', 'reserved', 'cost', cost, 'expiresAt', ARGV[4])
redis.call('ZADD', KEYS[2], ARGV[4], KEYS[3])
redis.call('EXPIRE', KEYS[1], ARGV[6])
redis.call('EXPIRE', KEYS[2], ARGV[6])
redis.call('EXPIRE', KEYS[3], ARGV[7])
return {1, ARGV[3], ARGV[4]}
`;

export const ALLIANCE_QUOTA_CONFIRM_SCRIPT = `
local status = redis.call('HGET', KEYS[3], 'status')
if not status or status ~= 'reserved' then
  return 0
end
local cost = tonumber(redis.call('HGET', KEYS[3], 'cost') or '0')
local expiresAt = tonumber(redis.call('HGET', KEYS[3], 'expiresAt') or '0')
local reserved = tonumber(redis.call('HGET', KEYS[1], 'reserved') or '0')
redis.call('HSET', KEYS[1], 'reserved', math.max(0, reserved - cost))
redis.call('ZREM', KEYS[2], ARGV[2])
if expiresAt <= tonumber(ARGV[1]) then
  redis.call('HSET', KEYS[3], 'status', 'released')
  return 0
end
redis.call('HINCRBY', KEYS[1], 'used', cost)
redis.call('HSET', KEYS[3], 'status', 'confirmed')
return 1
`;

export const ALLIANCE_QUOTA_RELEASE_SCRIPT = `
local status = redis.call('HGET', KEYS[3], 'status')
if not status or status ~= 'reserved' then
  return 0
end
local cost = tonumber(redis.call('HGET', KEYS[3], 'cost') or '0')
local reserved = tonumber(redis.call('HGET', KEYS[1], 'reserved') or '0')
redis.call('HSET', KEYS[1], 'reserved', math.max(0, reserved - cost))
redis.call('ZREM', KEYS[2], ARGV[2])
redis.call('HSET', KEYS[3], 'status', 'released')
return 1
`;

export interface RedisAllianceQuotaStoreOptions {
  readonly client?: AllianceQuotaRedisClient;
  readonly url?: string;
  readonly retentionMs?: number;
}

function validDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 7 * 24 * 60 * 60 * 1000;
}

function redisResultArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new AllianceQuotaStoreError();
  return value;
}

function resultInteger(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed)) throw new AllianceQuotaStoreError();
  return parsed;
}

function secondsUntilBucketExpiry(day: string, now: number, retentionMs: number, expiresAt: number): number {
  const endOfDay = Date.parse(`${day}T00:00:00.000Z`) + 24 * 60 * 60 * 1000;
  const dayRetention = Math.ceil((endOfDay + retentionMs - now) / 1000);
  const leaseRetention = Math.ceil((expiresAt + retentionMs - now) / 1000);
  return Math.max(1, dayRetention, leaseRetention);
}

export class RedisAllianceQuotaStore implements AllianceQuotaStore {
  private readonly client: AllianceQuotaRedisClient;
  private readonly ownsClient: boolean;
  private readonly retentionMs: number;
  private readonly reservations = new Map<string, AllianceQuotaReservation>();
  private ready = false;
  private readyFlight?: Promise<void>;

  constructor(options: RedisAllianceQuotaStoreOptions) {
    if (!validDuration(options.retentionMs ?? ALLIANCE_QUOTA_RETENTION_MS)) configurationError();
    this.retentionMs = options.retentionMs ?? ALLIANCE_QUOTA_RETENTION_MS;
    if (options.client) {
      this.client = options.client;
      this.ownsClient = false;
      return;
    }
    if (typeof options.url !== 'string' || options.url.trim() === '') configurationError();
    const client = new Redis(options.url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    client.on('error', () => undefined);
    this.client = client;
    this.ownsClient = true;
  }

  async reserve(input: AllianceQuotaStoreReserveInput): Promise<AllianceQuotaReserveResult> {
    if (
      !positiveSafeInteger(input.cost) ||
      !positiveSafeInteger(input.dailyBudget) ||
      !Number.isSafeInteger(input.now) ||
      !Number.isSafeInteger(input.expiresAt) ||
      input.expiresAt <= input.now ||
      !reservationIdPattern.test(input.id)
    ) {
      throw new AllianceQuotaStoreError();
    }
    const bucketKey = buildAllianceQuotaBucketKey(input.scope, input.day);
    const key = buildAllianceQuotaKey(input.scope, input.day, input.operationKey);
    const reservationKey = `${key}:reservation:${input.id}`;
    const leasesKey = `${bucketKey}:leases`;
    const bucketTtl = secondsUntilBucketExpiry(input.day, input.now, this.retentionMs, input.expiresAt);
    const reservationTtl = bucketTtl;
    try {
      await this.ensureReady();
      const result = redisResultArray(
        await this.client.eval(
          ALLIANCE_QUOTA_RESERVE_SCRIPT,
          3,
          bucketKey,
          leasesKey,
          reservationKey,
          String(input.dailyBudget),
          String(input.cost),
          input.id,
          String(input.expiresAt),
          String(input.now),
          String(bucketTtl),
          String(reservationTtl),
        ),
      );
      const allowed = resultInteger(result[0]);
      if (allowed === 0) return denied();
      if (allowed !== 1 || result[1] !== input.id || resultInteger(result[2]) !== input.expiresAt) {
        throw new AllianceQuotaStoreError();
      }
      const reservation = Object.freeze({
        id: input.id,
        key,
        scope: input.scope,
        operationKey: input.operationKey,
        day: input.day,
        cost: input.cost,
        expiresAt: input.expiresAt,
      });
      this.reservations.set(input.id, reservation);
      return reservation;
    } catch (error) {
      if (error instanceof AllianceQuotaStoreError) throw error;
      throw new AllianceQuotaStoreError();
    }
  }

  async confirm(reservationId: string, now = Date.now()): Promise<AllianceQuotaSettlementResult> {
    return this.settle(ALLIANCE_QUOTA_CONFIRM_SCRIPT, reservationId, now);
  }

  async release(reservationId: string, now = Date.now()): Promise<AllianceQuotaSettlementResult> {
    return this.settle(ALLIANCE_QUOTA_RELEASE_SCRIPT, reservationId, now);
  }

  private async settle(script: string, reservationId: string, now: number): Promise<AllianceQuotaSettlementResult> {
    if (!reservationIdPattern.test(reservationId) || !Number.isSafeInteger(now)) {
      throw new AllianceQuotaStoreError();
    }
    const reservation = this.reservations.get(reservationId);
    if (!reservation) return 0;
    const result = await this.evaluateSettlement(script, reservation, now);
    this.reservations.delete(reservationId);
    return result;
  }

  async settleReservation(
    action: 'confirm' | 'release',
    reservation: AllianceQuotaReservation,
    now = Date.now(),
  ): Promise<AllianceQuotaSettlementResult> {
    const script = action === 'confirm' ? ALLIANCE_QUOTA_CONFIRM_SCRIPT : ALLIANCE_QUOTA_RELEASE_SCRIPT;
    const result = await this.evaluateSettlement(script, reservation, now);
    this.reservations.delete(reservation.id);
    return result;
  }

  private async evaluateSettlement(
    script: string,
    reservation: AllianceQuotaReservation,
    now: number,
  ): Promise<AllianceQuotaSettlementResult> {
    const bucketKey = buildAllianceQuotaBucketKey(reservation.scope, reservation.day);
    const leasesKey = `${bucketKey}:leases`;
    const key = buildAllianceQuotaKey(reservation.scope, reservation.day, reservation.operationKey);
    const reservationKey = `${key}:reservation:${reservation.id}`;
    try {
      await this.ensureReady();
      const result = await this.client.eval(
        script,
        3,
        bucketKey,
        leasesKey,
        reservationKey,
        String(now),
        reservationKey,
      );
      const resultIntegerValue = resultInteger(result);
      if (resultIntegerValue !== 0 && resultIntegerValue !== 1) throw new AllianceQuotaStoreError();
      return resultIntegerValue;
    } catch (error) {
      if (error instanceof AllianceQuotaStoreError) throw error;
      throw new AllianceQuotaStoreError();
    }
  }

  private async ensureReady(): Promise<void> {
    const connect = this.client.connect;
    if (!connect || this.client.status === 'ready' || (this.client.status === undefined && this.ready)) return;
    if (!this.readyFlight) {
      this.readyFlight = this.connectWithTimeout(connect)
        .then(() => {
          if (this.client.status !== undefined && this.client.status !== 'ready') {
            throw new Error('alliance quota redis did not become ready');
          }
          this.ready = true;
        })
        .catch((error: unknown) => {
          this.ready = false;
          throw error;
        })
        .finally(() => {
          this.readyFlight = undefined;
        });
    }
    await this.readyFlight;
  }

  private async connectWithTimeout(connect: () => Promise<unknown>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve()
          .then(() => connect.call(this.client))
          .then(() => undefined),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('alliance quota redis readiness timeout')),
            ALLIANCE_QUOTA_REDIS_READY_TIMEOUT_MS,
          );
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    this.reservations.clear();
    if (!this.ownsClient) return;
    try {
      if (this.client.quit) await this.client.quit();
      else this.client.disconnect?.();
    } catch {
      this.client.disconnect?.();
    }
  }
}

interface ReservationAwareStore extends AllianceQuotaStore {
  settleReservation?(
    action: 'confirm' | 'release',
    reservation: AllianceQuotaReservation,
    now?: number,
  ): Promise<AllianceQuotaSettlementResult>;
}

export interface AllianceQuotaManagerOptions {
  readonly policy: AllianceQuotaPolicy;
  readonly store: AllianceQuotaStore;
  readonly accountToken: string | (() => string);
  readonly clock?: () => number;
  readonly leaseTtlMs?: number;
  readonly decisionHook?: AllianceQuotaDecisionHook;
}

export class AllianceQuotaManager {
  readonly policy: AllianceQuotaPolicy;
  readonly store: AllianceQuotaStore;
  private readonly accountToken: () => string;
  private readonly clock: () => number;
  private readonly leaseTtlMs: number;
  private readonly decisionHook?: AllianceQuotaDecisionHook;
  private readonly reservations = new Map<string, AllianceQuotaReservation>();

  constructor(options: AllianceQuotaManagerOptions) {
    this.policy = parseAllianceQuotaPolicy(options.policy);
    this.store = options.store;
    this.accountToken =
      typeof options.accountToken === 'function' ? options.accountToken : () => options.accountToken as string;
    this.clock = options.clock ?? Date.now;
    this.leaseTtlMs = options.leaseTtlMs ?? ALLIANCE_QUOTA_DEFAULT_LEASE_TTL_MS;
    if (!validDuration(this.leaseTtlMs)) configurationError();
    this.decisionHook = options.decisionHook;
  }

  private emit(decision: AllianceQuotaDecision): void {
    if (!this.decisionHook) return;
    try {
      this.decisionHook(Object.freeze({ ...decision }));
    } catch {
      // Observability must never change quota enforcement.
    }
  }

  async reserve(operationKey: unknown): Promise<AllianceQuotaReservation> {
    if (!isAllianceQuotaOperationKey(operationKey)) configurationError();
    const cost = this.policy.costs[operationKey];
    if (!positiveSafeInteger(cost)) configurationError();
    const now = this.clock();
    if (!Number.isSafeInteger(now)) configurationError();
    for (const [reservationId, reservation] of this.reservations) {
      if (reservation.expiresAt <= now) this.reservations.delete(reservationId);
    }
    const day = allianceQuotaUtcDay(now);
    const scope = allianceQuotaAccountScope(this.accountToken());
    const id = randomUUID();
    const key = buildAllianceQuotaKey(scope, day, operationKey);
    const expiresAt = now + this.leaseTtlMs;
    if (!Number.isSafeInteger(expiresAt)) configurationError();
    const input: AllianceQuotaStoreReserveInput = {
      id,
      key,
      scope,
      operationKey,
      day,
      cost,
      expiresAt,
      dailyBudget: this.policy.dailyBudget,
      now,
    };
    let result: AllianceQuotaReserveResult;
    try {
      result = await this.store.reserve(input);
    } catch {
      this.emit({ action: 'reject', operationKey, day, cost, result: 'failed' });
      throw new AllianceQuotaStoreError();
    }
    if (isAllianceQuotaDenied(result)) {
      this.emit({ action: 'reject', operationKey, day, cost, result: 'exhausted' });
      throw new AllianceQuotaDeniedError(operationKey, day, cost);
    }
    this.reservations.set(result.id, result);
    this.emit({
      action: 'reserve',
      operationKey,
      day,
      cost,
      result: 'allowed',
      reservationId: result.id,
    });
    return result;
  }

  async confirm(reservation: AllianceQuotaReservation): Promise<void> {
    await this.settle('confirm', reservation);
  }

  async release(reservation: AllianceQuotaReservation): Promise<void> {
    await this.settle('release', reservation);
  }

  private async settle(action: 'confirm' | 'release', reservation: AllianceQuotaReservation): Promise<void> {
    const known = this.reservations.get(reservation.id);
    if (!known || known !== reservation) return;
    const now = this.clock();
    try {
      const store = this.store as ReservationAwareStore;
      const result = store.settleReservation
        ? await store.settleReservation(action, reservation, now)
        : action === 'confirm'
          ? await store.confirm(reservation.id, now)
          : await store.release(reservation.id, now);
      if (action === 'confirm' && result !== 1) throw new AllianceQuotaStoreError();
    } catch {
      this.emit({
        action,
        operationKey: reservation.operationKey,
        day: reservation.day,
        cost: reservation.cost,
        result: 'failed',
        reservationId: reservation.id,
      });
      throw new AllianceQuotaStoreError();
    }
    this.reservations.delete(reservation.id);
    this.emit({
      action,
      operationKey: reservation.operationKey,
      day: reservation.day,
      cost: reservation.cost,
      result: action === 'confirm' ? 'confirmed' : 'released',
      reservationId: reservation.id,
    });
  }

  lease(reservation: AllianceQuotaReservation): AllianceQuotaLease {
    return new AllianceQuotaLease(this, reservation);
  }

  async close(): Promise<void> {
    this.reservations.clear();
    await this.store.close();
  }
}

export type AllianceQuotaLeaseState = 'reserved' | 'confirmed' | 'released';

export class AllianceQuotaLease {
  private currentState: AllianceQuotaLeaseState = 'reserved';
  private pending?: Promise<void>;

  constructor(
    private readonly manager: AllianceQuotaManager,
    readonly reservation: AllianceQuotaReservation,
  ) {}

  get state(): AllianceQuotaLeaseState {
    return this.currentState;
  }

  async confirm(): Promise<void> {
    await this.transition('confirmed');
  }

  async release(): Promise<void> {
    await this.transition('released');
  }

  private async transition(target: Exclude<AllianceQuotaLeaseState, 'reserved'>): Promise<void> {
    if (this.currentState !== 'reserved') return;
    if (this.pending) return this.pending;
    this.pending = (
      target === 'confirmed' ? this.manager.confirm(this.reservation) : this.manager.release(this.reservation)
    ).then(() => {
      this.currentState = target;
    });
    try {
      await this.pending;
    } finally {
      this.pending = undefined;
    }
  }
}

let installedManager: AllianceQuotaManager | undefined;

export function installAllianceQuotaManager(manager: AllianceQuotaManager): void {
  installedManager = manager;
}

export function getInstalledAllianceQuotaManager(): AllianceQuotaManager | undefined {
  return installedManager;
}

export async function resetAllianceQuotaManager(): Promise<void> {
  const manager = installedManager;
  installedManager = undefined;
  await manager?.close();
}

export function createRedisAllianceQuotaManager(options: {
  readonly redisUrl: string;
  readonly accessToken: string | (() => string);
  readonly environment?: NodeJS.ProcessEnv;
  readonly decisionHook?: AllianceQuotaDecisionHook;
  readonly leaseTtlMs?: number;
}): AllianceQuotaManager {
  const policy = loadAllianceQuotaPolicy(options.environment);
  return new AllianceQuotaManager({
    policy,
    store: new RedisAllianceQuotaStore({ url: options.redisUrl }),
    accountToken: options.accessToken,
    decisionHook: options.decisionHook,
    leaseTtlMs: options.leaseTtlMs,
  });
}
