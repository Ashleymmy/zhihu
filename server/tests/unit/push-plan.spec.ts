import { beforeEach, describe, expect, it, vi } from 'vitest';
import { publicPlanSyncError } from '../../src/services/plans.service';
import { buildPlanPayload, pushPlan } from '../../src/jobs/pushPlan';
import type { PlanPayloadInput } from '../../src/jobs/pushPlan';
import { PLAN_UPDATE_UNSUPPORTED_ERROR } from '../../src/zhihu/allianceVersionPolicy';

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  rows: vi.fn(),
  zhihuPost: vi.fn(),
  zhihuSyncErrorDetail: vi.fn(() => '知乎同步失败，请稍后重试'),
}));

vi.mock('../../src/db', () => ({
  db: { query: mocks.dbQuery },
  rows: mocks.rows,
}));

vi.mock('../../src/zhihu/client', () => ({
  zhihuPost: mocks.zhihuPost,
  zhihuSyncErrorDetail: mocks.zhihuSyncErrorDetail,
}));

describe('知乎推广计划 payload', () => {
  const localPlan: PlanPayloadInput = {
    zhihu_task_id: 'task-1',
    channel_id: 'channel-1',
    second_channel_id: null,
    keyword: '测试关键词',
    landing_url: 'https://example.com/content',
    popularize_type: 0,
  };

  it('使用 content_url 映射本地 landing_url，并排除本地管理字段', () => {
    expect(buildPlanPayload(localPlan)).toEqual({
      task_id: 'task-1',
      channel_id: 'channel-1',
      content_url: 'https://example.com/content',
      popularize_type: 0,
      keyword: '测试关键词',
    });
  });

  it('仅在有值时发送二代渠道', () => {
    expect(buildPlanPayload({ ...localPlan, second_channel_id: 'second-1' })).toMatchObject({
      second_channel_id: 'second-1',
    });
    expect(buildPlanPayload(localPlan)).not.toHaveProperty('second_channel_id');
  });

  it('仅向前端暴露白名单化的同步失败原因', () => {
    expect(
      publicPlanSyncError('知乎接口失败（HTTP 400 / code 400402）：关键词，不能包含违规词词根，请更换关键词'),
    ).toBe('知乎接口失败（HTTP 400 / code 400402）：关键词不符合知乎规则，请更换关键词');
    expect(publicPlanSyncError('知乎接口失败（HTTP 403 / code 40317）：secret=sentinel')).toBe(
      '知乎接口失败（HTTP 403 / code 40317）',
    );
    expect(publicPlanSyncError('arbitrary sentinel')).toBe('知乎同步失败，请稍后重试');
  });
});

describe('知乎推广计划同步竞态保护', () => {
  const plan = {
    id: '1',
    status: 'pending',
    zhihu_plan_id: null,
    name: null,
    daily_budget: null,
    zhihu_task_id: 'task-1',
    channel_id: 'channel-1',
    second_channel_id: null,
    keyword: '新关键词',
    landing_url: 'https://example.com/content',
    popularize_type: 0,
  };

  beforeEach(() => {
    mocks.dbQuery.mockReset();
    mocks.rows.mockReset();
    mocks.zhihuPost.mockReset();
    mocks.zhihuSyncErrorDetail.mockClear();
    mocks.rows.mockResolvedValue([plan]);
  });

  it('A003-PLAN-001 rejects an undisclosed plan update locally with a fixed public error', async () => {
    const existingPlan = { ...plan, zhihu_plan_id: '2071265453767405652', sync_status: 'local' };
    mocks.rows.mockResolvedValue([existingPlan]);
    mocks.dbQuery.mockResolvedValueOnce([{ affectedRows: 1 }]);

    await expect(pushPlan({ planId: '1' })).resolves.toBeUndefined();

    expect(mocks.dbQuery).toHaveBeenCalledTimes(1);
    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("SET sync_status = 'failed', sync_error = ?"), [
      PLAN_UPDATE_UNSUPPORTED_ERROR,
      '1',
      '新关键词',
      '2071265453767405652',
    ]);
    expect(mocks.dbQuery.mock.calls[0][0]).toContain("sync_status IN ('local', 'failed')");
    expect(PLAN_UPDATE_UNSUPPORTED_ERROR).not.toMatch(/token|secret|2071265453767405652/i);
    expect(mocks.zhihuPost).not.toHaveBeenCalled();
  });

  it('A003-PLAN-002 treats an update claim race as a local no-op without upstream or synced writes', async () => {
    const existingPlan = { ...plan, zhihu_plan_id: '2071265453767405652', sync_status: 'failed' };
    mocks.rows.mockResolvedValue([existingPlan]);
    mocks.dbQuery.mockResolvedValueOnce([{ affectedRows: 0 }]);

    await expect(pushPlan({ planId: '1' })).resolves.toBeUndefined();

    expect(mocks.dbQuery).toHaveBeenCalledTimes(1);
    expect(mocks.dbQuery.mock.calls[0][0]).not.toContain("sync_status = 'synced'");
    expect(mocks.dbQuery.mock.calls[0][1]).toEqual([
      PLAN_UPDATE_UNSUPPORTED_ERROR,
      '1',
      '新关键词',
      '2071265453767405652',
    ]);
    expect(mocks.zhihuPost).not.toHaveBeenCalled();
  });

  it('未抢到当前 local/failed 状态时不调用知乎接口', async () => {
    mocks.dbQuery.mockResolvedValueOnce([{ affectedRows: 0 }]);

    await pushPlan({ planId: '1' });

    expect(mocks.zhihuPost).not.toHaveBeenCalled();
    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("sync_status IN ('local', 'failed')"), [
      '1',
      '新关键词',
    ]);
  });

  it('成功结果只更新相同关键词且仍为 syncing 的计划', async () => {
    mocks.dbQuery.mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([{ affectedRows: 1 }]);
    mocks.zhihuPost.mockResolvedValue({ data: { plan_id: 'upstream-1' } });

    await pushPlan({ planId: '1' });

    expect(mocks.dbQuery).toHaveBeenLastCalledWith(
      expect.stringContaining("WHERE id = ? AND keyword = ? AND sync_status = 'syncing'"),
      ['upstream-1', '1', '新关键词'],
    );
  });

  it('失败结果不覆盖已换关键词或已完成的计划', async () => {
    const upstreamError = new Error('upstream sentinel');
    mocks.dbQuery.mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([{ affectedRows: 0 }]);
    mocks.zhihuPost.mockRejectedValue(upstreamError);

    await expect(pushPlan({ planId: '1' })).rejects.toBe(upstreamError);

    expect(mocks.dbQuery).toHaveBeenLastCalledWith(
      expect.stringContaining("WHERE id = ? AND keyword = ? AND sync_status = 'syncing'"),
      ['知乎同步失败，请稍后重试', '1', '新关键词'],
    );
  });
});
