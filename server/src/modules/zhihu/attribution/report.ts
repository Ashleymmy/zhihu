import * as XLSX from 'xlsx';
import { validateAllianceXlsx, AllianceXlsxValidationError, type AllianceUploadFile } from '../zhihu/allianceXlsx';
import { businessDay, count, day, fail, money, moneyText } from './domain';
export type ReportKind = 'search' | 'order' | 'combined';
export const REPORT_TEMPLATE_VERSION = 'zhihu-v3';
export interface SourceRow {
  date: string;
  channel: string;
  keyword: string;
  search: string | null;
  orders: string | null;
  revenue: string | null;
  promotionTask?: string | null;
  riskAssessment?: string | null;
  conversionRateRaw?: string | number | null;
  conversionRateDisplay?: string | null;
}
export interface ParsedRow {
  rowNumber: number;
  value: SourceRow;
  raw: unknown[];
  error: string | null;
}
const headers = {
  date: ['日期', '统计日期', '日期时间', 'date'],
  channel: ['渠道名称', '渠道', 'channel'],
  keyword: ['关键词', '关键字', 'keyword'],
  search: ['搜索量', '搜索次数'],
  orders: ['订单', '订单量', '订单数', '有效订单', '有效订单数'],
  revenue: ['收益', '收益金额', '收入', '佣金'],
  promotionTask: ['推广任务'],
  riskAssessment: ['风险判定'],
  conversionRate: ['搜索转化率(单位%)', '搜索转化率'],
};
const headerText = (value: unknown) =>
  String(value ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')');
export async function parseReport(file: AllianceUploadFile, kind: ReportKind): Promise<ParsedRow[]> {
  try {
    await validateAllianceXlsx(file, { allowFormulas: true });
  } catch (e) {
    if (e instanceof AllianceXlsxValidationError) fail(e.message);
    throw e;
  }
  const buffer = file.buffer;
  if (!Buffer.isBuffer(buffer)) fail('缺少上传文件内容');
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false, cellFormula: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) fail('没有工作表');
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
  const rangeRows = range.e.r - range.s.r + 1;
  const rangeColumns = range.e.c - range.s.c + 1;
  // 在展开工作表前限制范围，避免少量单元格声明巨大空白区域时耗尽资源。
  if (rangeRows > 10010) fail('每批最多 10000 行数据及 10 行表头，请移除多余空白行或拆分报告');
  if (rangeRows * rangeColumns > 1000000) fail('工作表范围过大，请移除多余空白行列或拆分报告');
  const date1904 = workbook.Workbook?.WBProps?.date1904 === true;
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  let index = -1,
    columns: Record<keyof typeof headers, number> = {
      date: -1,
      channel: -1,
      keyword: -1,
      search: -1,
      orders: -1,
      revenue: -1,
      promotionTask: -1,
      riskAssessment: -1,
      conversionRate: -1,
    };
  for (let i = 0; i < Math.min(matrix.length, 10); i++) {
    const row = matrix[i].map(headerText);
    const mapped = Object.fromEntries(
      Object.entries(headers).map(([k, aliases]) => [k, row.findIndex((x) => aliases.includes(x))]),
    ) as typeof columns;
    if (mapped.date >= 0 && mapped.channel >= 0 && mapped.keyword >= 0) {
      for (const aliases of Object.values(headers)) {
        const matches = row.flatMap((name, column) =>
          aliases.includes(name) ? [XLSX.utils.encode_col(range.s.c + column)] : [],
        );
        if (matches.length > 1) fail(`表头重复或存在多个同义列：${aliases[0]}（${matches.join('、')}），请保留唯一列`);
      }
      index = i;
      columns = mapped;
      break;
    }
  }
  if (index < 0) fail('缺少日期、渠道名称或关键词表头');
  if ((kind !== 'order' && columns.search < 0) || (kind !== 'search' && columns.orders < 0))
    fail('报告类型与指标列不一致');
  if (matrix.length - index - 1 > 10000) fail('每批最多 10000 行');
  const rows: ParsedRow[] = [];
  for (let i = index + 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (row.every((x) => x === null || String(x).trim() === '')) continue;
    const value: SourceRow = {
      date: '',
      channel: String(row[columns.channel] ?? '').trim(),
      keyword: String(row[columns.keyword] ?? '').trim(),
      search: null,
      orders: null,
      revenue: null,
      promotionTask: columns.promotionTask < 0 ? undefined : String(row[columns.promotionTask] ?? '').trim() || null,
      riskAssessment: columns.riskAssessment < 0 ? undefined : String(row[columns.riskAssessment] ?? '').trim() || null,
      conversionRateRaw: null,
      conversionRateDisplay: null,
    };
    let error: string | null = null;
    try {
      if (columns.conversionRate >= 0) {
        const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r + i, c: range.s.c + columns.conversionRate })];
        const raw = row[columns.conversionRate];
        // 保留数值和 Excel 显示值；百分数单元格与普通数字不推测换算。
        if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
          value.conversionRateRaw = typeof raw === 'number' ? raw : String(raw);
          value.conversionRateDisplay = cell ? XLSX.utils.format_cell(cell) : String(raw);
        }
      }
      const rawDate = row[columns.date];
      if (typeof rawDate === 'number') {
        const d = XLSX.SSF.parse_date_code(rawDate, { date1904 });
        if (!d) fail('Excel 日期不合法');
        value.date = day(`${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`);
      } else
        value.date = day(
          String(rawDate ?? '')
            .trim()
            .replace(/[—–－]/g, '-')
            .slice(0, 10),
        );
      if (value.date > businessDay()) fail('不能导入未来日期');
      if (!value.channel || !value.keyword || value.keyword.length > 128) fail('渠道或关键词为空或过长');
      for (const name of ['search', 'orders', 'revenue'] as const) {
        const cell = row[columns[name]];
        if (cell === null || cell === undefined || String(cell).trim() === '') continue;
        if (typeof cell === 'number' && (!Number.isFinite(cell) || Math.abs(cell) > Number.MAX_SAFE_INTEGER))
          fail('数值精度不足，请以文本导出大数');
        const text = String(cell).trim();
        value[name] = name === 'revenue' ? moneyText(money(text)) : String(count(text));
      }
      if (kind === 'search' && value.search === null) fail('搜索报告缺少搜索量');
      if (kind !== 'search' && value.orders === null) fail('订单报告缺少有效订单');
      if (kind === 'combined' && value.search === null) fail('综合报告缺少搜索量');
    } catch (e) {
      error = e instanceof Error ? e.message : '行数据无效';
    }
    rows.push({ rowNumber: range.s.r + i + 1, value, raw: row, error });
  }
  if (!rows.length) fail('报告没有数据行');
  return rows;
}
