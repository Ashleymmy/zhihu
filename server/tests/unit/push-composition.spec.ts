import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCompositionPayload, pushComposition } from '../../src/jobs/pushComposition';

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  rows: vi.fn(),
  zhihuPost: vi.fn(),
  zhihuPut: vi.fn(),
  zhihuSyncErrorDetail: vi.fn(() => '知乎同步失败，请稍后重试'),
}));

vi.mock('../../src/db', () => ({
  db: { query: mocks.dbQuery },
  rows: mocks.rows,
}));

vi.mock('../../src/zhihu/client', () => ({
  zhihuPost: mocks.zhihuPost,
  zhihuPut: mocks.zhihuPut,
  zhihuSyncErrorDetail: mocks.zhihuSyncErrorDetail,
}));

const item = {
  id: '1',
  zhihu_composition_id: null,
  zhihu_plan_id: '2071265453767405652',
  channel_id: '2067662706400834870',
  media_type: 'KOC定向',
  media_account: '测试账号',
  composition_type: 0,
  composition_sub_type: 11,
  promo_url: 'https://example.com/content',
  release_time: new Date('2026-08-13T08:05:00.000Z'),
  status: 'pending',
  sync_status: 'local',
  plan_sync_status: 'synced',
};

describe('知乎推广作品 v2 payload', () => {
  it('映射完整字段并将发布时间转换为秒级时间戳', () => {
    expect(buildCompositionPayload(item)).toEqual({
      plan_id: '2071265453767405652',
      channel_id: '2067662706400834870',
      media_type: 'KOC定向',
      media_account: '测试账号',
      composition_type: 0,
      composition_sub_type: 11,
      composition_url: 'https://example.com/content',
      release_time: 1786608300,
    });
    expect(buildCompositionPayload(item)).not.toHaveProperty('promo_url');
    expect(buildCompositionPayload(item)).not.toHaveProperty('title');
  });
});

describe('知乎推广作品同步', () => {
  beforeEach(() => {
    mocks.dbQuery.mockReset();
    mocks.rows.mockReset();
    mocks.zhihuPost.mockReset();
    mocks.zhihuPut.mockReset();
    mocks.rows.mockResolvedValue([item]);
  });

  it('成功时使用精确计划 ID 并保存精确作品 ID', async () => {
    mocks.dbQuery.mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([{ affectedRows: 1 }]);
    mocks.zhihuPost.mockResolvedValue({ data: { composition_id: '2071266138193975100' } });

    await pushComposition({ compositionId: '1' });

    expect(mocks.zhihuPost).toHaveBeenCalledWith(
      '/alliance/api/popularize_composition/v2',
      expect.objectContaining({ plan_id: '2071265453767405652' }),
    );
    expect(mocks.dbQuery).toHaveBeenLastCalledWith(
      expect.stringContaining("WHERE id = ? AND sync_status = 'syncing'"),
      ['2071266138193975100', '1'],
    );
  });

  it('未抢到 local/failed 状态时不调用知乎接口', async () => {
    mocks.dbQuery.mockResolvedValueOnce([{ affectedRows: 0 }]);
    await pushComposition({ compositionId: '1' });
    expect(mocks.zhihuPost).not.toHaveBeenCalled();
    expect(mocks.zhihuPut).not.toHaveBeenCalled();
  });

  it('计划尚未同步时本地失败且不调用知乎接口', async () => {
    mocks.rows.mockResolvedValue([{ ...item, zhihu_plan_id: null, plan_sync_status: 'syncing' }]);
    mocks.dbQuery.mockResolvedValueOnce([{ affectedRows: 1 }]).mockResolvedValueOnce([{ affectedRows: 1 }]);
    await pushComposition({ compositionId: '1' });
    expect(mocks.zhihuPost).not.toHaveBeenCalled();
    expect(mocks.dbQuery).toHaveBeenLastCalledWith(
      expect.stringContaining("sync_status = 'failed'"),
      ['推广计划尚未同步成功，请稍后重试', '1'],
    );
  });
});
