import { describe, it, expect } from 'vitest';
import { day, money, moneyText, count } from '../../src/modules/zhihu/attribution/domain';
import * as XLSX from 'xlsx';
import { parseReport } from '../../src/modules/zhihu/attribution/report';
describe('金额及日期边界', () => {
  it('四位金额与超安全整数数量不经过浮点', () => {
    expect(moneyText(money('0.0001') * count('9007199254740993'))).toBe('900719925474.0993');
    expect(moneyText(money('1800') - money('2000'))).toBe('-200.0000');
    expect(moneyText(0n)).toBe('0.0000');
  });
  it('拒绝指数、精度溢出、负数量及无效日期', () => {
    for (const value of ['1e4', '1.00001', 'NaN', '-1']) expect(() => money(value)).toThrow();
    expect(() => count('1.2')).toThrow();
    expect(() => count('-1')).toThrow();
    expect(() => day('2026-02-29')).toThrow();
    expect(day('2024-02-29')).toBe('2024-02-29');
  });
  it('订单分报可缺少搜索列，明确的零保留，缺少有效订单不可当零', async () => {
    const file = (rows: unknown[][]) => {
      const b = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(b, XLSX.utils.aoa_to_sheet(rows), '日报');
      const buffer = XLSX.write(b, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      return {
        originalname: '日期.xlsx',
        size: buffer.length,
        buffer,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    };
    const rows = await parseReport(
      file([
        ['日期', '渠道名称', '关键词', '订单', '收益'],
        ['2026-01-01', '渠道', '词', '0', '0'],
        ['2026-01-01', '渠道', '词', null, '0'],
      ]),
      'order',
    );
    expect(rows[0].value).toMatchObject({ search: null, orders: '0', revenue: '0.0000' });
    expect(rows[0].error).toBeNull();
    expect(rows[1].value.orders).toBeNull();
    expect(rows[1].error).toContain('缺少');
    await expect(
      parseReport(
        file([
          ['日期', '渠道名称', '关键词', '搜索量'],
          ['2026-01-01', '渠道', '词', 0],
        ]),
        'order',
      ),
    ).rejects.toThrow('指标列');
  });
});
