import { describe, expect, it } from 'vitest';
import { buildPlanPayload, type PlanPayloadInput } from '../../src/jobs/pushPlan';

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
});
