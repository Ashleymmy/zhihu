import {
  AllianceQuotaManager,
  type AllianceQuotaDecision,
  type AllianceQuotaPolicy,
  InMemoryAllianceQuotaStore,
  installAllianceQuotaManager,
} from '../../src/zhihu/allianceQuota';

export const TEST_ALLIANCE_QUOTA_POLICY: AllianceQuotaPolicy = Object.freeze({
  dailyBudget: 1_000,
  costs: Object.freeze({
    'POST /popularize_plan': 1,
    'POST /popularize_plans': 1,
    'POST /popularize_composition/v2': 1,
    'POST /popularize_compositions/v2': 1,
    'PUT /popularize_composition/v2/{composition_id}': 1,
    'GET /popularize_compositions': 1,
    'GET /data_report/real_time_data': 1,
  }),
});

export interface AllianceQuotaTestFixture {
  readonly manager: AllianceQuotaManager;
  readonly store: InMemoryAllianceQuotaStore;
  readonly decisions: AllianceQuotaDecision[];
  now(): number;
  setNow(value: number): void;
}

export function installAllianceQuotaTestFixture(options?: {
  readonly policy?: AllianceQuotaPolicy;
  readonly accessToken?: string;
  readonly now?: number;
  readonly leaseTtlMs?: number;
}): AllianceQuotaTestFixture {
  let currentTime = options?.now ?? Date.parse('2026-08-18T00:00:00.000Z');
  const decisions: AllianceQuotaDecision[] = [];
  const store = new InMemoryAllianceQuotaStore();
  const manager = new AllianceQuotaManager({
    policy: options?.policy ?? TEST_ALLIANCE_QUOTA_POLICY,
    store,
    accountToken: options?.accessToken ?? 'test-alliance-account-token',
    clock: () => currentTime,
    leaseTtlMs: options?.leaseTtlMs,
    decisionHook: (decision) => decisions.push(decision),
  });
  installAllianceQuotaManager(manager);
  return {
    manager,
    store,
    decisions,
    now: () => currentTime,
    setNow: (value) => {
      currentTime = value;
    },
  };
}
