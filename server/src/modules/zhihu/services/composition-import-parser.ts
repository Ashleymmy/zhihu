import * as XLSX from 'xlsx';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../../middleware/errors';
import { COMPOSITION_TYPES, COMPOSITION_SUB_TYPES, ZHIHU_MEDIA_TYPES } from '../zhihu/composition';

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 1000;
export const importFields = [
  { key: 'planId', label: '计划编号', aliases: ['planid', '计划id', '推广计划编号'] },
  { key: 'keyword', label: '关键词', aliases: ['所属计划', '推广计划', '计划名称', 'keyword', '关键词名称'] },
  { key: 'mediaAccount', label: '媒体账号', aliases: ['平台id', '平台账号', '达人id', '账号id', '媒体账号名', '账号', 'id', 'mediaaccount'] },
  { key: 'mediaType', label: '媒体类型', aliases: ['平台', '发布平台', '媒体平台', 'mediatype'] },
  { key: 'promoUrl', label: '推广链接', aliases: ['视频链接', '作品链接', '作品地址', '链接', 'promourl', 'compositionurl'] },
  { key: 'releaseTime', label: '发布时间', aliases: ['日期', '发布日期', '发布日', '时间', 'releasetime'] },
  { key: 'compositionType', label: '作品分类', aliases: ['作品类型', '一级分类', 'compositiontype'] },
  { key: 'compositionSubType', label: '作品子分类', aliases: ['子分类', '二级分类', '视频类型', 'compositionsubtype'] },
  { key: 'title', label: '标题', aliases: ['作品标题', '视频标题', 'title'] },
] as const;
export type ImportField = typeof importFields[number]['key'];
export type ImportMapping = Partial<Record<ImportField, number | null>>;
export const importOptionsSchema = z.object({
  sheetName: z.string().max(128).optional(),
  headerRow: z.number().int().min(1).max(30).optional(),
  mapping: z.record(z.number().int().min(0).max(99).nullable()).optional(),
  defaults: z.object({
    planId: z.string().regex(/^\d+$/).optional(),
    compositionType: z.number().int().min(0).max(2).optional(),
    compositionSubType: z.number().int().min(1).max(11).optional(),
    releaseTime: z.string().max(50).optional(),
  }).default({}),
  categoryMode: z.enum(['manual', 'rotate-video']).default('manual'),
  knownExternal: z.object({
    site: z.string().url().max(512),
    checkedAt: z.string().max(50),
    links: z.array(z.string().max(2048)).max(1000),
  }).optional(),
}).strict();
export type ImportOptions = z.infer<typeof importOptionsSchema>;
export const failImport = (message: string): never => { throw new AppError(422, 42200, message); };
export function balancedVideoCategories(keys: string[]): Map<string, number> {
  const unique = [...new Set(keys)].sort((a, b) => createHash('sha256').update(a).digest('hex').localeCompare(createHash('sha256').update(b).digest('hex')));
  return new Map(unique.map((key, index) => [key, 5 + index % 6]));
}
const cellText = (value: unknown) => value == null ? '' : String(value).trim();
const headerKey = (value: unknown) => cellText(value).toLowerCase().replace(/[\s_\-（）()：:]/g, '');

export function detectMapping(headers: unknown[]): ImportMapping {
  const result: ImportMapping = {};
  for (const field of importFields) {
    const aliases = [field.label, field.key, ...field.aliases].map(headerKey);
    const matches = headers.map((value, index) => aliases.includes(headerKey(value)) ? index : -1).filter(i => i >= 0);
    result[field.key] = matches.length === 1 ? matches[0] : null;
  }
  return result;
}

/** Preserve case-sensitive short-link IDs; remove only known tracking parameters. Never fetch arbitrary URLs. */
export function extractCompositionUrl(value: string): string {
  const text = value.trim();
  const matches = text.match(/https?:\/\/[^\s<>"“”]+/gi) || [];
  if (matches.length !== 1) return text;
  const candidate = matches[0].replace(/[，。；）]+$/, '');
  try {
    const url = new URL(candidate);
    // Shared Douyin text may have been stored with URI-encoded trailing prose by older forms.
    if (url.hostname === 'v.douyin.com') return `${url.origin}/${url.pathname.split('/').filter(Boolean)[0]?.split(/%20|%0A|%09/i)[0] || ''}/`;
  } catch { return text; }
  return candidate;
}
export function compositionUrlKey(value: string): string {
  try {
    const extracted = extractCompositionUrl(value);
    if (/\s/.test(extracted)) return '';
    const url = new URL(extracted);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_.+/i.test(key) || (/(^|\.)(xiaohongshu\.com|xhslink\.cn|xhslink\.com)$/.test(url.hostname) && /^(source|xhsshare|xsec_token|xsec_source)$/i.test(key))) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return `${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '')}${url.search}`;
  } catch { return ''; }
}

export function mediaFromUrl(value: string): string | undefined {
  let host: string;
  try { host = new URL(value).hostname.toLowerCase(); } catch { return; }
  const domains: [string, string][] = [['douyin.com', 'KOC抖音'], ['kuaishou.com', 'KOC快手'], ['xiaohongshu.com', 'KOC小红书'], ['xhslink.cn', 'KOC小红书'], ['xhslink.com', 'KOC小红书'], ['weixin.qq.com', 'KOC视频号'], ['bilibili.com', 'KOC哔哩哔哩'], ['b23.tv', 'KOC哔哩哔哩']];
  return domains.find(([domain]) => host === domain || host.endsWith(`.${domain}`))?.[1];
}
export function parseMedia(value: unknown): string | undefined {
  const text = cellText(value).replace(/\s/g, '').replace(/^koc/i, '');
  if (!text) return;
  const aliases: Record<string, string> = { 微信视频号: '视频号', 微信公众号: '公众号', B站: '哔哩哔哩', b站: '哔哩哔哩', 今日头条: '头条号', 抖音: '抖音' };
  const normalized = `KOC${aliases[text] || text}`;
  return ZHIHU_MEDIA_TYPES.find(item => item === normalized);
}

export function parseReleaseTime(value: unknown, date1904 = false): string | undefined {
  let text = cellText(value);
  if (!text) return;
  if (typeof value === 'number') {
    const d = XLSX.SSF.parse_date_code(value, { date1904 });
    if (!d || d.y < 1970 || d.y > 2100) return;
    text = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')} ${String(d.H).padStart(2, '0')}:${String(d.M).padStart(2, '0')}:${String(Math.floor(d.S)).padStart(2, '0')}`;
  }
  text = text.replace(/年|月|\//g, '-').replace(/日/g, '').trim();
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?)?(Z|[+-]\d{2}:\d{2})?$/.exec(text);
  if (!match) return;
  const [, year, month, day, hour = '00', minute = '00', second = '00', ms = '', zone = '+08:00'] = match;
  const utc = new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second));
  if (utc.getUTCFullYear() !== +year || utc.getUTCMonth() !== +month - 1 || utc.getUTCDate() !== +day || +hour > 23 || +minute > 59 || +second > 59) return;
  const date = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:${second}${ms}${zone}`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}
export function parseCategory(value: unknown, sub = false): number | undefined {
  if (cellText(value) === '') return;
  const options = sub ? COMPOSITION_SUB_TYPES : COMPOSITION_TYPES;
  return options.find(option => headerKey(option.label) === headerKey(value) || String(option.value) === cellText(value))?.value;
}

export function parseCompositionFile(file: { originalname: string; buffer: Buffer }, options: ImportOptions) {
  if (!/\.(xlsx|xls|csv)$/i.test(file.originalname)) failImport('请选择 .xlsx、.xls 或 .csv 表格');
  if (!file.buffer.length || file.buffer.length > IMPORT_MAX_BYTES) failImport('表格不能为空且不能超过 5 MB');
  let book: XLSX.WorkBook;
  try {
    if (/\.csv$/i.test(file.originalname)) {
      let csv: string;
      try { csv = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer); }
      catch { csv = new TextDecoder('gb18030', { fatal: true }).decode(file.buffer); }
      book = XLSX.read(csv, { type: 'string', cellDates: false, raw: true, sheetRows: IMPORT_MAX_ROWS + 32 });
    } else book = XLSX.read(file.buffer, { type: 'buffer', cellDates: false, raw: true, sheetRows: IMPORT_MAX_ROWS + 32 });
  }
  catch { return failImport('无法读取表格，请检查文件是否损坏、加密或格式不正确'); }
  const sheets = book.SheetNames.map(name => {
    const sheet = book.Sheets[name];
    const range = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref'] || 'A1');
    if (range.e.c > 99 || range.e.r > IMPORT_MAX_ROWS + 30) failImport('单张工作表最多 1000 条数据、100 列，请拆分后上传');
    const cells = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '', blankrows: true, range: 0 });
    let header = 0, best = -1;
    for (let index = 0; index < Math.min(cells.length, 30); index++) {
      const score = Object.values(detectMapping(cells[index])).filter(value => value != null).length;
      if (score > best) { best = score; header = index; }
    }
    const meaningful = cells.slice(header + 1).filter(row => row.some((v, i) => i !== detectMapping(cells[header] || []).releaseTime && cellText(v))).length;
    return { name, cells, header, meaningful };
  });
  const selected = options.sheetName ? sheets.find(s => s.name === options.sheetName) : [...sheets].sort((a, b) => b.meaningful - a.meaningful)[0];
  if (!selected) return failImport('找不到工作表');
  const header = options.headerRow != null ? options.headerRow - 1 : selected.header;
  if (header >= selected.cells.length) return failImport('表头行超出工作表范围');
  const headers = selected.cells[header];
  const mapping = { ...detectMapping(headers), ...options.mapping } as ImportMapping;
  for (const [key, index] of Object.entries(mapping)) {
    if (!importFields.some(field => field.key === key) || (index != null && index >= headers.length)) failImport('字段对应关系不正确，请重新选择');
  }
  const used = Object.values(mapping).filter(v => v != null);
  if (new Set(used).size !== used.length) failImport('同一列不能同时对应多个字段');
  const parsedRows = selected.cells.slice(header + 1).flatMap((cells, index) => {
    // Empty formatted rows and a date-only placeholder are not work registrations.
    if (!cells.some((v, i) => i !== mapping.releaseTime && cellText(v))) return [];
    const values = Object.fromEntries(importFields.map(({ key }) => [key, mapping[key] == null ? '' : cells[mapping[key]!] ?? ''])) as Record<ImportField, unknown>;
    return [{ row: header + index + 2, values }];
  });
  if (parsedRows.length > IMPORT_MAX_ROWS) failImport('一次最多上传 1000 条作品');
  return {
    sheetName: selected.name, sheetNames: sheets.map(s => s.name), headerRow: header + 1, mapping,
    columns: headers.map((label, index) => ({ index, label: cellText(label) || `第 ${index + 1} 列`, samples: selected.cells.slice(header + 1).map(row => cellText(row[index])).filter(Boolean).slice(0, 3) })),
    date1904: !!book.Workbook?.WBProps?.date1904, parsedRows,
  };
}
