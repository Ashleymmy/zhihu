import { serialize } from '../../src/utils/serialize';

describe('API 序列化', () => {
  it('转换 snake_case、BIGINT、日期和 undefined', () => {
    expect(serialize({ owner_id: 12n, daily_budget: 100.5, empty: undefined, at: new Date('2026-08-06T06:30:00Z') }))
      .toEqual({ ownerId: '12', dailyBudget: 100.5, empty: null, at: '2026-08-06T06:30:00.000Z' });
  });
});
