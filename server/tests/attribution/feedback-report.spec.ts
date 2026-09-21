import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseReport } from '../../src/modules/zhihu/attribution/report';
import { buildXlsxZipFixture, minimalXlsxEntries } from '../support/allianceXlsxFixture';

const headers = ['日期时间', '渠道名称', '关键词', '推广任务', '风险判定', '搜索量', '订单量', '搜索转化率（单位%）'];
function file(rows: unknown[][], percentage = false) {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  if (percentage) sheet.H2.z = '0.00%';
  XLSX.utils.book_append_sheet(book, sheet, '真实表头合成样例');
  return workbookFile(book);
}
function workbookFile(book: XLSX.WorkBook) {
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return {
    originalname: '反馈.xlsx',
    size: buffer.length,
    buffer,
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}
describe('真实反馈表头契约', () => {
  it.each([
    ['A1:H1048576', '10000 行'],
    ['A1:XFD1000', '范围过大'],
  ])('展开矩阵前拒绝过大工作表范围 %s', async (range, message) => {
    // 直接构造只有一个单元格、却声明巨大范围的合法 ZIP，避免测试写出器也遍历空白区域。
    const buffer = buildXlsxZipFixture(
      minimalXlsxEntries().map((entry) =>
        entry.name === 'xl/worksheets/sheet1.xml'
          ? { ...entry, data: String(entry.data).replace('<sheetData>', `<dimension ref="${range}"/><sheetData>`) }
          : entry,
      ),
    );
    await expect(
      parseReport(
        {
          originalname: '大范围.xlsx',
          buffer,
          size: buffer.length,
          mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        'combined',
      ),
    ).rejects.toThrow(message);
  });
  it.each(['首表', '附加表'])('等待整个工作簿的安全检查，拒绝%s中的外部公式', async (location) => {
    const book = XLSX.utils.book_new();
    const main = XLSX.utils.aoa_to_sheet([headers, ['2026-08-26', '渠道甲', '词', '任务', null, 1000, 100, 10]]);
    XLSX.utils.book_append_sheet(book, main, '反馈');
    const formula = 'WEBSERVICE("https://example.com")';
    if (location === '首表') main.G2.f = formula;
    else XLSX.utils.book_append_sheet(book, { A1: { t: 'n', v: 100, f: formula }, '!ref': 'A1' }, '附加表');
    await expect(parseReport(workbookFile(book), 'combined')).rejects.toThrow('上传文件不符合要求');
  });
  it('读取安全本地公式的已保存结果，不在服务端计算公式', async () => {
    const book = XLSX.utils.book_new();
    const main = XLSX.utils.aoa_to_sheet([headers, ['2026-08-26', '渠道甲', '词', '任务', null, 1000, 100, 10]]);
    main.G2.f = '50+50';
    XLSX.utils.book_append_sheet(book, main, '反馈');
    const [row] = await parseReport(workbookFile(book), 'combined');
    expect(row.error).toBeNull();
    expect(row.value.orders).toBe('100');
  });
  it('1904 日期系统按工作簿声明解析，不把业务日期提前四年', async () => {
    const book = XLSX.utils.book_new();
    book.Workbook = { WBProps: { date1904: true } };
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([headers, [44798, '渠道甲', '词', '任务', null, 1000, 100, 10]]),
      '反馈',
    );
    const [row] = await parseReport(workbookFile(book), 'combined');
    expect(row.error).toBeNull();
    expect(row.value.date).toBe('2026-08-26');
    expect(row.raw[0]).toBe(44798);
  });
  it('有效范围从 C5 开始时保留原始第 6 行及正确的百分比单元格', async () => {
    const book = XLSX.utils.book_new(),
      sheet: XLSX.WorkSheet = {};
    XLSX.utils.sheet_add_aoa(sheet, [headers, ['2026-08-26', '渠道甲', '词', '任务', null, 1000, 100, 0.1]], {
      origin: 'C5',
    });
    sheet['!ref'] = 'C5:J6';
    sheet.J6.z = '0.00%';
    XLSX.utils.book_append_sheet(book, sheet, '反馈');
    const [row] = await parseReport(workbookFile(book), 'combined');
    expect(row.rowNumber).toBe(6);
    expect(row.error).toBeNull();
    expect(row.value).toMatchObject({ conversionRateRaw: 0.1, conversionRateDisplay: '10.00%' });
  });
  it.each(['订单', '风险判定', '统计日期'])('拒绝重复或同义的%s列，不任意选择其中一列', async (duplicate) => {
    await expect(
      parseReport(
        file([
          [...headers, duplicate],
          ['2026-08-26', '渠道甲', '词', '任务', null, 1000, 100, 10, '存在冲突'],
        ]),
        'combined',
      ),
    ).rejects.toThrow('表头重复或存在多个同义列');
  });
  it('八列表头无需收益列，保留任务、空风险及普通数值转化率', async () => {
    const [row] = await parseReport(
      file([headers, ['2026—08—26', '渠道甲', '关键词', 'KOC—会员订单', null, 1000, 100, 10]]),
      'combined',
    );
    expect(row.error).toBeNull();
    expect(row.value).toMatchObject({
      date: '2026-08-26',
      promotionTask: 'KOC—会员订单',
      riskAssessment: null,
      search: '1000',
      orders: '100',
      revenue: null,
      conversionRateRaw: 10,
      conversionRateDisplay: '10',
    });
    expect(row.raw[0]).toBe('2026—08—26');
  });
  it('Excel 日期与百分比格式保留原始值和显示值，零与缺失不同', async () => {
    const [zero, missing] = await parseReport(
      file(
        [
          headers,
          [46260, '渠道甲', '关键词', null, '  ', 0, 0, 0.1],
          ['2026-08-26', '渠道甲', '关键词', null, null, 0, null, null],
        ],
        true,
      ),
      'combined',
    );
    expect(zero.error).toBeNull();
    expect(zero.value).toMatchObject({
      orders: '0',
      search: '0',
      revenue: null,
      riskAssessment: null,
      conversionRateRaw: 0.1,
      conversionRateDisplay: '10.00%',
    });
    expect(missing.error).toContain('缺少有效订单');
    expect(missing.value.orders).toBeNull();
  });
  it('非空风险原文保留，缺列与空风险不同，转化率不改变订单', async () => {
    const [risk] = await parseReport(
      file([headers, ['2026-08-26', '渠道甲', '词', '任务', '待核实', 1000, 100, '未知口径']]),
      'order',
    );
    expect(risk.error).toBeNull();
    expect(risk.value).toMatchObject({ orders: '100', riskAssessment: '待核实', conversionRateRaw: '未知口径' });
    const [absent] = await parseReport(
      file([
        ['日期', '渠道名称', '关键词', '订单量', '收益'],
        ['2026-08-26', '渠道甲', '词', 100, null],
      ]),
      'order',
    );
    expect(absent.error).toBeNull();
    expect(absent.value.riskAssessment).toBeUndefined();
    expect(absent.value.revenue).toBeNull();
  });
});
