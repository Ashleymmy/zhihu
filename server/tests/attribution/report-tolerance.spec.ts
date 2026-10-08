import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseReport, reportDate } from '../../src/modules/zhihu/attribution/report';
const headers = ['日期', '渠道名称', '关键词', '订单量', '收益'];
function xlsx(rows: unknown[][], cover = false) {
  const book = XLSX.utils.book_new();
  if (cover) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['使用说明'], ['第二张表为订单']]), '说明');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...rows]), '订单');
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return { originalname: '容错.xlsx', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer, size: buffer.length };
}
describe('报表解析容错', () => {
  it.each(['2026-09-14', '2026/9/14', '2026.9.14', '2026年9月14日', '20260914', '2026-09-14 10:00:00', '2026/9/14 10:00'])('识别日期 %s', value => {
    expect(reportDate(value)).toBe('2026-09-14');
  });
  it('跳过汇总，保留错误行和正确行，不把异常数量当零', async () => {
    const rows = await parseReport(xlsx([
      ['2026/9/14', '渠道', '词', '1,200 单', '￥ 2,400.50 元'],
      ['错日期', '渠道', '错误词', 1, 2],
      ['2026-09-14', '渠道', '负数词', -1, 2],
      ['2026-09-14', '渠道', '小数词', 1.5, 2],
      ['2026-09-14', '渠道', '空数词', null, 2],
      [' 合 计 ', null, null, 1200, 2400],
      ['2026-09-14', '总计', '词', 1200, 2400],
    ]), 'order');
    expect(rows).toHaveLength(7);
    expect(rows[0].value).toMatchObject({ date: '2026-09-14', orders: '1200', revenue: '2400.5000' });
    expect(rows[0].error).toBeNull();
    expect(rows[1].error).toBe('第 3 行日期写成了“错日期”，请改成 2026-09-14 这样的格式');
    expect(rows[2].error).toBe('第 4 行订单量不是整数');
    expect(rows[3].error).toBe('第 5 行订单量不是整数');
    expect(rows[4].error).toBe('第 6 行没有订单量');
    for (const row of rows.slice(5)) expect(row).toMatchObject({ skipped: true, error: '汇总行，已跳过' });
  });
  it('跳过封面工作表，使用首个具有必需表头的工作表', async () => {
    const [row] = await parseReport(xlsx([['2026-09-14', '渠道', '词', 3, 6]], true), 'order');
    expect(row.value.orders).toBe('3'); expect(row.error).toBeNull();
  });
  it.each([',', '\t'])('UTF-8 CSV 支持分隔符 %s', async separator => {
    const buffer = Buffer.from('\uFEFF' + [headers.join(separator), ['2026/9/14', '渠道', '词', '3', '6'].join(separator)].join('\r\n'));
    const [row] = await parseReport({ originalname: '报表.csv', mimetype: 'text/csv', buffer }, 'order');
    expect(row.value).toMatchObject({ orders: '3', revenue: '6.0000', date: '2026-09-14' });
    expect(row.error).toBeNull();
  });
  it('GBK CSV 使用同一口径', async () => {
    // 固定 GBK 字节：日期,渠道名称,关键词,订单量,收益 / 2026-09-14,渠道,词,3,6。
    const buffer = Buffer.from('c8d5c6da2cc7feb5c0c3fbb3c62cb9d8bcfcb4ca2cb6a9b5a5c1bf2ccad5d2e60d0a323032362d30392d31342cc7feb5c02cb4ca2c332c36', 'hex');
    const [row] = await parseReport({ originalname: 'GBK.csv', mimetype: 'text/csv', buffer }, 'order');
    expect(row.value).toMatchObject({ date: '2026-09-14', channel: '渠道', keyword: '词', orders: '3', revenue: '6.0000' });
    expect(row.error).toBeNull();
  });
  it('拒绝 NUL CSV，旧 XLS 给出另存为方法', async () => {
    await expect(parseReport({ originalname: '坏.csv', mimetype: 'text/csv', buffer: Buffer.from('a\0b') }, 'order')).rejects.toThrow('不是可读取的 CSV');
    await expect(parseReport({ originalname: '旧.xls', mimetype: 'application/vnd.ms-excel', buffer: Buffer.from('old') }, 'order')).rejects.toThrow('另存为');
  });
});
