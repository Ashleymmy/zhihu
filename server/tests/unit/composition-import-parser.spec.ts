import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { balancedVideoCategories, compositionUrlKey, importOptionsSchema, parseCompositionFile, parseMedia, parseReleaseTime } from '../../src/modules/zhihu/services/composition-import-parser';

const workbook = (sheets: Record<string, unknown[][]>, bookType: XLSX.BookType = 'xlsx') => {
  const book = XLSX.utils.book_new();
  for (const [name, cells] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(cells), name);
  return { originalname: `works.${bookType}`, buffer: XLSX.write(book, { type: 'buffer', bookType }) as Buffer };
};
describe('作品登记表解析', () => {
  it('识别达人记录的真实列名，选择有数据的工作表，保留物理行号', () => {
    const file = workbook({ '9月20日': [['日期', '达人视频登记表', 'id', '微信/qq', '平台', '视频链接', '关键词'], [46285]], '9月21日': [['日期', '平台id', '微信/qq', '平台', '视频链接', '关键词'], [46286, 35809749761, '联系人', 'KOC抖音', 'https://v.douyin.com/AbC/', '示例关键词'], [], [46286, '000123', '', '小红书', 'https://xhslink.cn/o/abc', '另一个词']] });
    const parsed = parseCompositionFile(file, importOptionsSchema.parse({}));
    expect(parsed.sheetName).toBe('9月21日');
    expect(parsed.mapping).toMatchObject({ mediaAccount: 1, mediaType: 3, promoUrl: 4, keyword: 5, releaseTime: 0 });
    expect(parsed.parsedRows.map(row => row.row)).toEqual([2, 4]);
    expect(parsed.parsedRows[1].values.mediaAccount).toBe('000123');
    expect(Object.values(parsed.mapping)).not.toContain(2);
  });
  it('支持标题行之后的表头、手工列映射以及 CSV / XLS', () => {
    for (const format of ['xlsx', 'xls', 'csv'] as const) {
      const parsed = parseCompositionFile(workbook({ Sheet1: [['九月登记'], ['日期', '自定义账号', '链接'], ['2026/9/21', '账号甲', 'https://example.com/work']] }, format), importOptionsSchema.parse({ mapping: { mediaAccount: 1 } }));
      expect(parsed.headerRow).toBe(2);
      expect(parsed.parsedRows[0].values.mediaAccount).toBe('账号甲');
    }
  });
  it('拒绝损坏文件、超过行数限制及一列对应多个字段', () => {
    expect(() => parseCompositionFile({ originalname: 'image.png', buffer: Buffer.from('bad') }, importOptionsSchema.parse({}))).toThrow('请选择');
    expect(() => parseCompositionFile(workbook({ s: [['关键词', '链接'], ['测试', 'https://example.com']] }), importOptionsSchema.parse({ mapping: { keyword: 1 } }))).toThrow('同一列');
    expect(() => parseCompositionFile(workbook({ s: [['链接'], ...Array.from({ length: 1001 }, (_, i) => [`https://example.com/${i}`])] }), importOptionsSchema.parse({}))).toThrow('1000');
  });
  it('按北京时间解析 Excel 序列日期，拒绝自动纠正错误日期', () => {
    expect(parseReleaseTime(46286)).toBe('2026-09-20T16:00:00.000Z');
    expect(parseReleaseTime('2026/9/21 13:05')).toBe('2026-09-21T05:05:00.000Z');
    expect(parseReleaseTime('2026-09-21T10:11:12Z')).toBe('2026-09-21T10:11:12.000Z');
    expect(parseReleaseTime('2026-02-30')).toBeUndefined();
    expect(parseReleaseTime('2026-09-21 25:00')).toBeUndefined();
    expect(parseReleaseTime('')).toBeUndefined();
    expect(parseReleaseTime(44824, true)).toBe('2026-09-20T16:00:00.000Z');
  });
  it('去除首尾空白和分享跟踪参数，保留大小写敏感的短链接标识', () => {
    expect(compositionUrlKey(' https://v.douyin.com/AbC/ ')).toBe(compositionUrlKey('https://v.douyin.com/AbC'));
    expect(compositionUrlKey('https://v.douyin.com/AbC')).not.toBe(compositionUrlKey('https://v.douyin.com/abc'));
    expect(compositionUrlKey('https://v.douyin.com/AbC/ :4pm g@O.kP 06/27 nDu:/')).toBe(compositionUrlKey('https://v.douyin.com/AbC/'));
    expect(compositionUrlKey('https://v.douyin.com/AbC/%20:4pm%20g@O.kP')).toBe(compositionUrlKey('https://v.douyin.com/AbC/'));
    expect(compositionUrlKey('https://www.xiaohongshu.com/discovery/item/123?xsec_token=old&source=webshare')).toBe(compositionUrlKey('https://www.xiaohongshu.com/discovery/item/123?xsec_token=new'));
    expect(compositionUrlKey('javascript:alert(1)')).toBe('');
    expect(compositionUrlKey('https://user:password@example.com/a')).toBe('');
    expect(compositionUrlKey('https://example.com/watch?id=1')).not.toBe(compositionUrlKey('https://example.com/watch?id=2'));
  });
  it('规范平台名称，随机补填分类分布均衡且重复分析结果稳定', () => {
    expect(parseMedia('微信视频号')).toBe('KOC视频号');
    expect(parseMedia('快手')).toBe('KOC快手');
    const keys = Array.from({ length: 135 }, (_, i) => `work-${i}`);
    const categories = balancedVideoCategories(keys);
    const counts = [5, 6, 7, 8, 9, 10].map(category => [...categories.values()].filter(value => value === category).length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(balancedVideoCategories([...keys].reverse())).toEqual(categories);
  });
});
