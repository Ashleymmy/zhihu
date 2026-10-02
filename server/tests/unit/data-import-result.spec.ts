import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rows: vi.fn(), scope: vi.fn(), transaction: vi.fn() }));
vi.mock('../../src/db', () => ({ rows: mocks.rows, withTransaction: mocks.transaction }));
vi.mock('../../src/core/accounts', () => ({ assertDataScope: mocks.scope }));
import { readDataImportResult } from '../../src/modules/zhihu/services/data-import-result.service';
import { resolveLegacyAttributionScope, confirmDataImport } from '../../src/modules/zhihu/services/data-import.service';
import type { AuthUser } from '../../src/types';
const actor: AuthUser = {
  sub: '27',
  role: 'developer',
  adminDuty: 'all',
  parentId: null,
  username: 'developer',
  displayName: 'Developer',
  jti: 'test',
};
const batch = { id: '1', fileSha256: 'a'.repeat(64), status: 'confirmed' };
const metrics = [{ first_day: '2026-09-26', last_day: '2026-09-26', orders: '1', searches: '18', revenue_rows: 0 }];
beforeEach(() => {
  mocks.rows.mockReset();
  mocks.transaction.mockReset();
  mocks.scope.mockReset().mockResolvedValue({});
});

describe('persistent import progress', () => {
  it('does not mistake a confirmed file for completed attribution', async () => {
    mocks.rows.mockResolvedValueOnce(metrics).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    expect(await readDataImportResult(actor, batch)).toMatchObject({
      state: 'not_started',
      sourceOrders: '1',
      sourceSearches: '18',
      revenueProvided: false,
      retryAllowed: true,
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.rows.mock.calls.every(([sql]) => String(sql).trim().startsWith('SELECT'))).toBe(true);
  });
  it('does not allow continuing a preview or rejected batch', async () => {
    mocks.rows.mockResolvedValue(metrics);
    for (const status of ['preview', 'rejected'])
      expect(await readDataImportResult(actor, { ...batch, status })).toMatchObject({ retryAllowed: false });
    expect(mocks.rows).toHaveBeenCalledTimes(2);
  });
  it('does not offer import continuation to read-only finance staff', async () => {
    mocks.rows.mockResolvedValueOnce(metrics).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    expect(await readDataImportResult({ ...actor, role: 'admin', adminDuty: 'finance' }, batch)).toMatchObject({
      state: 'not_started',
      retryAllowed: false,
    });
  });
  it('keeps historical pending tasks distinct from processed records', async () => {
    mocks.rows
      .mockResolvedValueOnce(metrics)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ status: 'pending', total: 1 }]);
    expect(await readDataImportResult(actor, batch)).toMatchObject({
      state: 'legacy_pending',
      pendingRows: 1,
      retryAllowed: false,
    });
  });
  it('requires project selection when the same file has multiple project results', async () => {
    mocks.rows.mockResolvedValueOnce(metrics).mockResolvedValueOnce([{ id: '1' }, { id: '2' }]);
    expect(await readDataImportResult(actor, batch)).toMatchObject({
      state: 'needs_scope',
      retryAllowed: false,
      scope: null,
    });
  });
  it.each([
    ['processing', [{ processing_status: 'pending', total: 2 }], [], true],
    [
      'needs_attention',
      [{ processing_status: 'processed', total: 1 }],
      [{ reason_code: 'PRICE_MISSING', total: 1 }],
      false,
    ],
    [
      'needs_attention',
      [{ processing_status: 'exception', total: 1 }],
      [{ reason_code: 'CHANNEL_UNMAPPED', total: 1 }],
      false,
    ],
    ['analyzed', [{ processing_status: 'duplicate', total: 1 }], [], false],
  ])('reports %s from stored rows and unresolved issues', async (state, counts, issues, retryAllowed) => {
    mocks.rows
      .mockResolvedValueOnce(metrics)
      .mockResolvedValueOnce([{ id: '10', project_id: '1', account_id: '2' }])
      .mockResolvedValueOnce(counts)
      .mockResolvedValueOnce(issues);
    expect(await readDataImportResult(actor, batch)).toMatchObject({
      state,
      retryAllowed,
      scope: { projectId: '1', accountId: '2' },
      attributionBatchId: '10',
    });
    expect(mocks.scope).toHaveBeenCalledWith(actor, '1', '2', 'zhihu');
  });
  it('checks project access before reading matched rows', async () => {
    mocks.rows.mockResolvedValueOnce(metrics).mockResolvedValueOnce([{ id: '10', project_id: '1', account_id: '2' }]);
    mocks.scope.mockRejectedValue(new Error('无权访问该项目'));
    await expect(readDataImportResult(actor, batch)).rejects.toThrow('无权访问');
    expect(mocks.rows).toHaveBeenCalledTimes(2);
  });
});

describe('legacy import project access', () => {
  it.each(['developer', 'admin'] as const)(
    '%s uses staff project visibility even without project_members rows',
    async (role) => {
      mocks.rows.mockResolvedValueOnce([{ project_id: '1', account_id: '2', has_route: 0 }]).mockResolvedValueOnce([]);
      expect(await resolveLegacyAttributionScope({ ...actor, role })).toEqual({ projectId: '1', accountId: '2' });
      expect(mocks.rows.mock.calls[0][1]).toEqual([1, '27']);
    },
  );
  it('continues to scope non-staff access by membership', async () => {
    mocks.rows.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(resolveLegacyAttributionScope({ ...actor, role: 'creator' })).rejects.toThrow('没有可用');
    expect(mocks.rows.mock.calls[0][1]).toEqual([0, '27']);
  });
  it('does not mark a batch confirmed if its scope cannot be selected', async () => {
    mocks.rows
      .mockResolvedValueOnce([
        { project_id: '1', account_id: '1' },
        { project_id: '2', account_id: '2' },
      ])
      .mockResolvedValueOnce([]);
    await expect(confirmDataImport(actor, '1')).rejects.toThrow('存在多个知乎项目');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
