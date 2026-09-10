import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { normalizeUploadFilename, parseDataImportWorkbook } from '../../src/modules/zhihu/services/data-import.service';
import { validateAllianceXlsx, XLSX_MIME } from '../../src/modules/zhihu/zhihu/allianceXlsx';

function workbook(rows: unknown[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, '日报');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}

describe('邮件附件 / Excel 导入解析', () => {
  it('修复 multipart 上传导致的中文文件名乱码，并保留正常文件名', () => {
    const mojibake = Buffer.from('知乎.xlsx', 'utf8').toString('latin1');

    expect(normalizeUploadFilename(mojibake)).toBe('知乎.xlsx');
    expect(normalizeUploadFilename('report.xlsx')).toBe('report.xlsx');
    expect(normalizeUploadFilename('café.xlsx')).toBe('café.xlsx');
  });

  it('识别搜索量报表并保留原始列值', () => {
    const buffer = workbook([
      ['日期时间', '渠道名称', '关键词', '推广任务', '风险判定', '搜索量', '搜索转化率'],
      ['2026-09-01 08:00:00', '渠道 A', '关键词 A', '任务 A', '正常', 1234, '12.5%'],
      ['2026-09-01 09:00:00', '渠道 B', '关键词 B', '任务 B', '风险', 'not-a-number', '0.2'],
    ]);
    const parsed = parseDataImportWorkbook(buffer);

    expect(parsed.reportType).toBe('search');
    expect(parsed.totalRows).toBe(2);
    expect(parsed.validRows).toBe(1);
    expect(parsed.errorRows).toBe(1);
    expect(parsed.rows[0]).toMatchObject({
      occurredAt: '2026-09-01 08:00:00',
      searchVolume: '1234',
      searchConversionRate: '0.125000',
      validationStatus: 'valid',
    });
    expect(parsed.rows[0]?.raw['搜索量']).toBe(1234);
    expect(parsed.errors[0]).toMatchObject({ rowNumber: 3, messages: ['搜索量为空或不是非负整数'] });
  });

  it('生成的普通 Excel 工作簿可通过上传安全校验', async () => {
    const buffer = workbook([
      ['日期时间', '渠道名称', '关键词', '搜索量'],
      ['2026-09-01', '渠道 A', '关键词 A', 1],
    ]);
    await expect(
      validateAllianceXlsx({ originalname: '日报.xlsx', mimetype: XLSX_MIME, size: buffer.length, buffer }),
    ).resolves.toBeUndefined();
  });

  it('识别订单报表并标准化订单量与转化率', () => {
    const parsed = parseDataImportWorkbook(
      workbook([
        ['日期时间', '渠道', '关键词', '风险判定', '搜索量', '订单量', '收益金额'],
        [45306.5, '渠道 A', '关键词 A', '正常', 200, 12, '￥1,234.50'],
      ]),
    );

    expect(parsed.reportType).toBe('order');
    expect(parsed.rows[0]).toMatchObject({
      occurredAt: '2024-01-15 12:00:00',
      searchVolume: '200',
      orderCount: '12',
      revenueAmount: '1234.50',
      validationStatus: 'valid',
    });
  });

  it('兼容邮件实际表头中的转化数和转化率单位说明', () => {
    const parsed = parseDataImportWorkbook(
      workbook([
        ['日期时间', '渠道名称', '关键词', '搜索量', '转化数', '搜索转化率(单位%)', '收益金额'],
        ['2026-09-01', '渠道 A', '关键词 A', 200, 12, '6%', '120.00'],
      ]),
    );

    expect(parsed.rows[0]).toMatchObject({
      orderCount: '12',
      searchConversionRate: '0.060000',
      revenueAmount: '120.00',
      validationStatus: 'valid',
    });
    expect(parsed.fieldMappings).toEqual(
      expect.arrayContaining([
        { field: 'orderCount', label: '订单量 / 转化数', sourceHeader: '转化数' },
        { field: 'searchConversionRate', label: '搜索转化率', sourceHeader: '搜索转化率(单位%)' },
      ]),
    );
  });

  it('缺少基础列时拒绝解析', () => {
    expect(() =>
      parseDataImportWorkbook(
        workbook([
          ['渠道名称', '关键词', '搜索量'],
          ['渠道 A', '关键词 A', 10],
        ]),
      ),
    ).toThrow('未找到表头');
  });
});
