import { listOf, normalizeChannel, normalizeTask } from '../../src/jobs/syncCatalog';

describe('知乎渠道与任务响应归一化', () => {
  it('兼容 success/data 数组和裸数组', () => {
    const item = { id: '1' };
    expect(listOf({ success: true, data: [item] })).toEqual([item]);
    expect(listOf([item])).toEqual([item]);
    expect(listOf({ success: true, data: null })).toEqual([]);
  });

  it('映射真实渠道字段', () => {
    expect(normalizeChannel({ channel_id: '100', channel_name: '渠道 A' })).toEqual({
      channelId: '100',
      parentChannelId: null,
      generation: 1,
      name: '渠道 A',
      commissionRate: null,
    });
  });

  it('映射真实任务字段并保留无法解析的长期有效值', () => {
    const task = normalizeTask({
      id: '200',
      task_name: '推广任务 A',
      pay_caliber: '按订单结算',
      expiry_time: '长期有效',
      status: '开启',
    });
    expect(task).toMatchObject({
      taskId: '200',
      name: '推广任务 A',
      settleType: '按订单结算',
      endTime: null,
      status: '开启',
    });
  });
});
