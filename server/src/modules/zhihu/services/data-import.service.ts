import crypto from 'node:crypto';
import { assertLegacyRoute } from '../attribution/routing';
import * as XLSX from 'xlsx';
import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { rows, withTransaction } from '../../../db';
import { assertDataScope } from '../../../core/accounts';
import { AppError } from '../../../middleware/errors';
import { AuthUser } from '../../../types';
import { writeAudit } from '../../../services/audit.service';
import { isDevDemoAuthUser } from '../dev-demo';
import { AllianceXlsxValidationError, validateAllianceXlsx, type AllianceUploadFile } from '../zhihu/allianceXlsx';
import type { Scope } from '../attribution/domain';

export type DataImportSourceType = 'email_attachment' | 'manual_excel';
export type DataImportReportType = 'search' | 'order' | 'unknown';
export type DataImportBatchStatus = 'preview' | 'confirmed' | 'rejected';

export interface DataImportAttributionSummary {
  scope: Scope;
  attributionBatchId: string;
  analyzedRows: number;
  matchedRows: number;
  exceptionRows: number;
  orders: string;
  payable: string;
  issues: number;
  from: string | null;
  to: string | null;
}

export const DATA_IMPORT_PREVIEW_LIMIT = 20;
export const DATA_IMPORT_MAX_ROWS = 10_000;
const DATA_IMPORT_MAX_ERRORS = 1_000;
const DATA_IMPORT_INSERT_CHUNK = 250;

const CP1252_SPECIAL_BYTES: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x2c6: 0x88,
  0x2030: 0x89,
  0x160: 0x8a,
  0x2039: 0x8b,
  0x152: 0x8c,
  0x17d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x2dc: 0x98,
  0x2122: 0x99,
  0x161: 0x9a,
  0x203a: 0x9b,
  0x153: 0x9c,
  0x17e: 0x9e,
  0x178: 0x9f,
};

function latin1LikeBytes(value: string): Buffer | null {
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) return null;
    const byte = codePoint <= 0xff ? codePoint : CP1252_SPECIAL_BYTES[codePoint];
    if (byte === undefined) return null;
    bytes.push(byte);
  }
  return Buffer.from(bytes);
}

function filenameQuality(value: string): number {
  const cjkCount = (value.match(/[\u3400-\u9fff]/gu) ?? []).length;
  const controlCount = (value.match(/[\u0000-\u001f\u007f-\u009f]/gu) ?? []).length;
  const replacementCount = (value.match(/\ufffd/gu) ?? []).length;
  const mojibakeCount = (value.match(/[ÃÂâæåçäèéïðÎ]/gu) ?? []).length;
  return cjkCount * 10 - controlCount * 20 - replacementCount * 20 - mojibakeCount;
}

/**
 * Multer/Busboy may expose multipart filenames as a Latin-1-like string.
 * Compare the decoded candidate with the original instead of relying on one
 * fixed mojibake pattern; this also covers filenames such as the one shown
 * in the import history screenshot.
 */
export function normalizeUploadFilename(value: unknown): string {
  const original = String(value ?? '');
  const bytes = latin1LikeBytes(original);
  if (!bytes) return original;
  const decoded = bytes.toString('utf8');
  if (
    decoded &&
    !decoded.includes('\ufffd') &&
    decoded !== original &&
    filenameQuality(decoded) > filenameQuality(original)
  ) {
    return decoded;
  }
  return original;
}

export interface DataImportError {
  rowNumber: number;
  messages: string[];
}

export interface DataImportPreviewRow {
  rowNumber: number;
  occurredAt: string | null;
  channelName: string | null;
  keyword: string | null;
  promotionTask: string | null;
  riskDecision: string | null;
  searchVolume: string | null;
  orderCount: string | null;
  searchConversionRate: string | null;
  revenueAmount: string | null;
  validationStatus: 'valid' | 'invalid';
  errors: string[];
  raw: Record<string, unknown>;
}

export interface DataImportFieldMapping {
  field: string;
  label: string;
  sourceHeader: string | null;
}

export interface DataImportBatch {
  id: string;
  sourceType: DataImportSourceType;
  fileName: string;
  fileSize: number;
  fileSha256: string;
  sheetName: string;
  reportType: DataImportReportType;
  status: DataImportBatchStatus;
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors: DataImportError[];
  createdAt: string;
  confirmedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
}

export interface DataImportConfirmResult extends DataImportBatch {
  imported: number;
  failed: number;
  taskIds: string[];
  attribution?: DataImportAttributionSummary;
}

export interface DataImportPreview extends DataImportBatch {
  headers: string[];
  fieldMappings: DataImportFieldMapping[];
  previewRows: DataImportPreviewRow[];
  isDuplicate?: boolean;
}

/** 已保存批次的明细；预览只返回前 20 行，历史详情按页返回全部行。 */
export interface DataImportBatchDetail extends DataImportBatch {
  headers: string[];
  fieldMappings: DataImportFieldMapping[];
  rows: DataImportPreviewRow[];
  page: number;
  pageSize: number;
  total: number;
}

interface HeaderMap {
  occurredAt: number;
  channelName: number;
  keyword: number;
  promotionTask: number;
  riskDecision: number;
  searchVolume: number;
  orderCount: number;
  searchConversionRate: number;
  revenueAmount: number;
}

interface ParsedImport {
  sheetName: string;
  headers: string[];
  fieldMappings: DataImportFieldMapping[];
  reportType: DataImportReportType;
  rows: DataImportPreviewRow[];
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors: DataImportError[];
}

interface DataImportBatchRow extends RowDataPacket {
  id: string;
  source_type: DataImportSourceType;
  file_name: string;
  file_size: number;
  file_sha256: string;
  sheet_name: string;
  report_type: DataImportReportType;
  status: DataImportBatchStatus;
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  errors_json: unknown;
  headers_json: unknown;
  created_by: string;
  confirmed_at: Date | string | null;
  rejected_at: Date | string | null;
  rejection_reason: string | null;
  created_at: Date | string;
}

interface CountRow extends RowDataPacket {
  total: number;
}

interface AttributionImportRow extends RowDataPacket {
  occurred_at: Date | string | null;
  keyword: string | null;
  search_volume: string | number | null;
  order_count: string | number | null;
  revenue_amount: string | number | null;
}

const HEADER_CANDIDATES: Record<keyof HeaderMap, string[]> = {
  occurredAt: ['日期时间', '日期', '时间', '统计时间', '统计日期', 'datetime', 'date time', 'data_date', 'date'],
  channelName: ['渠道名称', '渠道', 'channel name', 'channel'],
  keyword: ['关键词', '关键字', 'keyword'],
  promotionTask: ['推广任务', '任务名称', '任务', 'promotion task', 'task'],
  riskDecision: ['风险判定', '风险判断', '风险', 'risk decision', 'risk'],
  searchVolume: ['搜索量', '搜索次数', 'search volume', 'searches', 'impressions'],
  orderCount: ['订单量', '订单数', '转化数', '转化量', 'conversions', 'conversion_count', 'orders', 'order count'],
  searchConversionRate: ['搜索转化率', '转化率', 'search conversion rate', 'conversion rate'],
  revenueAmount: ['收益金额', '收益', '收入', '金额', 'revenue', '佣金', 'commission'],
};

const FIELD_LABELS: Record<keyof HeaderMap, string> = {
  occurredAt: '日期时间',
  channelName: '渠道名称',
  keyword: '关键词',
  promotionTask: '推广任务',
  riskDecision: '风险判定',
  searchVolume: '搜索量',
  orderCount: '订单量 / 转化数',
  searchConversionRate: '搜索转化率',
  revenueAmount: '收益金额',
};

const emptyHeaderMap = (): HeaderMap => ({
  occurredAt: -1,
  channelName: -1,
  keyword: -1,
  promotionTask: -1,
  riskDecision: -1,
  searchVolume: -1,
  orderCount: -1,
  searchConversionRate: -1,
  revenueAmount: -1,
});

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, '');
}

function mapHeaders(headers: string[]): HeaderMap {
  const normalized = headers.map(normalizeHeader);
  const map = emptyHeaderMap();
  for (const key of Object.keys(HEADER_CANDIDATES) as Array<keyof HeaderMap>) {
    for (const candidate of HEADER_CANDIDATES[key]) {
      const normalizedCandidate = normalizeHeader(candidate);
      const exactIndex = normalized.indexOf(normalizedCandidate);
      const index = exactIndex !== -1
        ? exactIndex
        : normalized.findIndex((header) => header.includes(normalizedCandidate));
      if (index !== -1) {
        map[key] = index;
        break;
      }
    }
  }
  return map;
}

function fieldMappings(headers: string[], map = mapHeaders(headers)): DataImportFieldMapping[] {
  return (Object.keys(FIELD_LABELS) as Array<keyof HeaderMap>).map((field) => ({
    field,
    label: FIELD_LABELS[field],
    sourceHeader: map[field] === -1 ? null : headers[map[field]] || null,
  }));
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function dateTimeParts(y: number, m: number, d: number, h = 0, minute = 0, second = 0): string | null {
  if (![y, m, d, h, minute, second].every(Number.isFinite)) return null;
  const date = new Date(Date.UTC(y, m - 1, d, h, minute, second));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d ||
    date.getUTCHours() !== h ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  )
    return null;
  return `${y}-${pad(m)}-${pad(d)} ${pad(h)}:${pad(minute)}:${pad(second)}`;
}

function parseDateTime(value: unknown): string | null {
  if (value === null || value === undefined || cellText(value) === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return dateTimeParts(
      value.getFullYear(),
      value.getMonth() + 1,
      value.getDate(),
      value.getHours(),
      value.getMinutes(),
      value.getSeconds(),
    );
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return dateTimeParts(parsed.y, parsed.m, parsed.d, parsed.H, parsed.M, Math.floor(parsed.S));
  }
  const text = cellText(value)
    .replace(/[年./]/gu, '-')
    .replace(/月/gu, '-')
    .replace(/日/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?)?$/u.exec(text);
  if (!match) return null;
  return dateTimeParts(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4] ?? 0),
    Number(match[5] ?? 0),
    Number(match[6] ?? 0),
  );
}

function decimalText(value: unknown, maxFraction: number): string | null {
  if (value === null || value === undefined) return null;
  const text = cellText(value).replace(/[¥￥,\s]/gu, '');
  const pattern = new RegExp(`^\\d+(?:\\.\\d{1,${maxFraction}})?$`, 'u');
  if (!pattern.test(text)) return null;
  const [integer, fraction = ''] = text.split('.');
  return `${integer.replace(/^0+(?=\d)/u, '')}${fraction ? `.${fraction}` : ''}`;
}

function countText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = cellText(value).replace(/[,\s]/gu, '');
  if (/^\d+$/.test(text)) return text.replace(/^0+(?=\d)/u, '');
  if (/^\d+\.0+$/.test(text)) return text.slice(0, text.indexOf('.')).replace(/^0+(?=\d)/u, '');
  return null;
}

function rateText(value: unknown): string | null {
  if (value === null || value === undefined || cellText(value) === '') return null;
  const raw = cellText(value).replace(/\s/gu, '');
  const isPercent = raw.endsWith('%');
  const numericText = isPercent ? raw.slice(0, -1) : raw;
  const parsed = decimalText(numericText, 6);
  if (parsed === null) return null;
  const numeric = Number(parsed);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > (isPercent ? 100 : 100)) return null;
  const ratio = isPercent || numeric > 1 ? numeric / 100 : numeric;
  if (ratio < 0 || ratio > 1) return null;
  return ratio.toFixed(6);
}

function rawValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

function rawRow(headers: string[], row: unknown[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  headers.forEach((header, index) => {
    const base = header || `列${index + 1}`;
    let key = base;
    let suffix = 2;
    while (Object.prototype.hasOwnProperty.call(result, key)) key = `${base}#${suffix++}`;
    result[key] = rawValue(row[index]);
  });
  return result;
}

function isBlankRow(row: unknown[]): boolean {
  return row.every((value) => cellText(value) === '');
}

function rowCell(row: unknown[], index: number): unknown {
  return index === -1 ? null : row[index];
}

function dataRow(
  rowNumber: number,
  row: unknown[],
  headers: string[],
  map: HeaderMap,
  reportType: DataImportReportType,
): DataImportPreviewRow {
  const errors: string[] = [];
  const occurredAt = parseDateTime(rowCell(row, map.occurredAt));
  const channelName = cellText(rowCell(row, map.channelName)) || null;
  const keyword = cellText(rowCell(row, map.keyword)) || null;
  const promotionTask = cellText(rowCell(row, map.promotionTask)) || null;
  const riskDecision = cellText(rowCell(row, map.riskDecision)) || null;
  const searchVolume = countText(rowCell(row, map.searchVolume));
  const orderCount = countText(rowCell(row, map.orderCount));
  const searchConversionRate = rateText(rowCell(row, map.searchConversionRate));
  const revenueAmount = decimalText(rowCell(row, map.revenueAmount), 4);

  if (map.occurredAt === -1 || occurredAt === null) errors.push('日期时间为空或格式不正确');
  if (map.channelName === -1 || channelName === null) errors.push('渠道名称为空');
  if (map.keyword === -1 || keyword === null) errors.push('关键词为空');
  if (map.searchVolume === -1) errors.push('缺少搜索量列');
  else if (searchVolume === null) errors.push('搜索量为空或不是非负整数');
  if (reportType === 'order' && (map.orderCount === -1 || orderCount === null)) errors.push('订单量为空或不是非负整数');
  if (searchVolume !== null && orderCount !== null && Number(orderCount) > Number(searchVolume)) {
    errors.push('订单量 / 转化数不能大于搜索量');
  }
  if (revenueAmount !== null && orderCount !== null && Number(revenueAmount) > Number(orderCount) * 1000) {
    errors.push('收益金额异常：单次转化超过 1000 元');
  }
  if (
    map.searchConversionRate !== -1 &&
    cellText(rowCell(row, map.searchConversionRate)) !== '' &&
    searchConversionRate === null
  ) {
    errors.push('搜索转化率格式不正确');
  }
  if (map.revenueAmount !== -1 && cellText(rowCell(row, map.revenueAmount)) !== '' && revenueAmount === null) {
    errors.push('收益金额格式不正确');
  }

  return {
    rowNumber,
    occurredAt,
    channelName,
    keyword,
    promotionTask,
    riskDecision,
    searchVolume,
    orderCount,
    searchConversionRate,
    revenueAmount,
    validationStatus: errors.length ? 'invalid' : 'valid',
    errors,
    raw: rawRow(headers, row),
  };
}

/** 只负责把已通过安全校验的 XLSX 转成标准化预览，不触碰数据库。 */
export function parseDataImportWorkbook(buffer: Buffer): ParsedImport {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', dense: true, cellDates: false, cellFormula: false });
  } catch {
    throw new AppError(422, 42217, '无法读取 Excel 文件，请确认文件未损坏');
  }
  const sheetName = workbook.SheetNames.find((name) => workbook.Sheets[name] !== undefined);
  if (!sheetName) throw new AppError(422, 42217, 'Excel 中没有任何工作表');
  const sheet = workbook.Sheets[sheetName];
  const rows2d = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  if (!rows2d.length) throw new AppError(422, 42217, 'Excel 内容为空');

  let headerRow = -1;
  let headers: string[] = [];
  let map = emptyHeaderMap();
  for (let index = 0; index < Math.min(10, rows2d.length); index += 1) {
    const candidate = (rows2d[index] ?? []).map(cellText);
    const candidateMap = mapHeaders(candidate);
    const knownColumns = Object.values(candidateMap).filter((column) => column !== -1).length;
    if (
      candidateMap.occurredAt !== -1 &&
      candidateMap.channelName !== -1 &&
      candidateMap.keyword !== -1 &&
      knownColumns >= 3
    ) {
      headerRow = index;
      headers = candidate;
      map = candidateMap;
      break;
    }
  }
  if (headerRow === -1) throw new AppError(422, 42217, '未找到表头：至少需要日期时间、渠道名称、关键词三列');

  const dataRows = rows2d
    .map((row, index) => ({ row: row ?? [], index }))
    .filter(({ row, index }) => index > headerRow && !isBlankRow(row));
  if (!dataRows.length) throw new AppError(422, 42217, 'Excel 中没有可导入的数据行');
  if (dataRows.length > DATA_IMPORT_MAX_ROWS)
    throw new AppError(422, 42220, `单个文件最多导入 ${DATA_IMPORT_MAX_ROWS} 行`);

  const reportType: DataImportReportType =
    map.orderCount !== -1 ? 'order' : map.searchVolume !== -1 ? 'search' : 'unknown';
  const parsedRows = dataRows.map(({ row, index }) => dataRow(index + 1, row, headers, map, reportType));
  const errors = parsedRows
    .filter((row) => row.validationStatus === 'invalid')
    .slice(0, DATA_IMPORT_MAX_ERRORS)
    .map((row) => ({ rowNumber: row.rowNumber, messages: row.errors }));

  return {
    sheetName,
    headers,
    fieldMappings: fieldMappings(headers, map),
    reportType,
    rows: parsedRows,
    totalRows: parsedRows.length,
    validRows: parsedRows.filter((row) => row.validationStatus === 'valid').length,
    errorRows: parsedRows.filter((row) => row.validationStatus === 'invalid').length,
    errors,
  };
}

function parseErrors(value: unknown): DataImportError[] {
  if (Array.isArray(value)) return value as DataImportError[];
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as DataImportError[]) : [];
  } catch {
    return [];
  }
}

function parseHeaders(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

interface DataImportRowRow extends RowDataPacket {
  row_number: number;
  occurred_at: Date | string | null;
  channel_name: string | null;
  keyword: string | null;
  promotion_task: string | null;
  risk_decision: string | null;
  search_volume: string | number | null;
  order_count: string | number | null;
  search_conversion_rate: string | number | null;
  revenue_amount: string | number | null;
  validation_status: 'valid' | 'invalid';
  errors_json: unknown;
  raw_json: unknown;
}

function parseRaw(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function nullableText(value: string | number | null): string | null {
  return value === null || value === undefined ? null : String(value);
}

function previewRowFromDb(row: DataImportRowRow): DataImportPreviewRow {
  return {
    rowNumber: Number(row.row_number),
    occurredAt: row.occurred_at ? asDateString(row.occurred_at) : null,
    channelName: row.channel_name,
    keyword: row.keyword,
    promotionTask: row.promotion_task,
    riskDecision: row.risk_decision,
    searchVolume: nullableText(row.search_volume),
    orderCount: nullableText(row.order_count),
    searchConversionRate: nullableText(row.search_conversion_rate),
    revenueAmount: nullableText(row.revenue_amount),
    validationStatus: row.validation_status,
    errors: parseStringArray(row.errors_json),
    raw: parseRaw(row.raw_json),
  };
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function asDateString(value: Date | string | null | undefined): string {
  if (value instanceof Date) return value.toISOString();
  return value ? String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z') : new Date().toISOString();
}

function batchFromRow(row: DataImportBatchRow, overrides: Partial<DataImportBatch> = {}): DataImportBatch {
  return {
    id: String(row.id),
    sourceType: row.source_type,
    fileName: normalizeUploadFilename(row.file_name),
    fileSize: Number(row.file_size),
    fileSha256: row.file_sha256,
    sheetName: row.sheet_name,
    reportType: row.report_type,
    status: row.status,
    totalRows: Number(row.total_rows),
    validRows: Number(row.valid_rows),
    errorRows: Number(row.error_rows),
    errors: parseErrors(row.errors_json),
    createdAt: asDateString(row.created_at),
    confirmedAt: row.confirmed_at ? asDateString(row.confirmed_at) : null,
    rejectedAt: row.rejected_at ? asDateString(row.rejected_at) : null,
    rejectionReason: row.rejection_reason,
    ...overrides,
  };
}

function previewFromParsed(
  batch: DataImportBatch,
  parsed: ParsedImport,
  isDuplicate = false,
): DataImportPreview {
  return {
    ...batch,
    headers: parsed.headers,
    fieldMappings: parsed.fieldMappings,
    previewRows: parsed.rows.slice(0, DATA_IMPORT_PREVIEW_LIMIT),
    isDuplicate,
  };
}

async function storedPreview(
  connection: PoolConnection,
  batch: DataImportBatchRow,
  isDuplicate = false,
): Promise<DataImportPreview> {
  const [storedRows] = await connection.query<DataImportRowRow[]>(
     `SELECT \`row_number\`, occurred_at, channel_name, keyword, promotion_task, risk_decision,
            search_volume, order_count, search_conversion_rate, revenue_amount,
            validation_status, errors_json, raw_json
     FROM data_import_rows WHERE batch_id = ? ORDER BY \`row_number\` LIMIT ?`,
    [batch.id, DATA_IMPORT_PREVIEW_LIMIT],
  );
  return {
    ...batchFromRow(batch),
    headers: parseHeaders(batch.headers_json),
    fieldMappings: fieldMappings(parseHeaders(batch.headers_json)),
    previewRows: storedRows.map(previewRowFromDb),
    isDuplicate,
  };
}

const demoBatches: DataImportPreview[] = [];
const demoBatchRows = new Map<string, DataImportPreviewRow[]>();
const demoAttributionTaskIds = new Map<string, string[]>();
let demoSequence = Date.now();
let demoTaskSequence = Date.now();

function dataDates(rows: DataImportPreviewRow[]): string[] {
  return [...new Set(rows
    .filter((row) => row.validationStatus === 'valid' && row.occurredAt)
    .map((row) => String(row.occurredAt).slice(0, 10)))];
}

function createDemoAttributionTaskIds(batchId: string, rows: DataImportPreviewRow[]): string[] {
  const existing = demoAttributionTaskIds.get(batchId);
  if (existing) return existing;
  const keys = [...new Set(rows
    .filter((row) => row.validationStatus === 'valid' && row.occurredAt && row.keyword)
    .map((row) => `${String(row.occurredAt).slice(0, 10)}\u0000${String(row.keyword).trim()}`))];
  const taskIds = keys.map(() => `attribution-task-demo-${++demoTaskSequence}`);
  demoAttributionTaskIds.set(batchId, taskIds);
  return taskIds;
}

function finiteNumber(value: string | number | null): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * 确认导入时只把邮件汇总数据生成 pending 归因任务，不执行归因计算、不写入 earnings。
 * 同一日期和关键词由 attribution_tasks 的唯一键保证幂等。
 */
async function createAttributionTasksForBatch(connection: PoolConnection, batchId: string): Promise<string[]> {
  // 旧行没有可靠账号与项目范围，按业务日期保守拦截新周期。
  const routeDates=await connection.query<RowDataPacket[]>("SELECT DISTINCT DATE_FORMAT(occurred_at,'%Y-%m-%d') day FROM data_import_rows WHERE batch_id=? AND validation_status='valid'",[batchId]);
  for(const row of routeDates[0])await assertLegacyRoute(connection,null,row.day?String(row.day):null);
  const importRows = await connection.query<AttributionImportRow[]>(
    `SELECT occurred_at, keyword, search_volume, order_count, revenue_amount
     FROM data_import_rows
     WHERE batch_id = ? AND validation_status = 'valid'
     ORDER BY \`row_number\``,
    [batchId],
  );
  const [sourceRows] = importRows;
  const groups = new Map<string, { dataDate: string; keyword: string; revenue: number; searchVolume: number; conversions: number }>();

  for (const row of sourceRows) {
    if (!row.occurred_at || !row.keyword) continue;
    const dataDate = asDateString(row.occurred_at).slice(0, 10);
    const keyword = String(row.keyword).trim();
    if (!keyword) continue;
    const key = `${dataDate}\u0000${keyword}`;
    const current = groups.get(key) ?? { dataDate, keyword, revenue: 0, searchVolume: 0, conversions: 0 };
    current.revenue += finiteNumber(row.revenue_amount);
    current.searchVolume += finiteNumber(row.search_volume);
    current.conversions += finiteNumber(row.order_count);
    groups.set(key, current);
  }

  const taskIds: string[] = [];
  for (const group of groups.values()) {
    const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO attribution_tasks
        (data_date, keyword, total_revenue, search_volume, conversion_count, status)
       VALUES (?, ?, ?, ?, ?, 'pending')
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [
        group.dataDate,
        group.keyword,
        Math.round(group.revenue * 100),
        Math.round(group.searchVolume),
        Math.round(group.conversions),
      ],
    );
    taskIds.push(String(result.insertId));
  }
  return taskIds;
}

async function persistParsedImport(
  user: AuthUser,
  file: AllianceUploadFile,
  sourceType: DataImportSourceType,
  parsed: ParsedImport,
  ip?: string,
): Promise<DataImportPreview> {
  const buffer = file.buffer as Buffer;
  const fileSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const fileName = normalizeUploadFilename(file.originalname);
  const fileSize = buffer.length;
  const createdAt = new Date().toISOString();

  return withTransaction(async (connection) => {
    const [existingRows] = await connection.query<DataImportBatchRow[]>(
      'SELECT * FROM data_import_batches WHERE file_sha256 = ? LIMIT 1 FOR UPDATE',
      [fileSha256],
    );
    const existing = existingRows[0];
    if (existing) return storedPreview(connection, existing, true);

    // 文件内部元数据可能变化，导致同一日报的 SHA 不同；按文档约定再按“日期 + 报表类型”拦截重复导入。
    const dates = dataDates(parsed.rows);
    if (dates.length === 1 && parsed.reportType !== 'unknown') {
      const [sameDayRows] = await connection.query<DataImportBatchRow[]>(
        `SELECT b.*
         FROM data_import_batches b
         INNER JOIN data_import_rows r ON r.batch_id = b.id
         WHERE b.report_type = ?
           AND r.validation_status = 'valid'
           AND DATE(r.occurred_at) = ?
         GROUP BY b.id
         ORDER BY b.id DESC
         LIMIT 1`,
        [parsed.reportType, dates[0]],
      );
      if (sameDayRows[0]) return storedPreview(connection, sameDayRows[0], true);
    }
    const [result] = await connection.query<ResultSetHeader>(
      `INSERT IGNORE INTO data_import_batches
        (source_type, file_name, file_size, file_sha256, sheet_name, report_type, status, total_rows, valid_rows, error_rows, errors_json, headers_json, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'preview', ?, ?, ?, ?, ?, ?)`,
      [
        sourceType,
        fileName,
        fileSize,
        fileSha256,
        parsed.sheetName,
        parsed.reportType,
        parsed.totalRows,
        parsed.validRows,
        parsed.errorRows,
        JSON.stringify(parsed.errors),
        JSON.stringify(parsed.headers),
        user.sub,
      ],
    );
    if (result.affectedRows === 0) {
      const [concurrentRows] = await connection.query<DataImportBatchRow[]>(
        'SELECT * FROM data_import_batches WHERE file_sha256 = ? LIMIT 1 FOR UPDATE',
        [fileSha256],
      );
      if (!concurrentRows[0]) throw new AppError(500, 50000, '导入批次保存失败');
      return storedPreview(connection, concurrentRows[0], true);
    }
    const batchId = String(result.insertId);
    for (let start = 0; start < parsed.rows.length; start += DATA_IMPORT_INSERT_CHUNK) {
      const chunk = parsed.rows.slice(start, start + DATA_IMPORT_INSERT_CHUNK);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',');
      const bindings = chunk.flatMap((row) => [
        batchId,
        row.rowNumber,
        row.occurredAt,
        row.channelName,
        row.keyword,
        row.promotionTask,
        row.riskDecision,
        row.searchVolume,
        row.orderCount,
        row.searchConversionRate,
        row.revenueAmount,
        row.validationStatus,
        JSON.stringify(row.errors),
        JSON.stringify(row.raw),
      ]);
      await connection.query(
        `INSERT INTO data_import_rows
          (batch_id, \`row_number\`, occurred_at, channel_name, keyword, promotion_task, risk_decision, search_volume, order_count, search_conversion_rate, revenue_amount, validation_status, errors_json, raw_json)
         VALUES ${placeholders}`,
        bindings,
      );
    }
    await writeAudit(
      {
        userId: user.sub,
        action: 'data_import.parse',
        resourceType: 'data_import_batch',
        resourceId: batchId,
        detail: {
          sourceType,
          fileName,
          totalRows: parsed.totalRows,
          validRows: parsed.validRows,
          errorRows: parsed.errorRows,
        },
        ip,
      },
      connection,
    );
    return previewFromParsed(
      {
        id: batchId,
        sourceType,
        fileName,
        fileSize,
        fileSha256,
        sheetName: parsed.sheetName,
        reportType: parsed.reportType,
        status: 'preview',
        totalRows: parsed.totalRows,
        validRows: parsed.validRows,
        errorRows: parsed.errorRows,
        errors: parsed.errors,
        createdAt,
        confirmedAt: null,
        rejectedAt: null,
        rejectionReason: null,
      },
      parsed,
    );
  });
}

export async function parseDataImport(
  user: AuthUser,
  file: AllianceUploadFile,
  sourceType: DataImportSourceType,
  ip?: string,
): Promise<DataImportPreview> {
  const normalizedFile = { ...file, originalname: normalizeUploadFilename(file.originalname) };
  try {
    await validateAllianceXlsx(normalizedFile, { allowFormulas: true });
  } catch (error) {
    if (error instanceof AllianceXlsxValidationError)
      throw new AppError(422, 42216, '上传文件不符合要求：仅接受合法的 .xlsx 文件');
    throw error;
  }
  const parsed = parseDataImportWorkbook(normalizedFile.buffer as Buffer);
  if (isDevDemoAuthUser(user)) {
    const fileSha256 = crypto
      .createHash('sha256')
      .update(normalizedFile.buffer as Buffer)
      .digest('hex');
    const existing = demoBatches.find((item) => item.fileSha256 === fileSha256);
    if (existing) return { ...existing, isDuplicate: true };
    const dates = dataDates(parsed.rows);
    if (dates.length === 1 && parsed.reportType !== 'unknown') {
      const sameDay = demoBatches.find((item) => {
        if (item.reportType !== parsed.reportType) return false;
        const storedRows = demoBatchRows.get(item.id) ?? item.previewRows;
        return dataDates(storedRows).includes(dates[0]);
      });
      if (sameDay) return { ...sameDay, isDuplicate: true };
    }
    const id = `data-import-demo-${++demoSequence}`;
    const batch: DataImportPreview = previewFromParsed(
      {
        id,
        sourceType,
        fileName: String(normalizedFile.originalname),
        fileSize: (normalizedFile.buffer as Buffer).length,
        fileSha256,
        sheetName: parsed.sheetName,
        reportType: parsed.reportType,
        status: 'preview',
        totalRows: parsed.totalRows,
        validRows: parsed.validRows,
        errorRows: parsed.errorRows,
        errors: parsed.errors,
        createdAt: new Date().toISOString(),
        confirmedAt: null,
        rejectedAt: null,
        rejectionReason: null,
      },
      parsed,
    );
    demoBatches.unshift(batch);
    demoBatchRows.set(id, parsed.rows);
    return batch;
  }
  return persistParsedImport(user, normalizedFile, sourceType, parsed, ip);
}


async function resolveLegacyAttributionScope(user: AuthUser): Promise<Scope> {
  const candidates = await rows<RowDataPacket>(
    `SELECT CAST(pi.project_id AS CHAR) project_id,CAST(pi.account_id AS CHAR) account_id,
            EXISTS(SELECT 1 FROM zh_engine_routes er WHERE er.project_id=pi.project_id AND er.account_id=pi.account_id) has_route
     FROM project_integrations pi
     JOIN integration_accounts a ON a.id=pi.account_id
     JOIN projects p ON p.id=pi.project_id
     WHERE a.module_id='zhihu' AND a.status='active' AND p.is_enabled=1
       AND (?='admin' OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=pi.project_id AND pm.user_id=? AND pm.left_at IS NULL))
     ORDER BY has_route DESC,pi.project_id,pi.account_id`,
    [user.role, user.sub],
  );
  const latest = await rows<RowDataPacket>(
    'SELECT CAST(project_id AS CHAR) project_id,CAST(account_id AS CHAR) account_id FROM zh_import_batches WHERE created_by=? ORDER BY id DESC LIMIT 1',
    [user.sub],
  );
  const latestScope = latest[0] && candidates.find((row) => String(row.project_id) === String(latest[0].project_id) && String(row.account_id) === String(latest[0].account_id));
  const routed = candidates.filter((row) => Number(row.has_route) === 1);
  const selected = latestScope ?? (routed.length === 1 ? routed[0] : candidates.length === 1 ? candidates[0] : null);
  if (!selected) throw new AppError(409, 40912, 'Multiple Zhihu project scopes require a workbench selection');
  const scope = { projectId: String(selected.project_id), accountId: String(selected.account_id) };
  await assertDataScope(user, scope.projectId, scope.accountId, 'zhihu');
  return scope;
}

function legacyDate(row: RowDataPacket): string | null {
  try {
    const raw = typeof row.raw_json === 'string' ? JSON.parse(row.raw_json) : row.raw_json;
    if (raw && typeof raw === 'object') {
      const value = Object.values(raw as Record<string, unknown>).find(
        (item) => typeof item === 'string' && /^\d{4}-\d{2}-\d{2}/u.test(item),
      );
      if (typeof value === 'string') {
        const artifact = /T15:59:17(?:\.000)?Z$/u.test(value);
        if (artifact) {
          const corrected = new Date(Date.parse(value) + 86400000);
          return corrected.toISOString().slice(0, 10);
        }
        return value.slice(0, 10);
      }
    }
  } catch {}
  return row.occurred_at ? String(row.occurred_at).slice(0, 10) : null;
}
async function bridgeConfirmedImport(user: AuthUser, id: string): Promise<DataImportAttributionSummary> {
  const scope = await resolveLegacyAttributionScope(user);
  const imported = await withTransaction(async (connection) => {
    const [batchRows] = await connection.query<RowDataPacket[]>(
      `SELECT * FROM data_import_batches WHERE id=? FOR UPDATE`, [id],
    );
    const batch = batchRows[0];
    if (!batch) throw new AppError(404, 40401, '导入批次不存在');
    const [sourceRows] = await connection.query<RowDataPacket[]>(
      "SELECT * FROM data_import_rows WHERE batch_id=? AND validation_status='valid' ORDER BY `row_number`", [id],
    );
    if (!sourceRows.length) throw new AppError(422, 42219, '批次没有可分析的有效行');
    const dates = sourceRows.map(legacyDate).filter((value): value is string => Boolean(value)).sort();
    if (!dates.length) throw new AppError(422, 42219, '批次没有可识别的业务日期');
    const hasSearch = sourceRows.some((row) => row.search_volume !== null);
    const hasOrders = sourceRows.some((row) => row.order_count !== null);
    const reportKind = hasSearch && hasOrders ? 'combined' : hasOrders ? 'order' : 'search';
    const hash = String(batch.file_sha256);
    const [existing] = await connection.query<RowDataPacket[]>(
      `SELECT id FROM zh_import_batches WHERE account_id=? AND project_id=? AND file_sha256=? AND report_kind=? AND template_version='zhihu-v3' FOR UPDATE`,
      [scope.accountId, scope.projectId, hash, reportKind],
    );
    if (existing[0]) return { id: String(existing[0].id), dates, sourceCount: sourceRows.length };
    const [routeRows] = await connection.query<RowDataPacket[]>(
      `SELECT id,DATE_FORMAT(exclusive_from,'%Y-%m-%d') start,mode FROM zh_engine_routes WHERE account_id=? AND project_id=? FOR UPDATE`,
      [scope.accountId, scope.projectId],
    );
    const route = routeRows[0];
    if (route && dates[0] < String(route.start)) return {
      id: '',
      dates,
      sourceCount: sourceRows.length,
      legacyOnly: true,
    };
    if (!route) await connection.query(
      `INSERT INTO zh_engine_routes(account_id,project_id,exclusive_from,mode,reason,updated_by) VALUES(?,?,?,'trial',?,?)`,
      [scope.accountId, scope.projectId, dates[0], '历史导入已确认，进入归因试算', user.sub],
    );
    const previewHash = crypto.createHash('sha256').update(`legacy:${hash}:${scope.projectId}:${scope.accountId}`).digest('hex');
    const [created] = await connection.query<ResultSetHeader>(
      `INSERT INTO zh_import_batches
       (account_id,project_id,file_name,file_sha256,file_bytes,report_kind,template_version,preview_hash,status,created_by,committed_by,committed_at)
       VALUES(?,?,?,?,?,?,?,?, 'committed',?,?,NOW(3))`,
      [scope.accountId, scope.projectId, String(batch.file_name), hash, Buffer.from(`legacy-data-import:${hash}`), reportKind, 'zhihu-v3', previewHash, user.sub, user.sub],
    );
    const batchId = String(created.insertId);
    for (const row of sourceRows) {
      const date = legacyDate(row);
      if (!date || !row.channel_name || !row.keyword) continue;
      const normalized = {
        date, channel: String(row.channel_name).trim(), keyword: String(row.keyword).trim(),
        search: row.search_volume === null ? null : String(row.search_volume),
        orders: row.order_count === null ? null : String(row.order_count),
        revenue: row.revenue_amount === null ? null : String(row.revenue_amount),
        promotionTask: row.promotion_task === null ? null : String(row.promotion_task),
        riskAssessment: row.risk_decision === null ? null : String(row.risk_decision),
        conversionRateRaw: row.search_conversion_rate === null ? null : String(row.search_conversion_rate),
      };
      await connection.query(
        `INSERT INTO zh_import_rows(batch_id,line_number,normalized_json,raw_json,error_text,processing_status) VALUES(?,?,?,?,NULL,'pending')`,
        [batchId, row.row_number, JSON.stringify(normalized), JSON.stringify(row.raw_json)],
      );
    }
    return { id: batchId, dates, sourceCount: sourceRows.length };
  });
  const facts = await import('../attribution/facts');
  if (imported.legacyOnly) {
    return {
      scope,
      attributionBatchId: '',
      analyzedRows: imported.sourceCount,
      matchedRows: 0,
      exceptionRows: imported.sourceCount,
      orders: '0',
      payable: '0.0000',
      issues: 0,
      from: imported.dates[0],
      to: imported.dates[imported.dates.length - 1],
    };
  }
  await facts.processBatch(user, scope, imported.id, 200);
  const workbench = await import('../attribution/workbench');
  const from = imported.dates[0], to = imported.dates[imported.dates.length - 1];
  const overview = await workbench.overview(user, scope, { from, to });
  const counts = await rows<RowDataPacket>(
    `SELECT processing_status,COUNT(*) total FROM zh_import_rows WHERE batch_id=? GROUP BY processing_status`, [imported.id],
  );
  const count = (status: string) => Number(counts.find((row) => String(row.processing_status) === status)?.total ?? 0);
  return {
    scope, attributionBatchId: imported.id, analyzedRows: imported.sourceCount,
    matchedRows: count('processed') + count('duplicate'), exceptionRows: count('exception'),
    orders: overview.summary.orders, payable: overview.summary.payable, issues: overview.summary.issues, from, to,
  };
}
export async function confirmDataImport(
  user: AuthUser,
  id: string,
  ip?: string,
): Promise<DataImportConfirmResult> {
  if (isDevDemoAuthUser(user)) {
    const batch = demoBatches.find((item) => item.id === id);
    if (!batch) throw new AppError(404, 40401, '导入批次不存在');
    const storedRows = demoBatchRows.get(id) ?? batch.previewRows;
    const taskIds = createDemoAttributionTaskIds(id, storedRows);
    if (batch.status === 'confirmed') {
      return { ...batch, imported: batch.validRows, failed: batch.errorRows, taskIds };
    }
    if (batch.status !== 'preview') throw new AppError(422, 42219, '该批次当前不可确认');
    if (batch.validRows === 0) throw new AppError(422, 42219, '该批次没有可确认的有效行，请修正 Excel 后重新上传');
    batch.status = 'confirmed';
    batch.confirmedAt = new Date().toISOString();
    return { ...batch, imported: batch.validRows, failed: batch.errorRows, taskIds };
  }

  const result = await withTransaction(async (connection) => {
    const [batchRows] = await connection.query<DataImportBatchRow[]>(
      'SELECT * FROM data_import_batches WHERE id = ? FOR UPDATE',
      [id],
    );
    const batch = batchRows[0];
    if (!batch) throw new AppError(404, 40401, '导入批次不存在');
    if (batch.status === 'confirmed') {
      const taskIds: string[] = [];
      return { ...batchFromRow(batch), imported: Number(batch.valid_rows), failed: Number(batch.error_rows), taskIds };
    }
    if (batch.status !== 'preview') throw new AppError(422, 42219, '该批次当前不可确认');
    if (Number(batch.valid_rows) === 0) throw new AppError(422, 42219, '该批次没有可确认的有效行，请修正 Excel 后重新上传');

    await connection.query(
      `UPDATE data_import_batches
       SET status = 'confirmed', confirmed_by = ?, confirmed_at = NOW()
       WHERE id = ? AND status = 'preview'`,
      [user.sub, id],
    );
    const taskIds: string[] = [];
    await writeAudit(
      { userId: user.sub, action: 'data_import.confirm', resourceType: 'data_import_batch', resourceId: id, ip },
      connection,
    );
    return {
      ...batchFromRow(batch, { status: 'confirmed', confirmedAt: new Date().toISOString() }),
      imported: Number(batch.valid_rows),
      failed: Number(batch.error_rows),
      taskIds,
    };
  });
  const attribution = await bridgeConfirmedImport(user, id);
  if (!attribution.attributionBatchId) {
    const taskIds = await withTransaction((connection) => createAttributionTasksForBatch(connection, id));
    return { ...result, taskIds, attribution };
  }
  return { ...result, attribution };
}

export async function rejectDataImport(
  user: AuthUser,
  id: string,
  reason?: string,
  ip?: string,
): Promise<DataImportBatch> {
  const normalizedReason = reason?.trim() || null;
  if (isDevDemoAuthUser(user)) {
    const batch = demoBatches.find((item) => item.id === id);
    if (!batch) throw new AppError(404, 40401, '导入批次不存在');
    if (batch.status === 'rejected') return batch;
    if (batch.status !== 'preview') throw new AppError(422, 42219, '该批次当前不可驳回');
    batch.status = 'rejected';
    batch.rejectedAt = new Date().toISOString();
    batch.rejectionReason = normalizedReason;
    return batch;
  }

  return withTransaction(async (connection) => {
    const [batchRows] = await connection.query<DataImportBatchRow[]>(
      'SELECT * FROM data_import_batches WHERE id = ? FOR UPDATE',
      [id],
    );
    const batch = batchRows[0];
    if (!batch) throw new AppError(404, 40401, '导入批次不存在');
    if (batch.status === 'rejected') return batchFromRow(batch);
    if (batch.status !== 'preview') throw new AppError(422, 42219, '该批次当前不可驳回');

    await connection.query(
      `UPDATE data_import_batches
       SET status = 'rejected', rejected_by = ?, rejected_at = NOW(), rejection_reason = ?
       WHERE id = ? AND status = 'preview'`,
      [user.sub, normalizedReason, id],
    );
    await writeAudit(
      {
        userId: user.sub,
        action: 'data_import.reject',
        resourceType: 'data_import_batch',
        resourceId: id,
        detail: { reason: normalizedReason },
        ip,
      },
      connection,
    );
    return batchFromRow(batch, {
      status: 'rejected',
      rejectedAt: new Date().toISOString(),
      rejectionReason: normalizedReason,
    });
  });
}

export async function listDataImportBatches(user?: AuthUser, page = 1, pageSize = 100) {
  if (user && isDevDemoAuthUser(user)) {
    const list = demoBatches.slice((page - 1) * pageSize, page * pageSize).map(({ previewRows: _previewRows, headers: _headers, ...batch }) => ({
      ...batch,
      fileName: normalizeUploadFilename(batch.fileName),
    }));
    return { list, total: demoBatches.length, page, pageSize };
  }
  const [count] = await rows<RowDataPacket & { total: number }>('SELECT COUNT(*) total FROM data_import_batches');
  const batchRows = await rows<DataImportBatchRow>(
    `SELECT id, source_type, file_name, file_size, file_sha256, sheet_name, report_type, status,
            total_rows, valid_rows, error_rows, errors_json, headers_json, created_by,
            confirmed_at, rejected_at, rejection_reason, created_at
     FROM data_import_batches ORDER BY id DESC LIMIT ? OFFSET ?`,
    [pageSize, (page - 1) * pageSize],
  );
  return { list: batchRows.map((batch) => batchFromRow(batch)), total: Number(count?.total ?? 0), page, pageSize };
}

export async function getDataImportBatch(
  user: AuthUser,
  id: string,
  page = 1,
  pageSize = 100,
): Promise<DataImportBatchDetail> {
  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.min(Math.max(1, Math.floor(pageSize)), 500);
  const offset = (safePage - 1) * safePageSize;

  if (isDevDemoAuthUser(user)) {
    const batch = demoBatches.find((item) => item.id === id);
    if (!batch) throw new AppError(404, 40401, '导入批次不存在');
    const allRows = demoBatchRows.get(id) ?? batch.previewRows;
    return {
      ...batch,
      fieldMappings: batch.fieldMappings,
      rows: allRows.slice(offset, offset + safePageSize),
      page: safePage,
      pageSize: safePageSize,
      total: allRows.length,
    };
  }

  const [batch] = await rows<DataImportBatchRow>('SELECT * FROM data_import_batches WHERE id = ? LIMIT 1', [id]);
  if (!batch) throw new AppError(404, 40401, '导入批次不存在');

  const [count] = await rows<CountRow>('SELECT COUNT(*) AS total FROM data_import_rows WHERE batch_id = ?', [id]);
  const storedRows = await rows<DataImportRowRow>(
    `SELECT \`row_number\`, occurred_at, channel_name, keyword, promotion_task, risk_decision,
            search_volume, order_count, search_conversion_rate, revenue_amount,
            validation_status, errors_json, raw_json
     FROM data_import_rows
     WHERE batch_id = ?
     ORDER BY \`row_number\`
     LIMIT ? OFFSET ?`,
    [id, safePageSize, offset],
  );

  return {
    ...batchFromRow(batch),
    headers: parseHeaders(batch.headers_json),
    fieldMappings: fieldMappings(parseHeaders(batch.headers_json)),
    rows: storedRows.map(previewRowFromDb),
    page: safePage,
    pageSize: safePageSize,
    total: Number(count?.total ?? 0),
  };
}
