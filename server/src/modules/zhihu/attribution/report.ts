import * as XLSX from 'xlsx';
import { validateAllianceXlsx, AllianceXlsxValidationError, XLSX_MAX_BYTES, type AllianceUploadFile } from '../zhihu/allianceXlsx';
import { businessDay, count, day, fail, money, moneyText } from './domain';
import { AppError } from '../../../middleware/errors';
export type MetricType = 'new_user' | 'activation';
export type ReportKind = 'search' | 'order' | 'combined' | 'activation';
export const REPORT_TEMPLATE_VERSION = 'zhihu-v3';
export const REPORT_TEMPLATE_VERSION_ACTIVATION = 'zhihu-activation-v1';
export const reportTemplate = (kind: ReportKind) => kind==='activation'?REPORT_TEMPLATE_VERSION_ACTIVATION:REPORT_TEMPLATE_VERSION;
export function assertReportWriteEnabled(kind: ReportKind) {
  if (kind==='activation' && process.env.ZHIHU_ACTIVATION_ENABLED!=='true') fail('拉活报表尚未开放，财务：待项目开放拉活后再上传', 503);
}
export interface SourceRow {
  date: string;
  channel: string;
  keyword: string;
  search: string | null;
  orders: string | null;
  revenue: string | null;
  activations?: string | null;
  settlement?: string | null;
  agency?: string | null;
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
  skipped?: boolean;
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
const activationHeaders = {
  ...headers,
  date: ['日期', '日期时间', '统计日期', '结算日期', '业务日期'],
  keyword: ['关键词', '关键字', '搜索词'],
  activations: ['拉活量', '拉活数', '拉活数量', '拉活人数', '拉活个数', '有效拉活', '激活量'],
  settlement: ['结算金额', '结算', '补贴金额', '拉活金额', '结算收入', '金额'],
  agency: ['代理名称', '代理', '代理商', '代理商名称', '机构名称'],
};
function typeMismatch(suggestedType: MetricType): never {
  throw new AppError(422, 42200, suggestedType==='activation'
    ? '这份文件有“拉活量”列，看起来是拉活表。'
    : '这份文件有“订单量”列，看起来是拉新订单表。', {extras:{suggestedType}});
}
const headerText = (value: unknown) =>
  String(value ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')');
export function reportDate(value: unknown, date1904 = false): string {
  if (typeof value === 'number') {
    const d = XLSX.SSF.parse_date_code(value, { date1904 });
    if (!d) fail('日期无法识别');
    return day(`${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`);
  }
  const text = String(value ?? '').trim().replace(/[—–－]/g, '-');
  const match = text.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?(?:[ T].*)?$/)
    ?? text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) fail('日期无法识别');
  return day(`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`);
}
const numericText = (value: unknown) => String(value ?? '').replace(/[,，\s¥￥元个单]/g, '');
const summaryText = (value: unknown) => ['合计', '总计', '小计', '汇总', '总和'].includes(headerText(value));
export async function parseReport(file: AllianceUploadFile, kind: ReportKind): Promise<ParsedRow[]> {
  const templateHeaders: Record<keyof typeof activationHeaders, string[]> = kind==='activation'?activationHeaders:{...headers,activations:[],settlement:[],agency:[]};
  const filename = String(file.originalname ?? '').toLowerCase();
  if (filename.endsWith('.xls')) fail('这是旧版 Excel（.xls）。请在 Excel 或 WPS 里点“另存为”，选择 .xlsx 格式后再上传。');
  const buffer = file.buffer;
  if (!Buffer.isBuffer(buffer)) fail('缺少上传文件内容');
  let workbook: XLSX.WorkBook;
  if (filename.endsWith('.csv')) {
    if (!buffer.length || buffer.length > XLSX_MAX_BYTES) fail('文件大小不能超过 10 MB');
    if (buffer.includes(0)) fail('这份文件不是可读取的 CSV，请另存为 .xlsx 或 CSV 后再上传。');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
    catch {
      try { text = new TextDecoder('gbk', { fatal: true }).decode(buffer); }
      catch { fail('这份 CSV 的文字无法读取，请另存为 UTF-8 CSV 后再上传。'); }
    }
    workbook = XLSX.read(text.replace(/^\uFEFF/, ''), { type: 'string', raw: true });
  } else {
  try {
    await validateAllianceXlsx(file, { allowFormulas: true });
  } catch (e) {
    if (e instanceof AllianceXlsxValidationError) fail(e.message);
    throw e;
  }
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false, cellFormula: true });
  }
  const matchesSheet = (name: string, requireMetrics: boolean) => {
    const candidate = workbook.Sheets[name];
    if (!candidate) return false;
    const start = XLSX.utils.decode_range(candidate['!ref'] ?? 'A1').s;
    for (let r = start.r; r < start.r + 10; r++) {
      const names: string[] = [];
      // Inspect stored cells rather than expanding a potentially huge declared range.
      for (const address of Object.keys(candidate)) {
        if (address.startsWith('!')) continue;
        const cell = XLSX.utils.decode_cell(address);
        if (cell.r === r) names.push(headerText(candidate[address]?.v));
      }
      const required = ['date', 'channel', 'keyword', ...(requireMetrics ? kind==='activation'?['activations']:kind === 'search' ? ['search'] : kind === 'order' ? ['orders'] : ['search', 'orders'] : [])];
      if (required.every(k => (requireMetrics?templateHeaders[k as keyof typeof activationHeaders]:[...templateHeaders[k as keyof typeof activationHeaders],...activationHeaders[k as keyof typeof activationHeaders]]).some(alias => names.includes(alias)))) return true;
    }
    return false;
  };
  const sheetName = workbook.SheetNames.find(name => matchesSheet(name, true))
    ?? workbook.SheetNames.find(name => matchesSheet(name, false));
  const sheet = workbook.Sheets[sheetName ?? workbook.SheetNames[0]];
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
    columns: Record<keyof typeof activationHeaders, number> = {
      date: -1,
      channel: -1,
      keyword: -1,
      search: -1,
      orders: -1,
      revenue: -1,
      promotionTask: -1,
      riskAssessment: -1,
      conversionRate: -1,
      activations: -1,
      settlement: -1,
      agency: -1,
    };
  for (let i = 0; i < Math.min(matrix.length, 10); i++) {
    const row = matrix[i].map(headerText);
    if ((['date','channel','keyword'] as const).every(k=>[...headers[k],...activationHeaders[k]].some(alias=>row.includes(alias)))) {
      const hasOrders=headers.orders.some(alias=>row.includes(alias)),hasActivations=activationHeaders.activations.some(alias=>row.includes(alias));
      if (kind==='activation' && hasOrders && !hasActivations) typeMismatch('new_user');
      if (kind!=='activation' && hasActivations && !hasOrders) typeMismatch('activation');
      if (!hasOrders && !hasActivations && !headers.search.some(alias=>row.includes(alias))) fail('没找到“订单量”或“拉活量”这一列，请确认上传的是知乎的订单报表或拉活补贴表。');
    }
    const mapped = Object.fromEntries(
      Object.entries(templateHeaders).map(([k, aliases]) => [k, kind==='activation'?(aliases.map(alias=>row.indexOf(alias)).find(index=>index>=0)??-1):row.findIndex((x) => aliases.includes(x))]),
    ) as typeof columns;
    if (mapped.date >= 0 && mapped.channel >= 0 && mapped.keyword >= 0) {
      for (const aliases of kind==='activation'?[]:Object.values(headers)) {
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
  if (kind==='activation'?columns.activations<0:(kind !== 'order' && columns.search < 0) || (kind !== 'search' && columns.orders < 0))
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
      ...(kind==='activation'?{activations:null,settlement:null,agency:columns.agency<0?null:String(row[columns.agency]??'').trim()||null}:{}),
      promotionTask: columns.promotionTask < 0 ? undefined : String(row[columns.promotionTask] ?? '').trim() || null,
      riskAssessment: columns.riskAssessment < 0 ? undefined : String(row[columns.riskAssessment] ?? '').trim() || null,
      conversionRateRaw: null,
      conversionRateDisplay: null,
    };
    let error: string | null = null;
    if ([row[columns.date], row[columns.channel], row[columns.keyword]].some(summaryText)) {
      rows.push({ rowNumber: range.s.r + i + 1, value, raw: row, error: '汇总行，已跳过', skipped: true });
      continue;
    }
    const number = range.s.r + i + 1;
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
      try { value.date = reportDate(rawDate, date1904); }
      catch { fail(`第 ${number} 行日期写成了“${String(rawDate ?? '')}”，请改成 2026-09-14 这样的格式`); }
      if (value.date > businessDay()) fail(`第 ${number} 行日期是 ${value.date}，还没到这一天`);
      if (!value.channel || !value.keyword) fail(`第 ${number} 行缺少渠道名称或关键词`);
      if (value.keyword.length > 128) fail(`第 ${number} 行关键词超过 128 个字`);
      const metrics: ('search'|'orders'|'revenue'|'activations'|'settlement')[]=kind==='activation'?['activations','settlement']:['search','orders','revenue'];
      for (const name of metrics) {
        const cell = row[columns[name]];
        if (cell === null || cell === undefined || String(cell).trim() === '') continue;
        if (typeof cell === 'number' && (!Number.isFinite(cell) || Math.abs(cell) > Number.MAX_SAFE_INTEGER))
          fail('数值精度不足，请以文本导出大数');
        const text = numericText(cell);
        try { value[name] = name === 'revenue'||name==='settlement' ? moneyText(money(text)) : String(count(text)); }
        catch { fail(`第 ${number} 行${name==='activations'?'拉活量不是整数':name==='settlement'?'结算金额格式不正确':name === 'revenue' ? '收益金额格式不正确' : name === 'orders' ? '订单量不是整数' : '搜索量不是整数'}`); }
      }
      if (kind === 'search' && value.search === null) fail('搜索报告缺少搜索量');
      if (kind==='activation'&&value.activations===null) fail(`第 ${number} 行没有拉活量`);
      if (kind !== 'search' && kind!=='activation' && value.orders === null) fail(`第 ${number} 行没有订单量`);
      if (kind === 'combined' && value.search === null) fail('综合报告缺少搜索量');
    } catch (e) {
      error = e instanceof Error ? e.message : '行数据无效';
    }
    rows.push({ rowNumber: range.s.r + i + 1, value, raw: row, error });
  }
  if (!rows.length) fail('报告没有数据行');
  return rows;
}
