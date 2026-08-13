import axios from 'axios';
import { config } from '../config';
import { AppError } from '../middleware/errors';
import { injectSignParams } from '../sign/zhihu';

const client = axios.create({ baseURL: config.zhihu.apiBase, timeout: 15_000 });

const TOKEN_ONLY_GET_PATHS = new Set([
  '/alliance/api/get_agent_channels',
]);

const knownErrors = [
  { needles: ['timestamp无效'], error: new AppError(502, 50001, '系统时间校验失败，请稍后重试') },
  { needles: ['签名错误'], error: new AppError(502, 50001, '签名校验失败，请检查服务端配置') },
  { needles: ['关键词已存在'], error: new AppError(409, 40901, '该关键词已被绑定，请换一个词') },
  { needles: ['内容URL不合法'], error: new AppError(422, 42201, '推广内容链接格式不正确') },
  { needles: ['配额超限'], error: new AppError(429, 42901, '今日操作次数已达上限，请明天再试') },
] as const;

const UPSTREAM_DETAIL_KEYS = ['message', 'msg', 'error_description', 'error'] as const;
const UPSTREAM_CODE_KEYS = ['code', 'error_code', 'errno'] as const;

interface SafeUpstreamDiagnostic {
  status: number;
  code: string | null;
  messageKey: 'keyword_rule' | 'channel_invalid' | null;
}

class ZhihuUpstreamError extends AppError {
  constructor(public readonly diagnostic: SafeUpstreamDiagnostic) {
    super(502, 50002, '知乎服务暂时不可用，请稍后重试');
  }
}

function upstreamText(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 512) : '';
}

function safeUpstreamCode(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && /^\d{1,20}$/.test(value)) return value;
  return '';
}

function safeMessageKey(code: string, value: unknown): SafeUpstreamDiagnostic['messageKey'] {
  if (code === '400402') return 'keyword_rule';
  const message = upstreamText(value);
  if (!message) return null;
  if (message.includes('关键词') && (message.includes('词根') || message.includes('更换关键词'))) {
    return 'keyword_rule';
  }
  if (message.includes('渠道') && message.includes('无效')) return 'channel_invalid';
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function upstreamErrorData(data: unknown): Record<string, unknown> | null {
  const response = asRecord(data);
  if (!response) return null;
  return asRecord(response.error) ?? response;
}

function translatedUpstreamError(data: unknown, status: number): AppError | ZhihuUpstreamError | null {
  const response = asRecord(data);
  if (!response) return null;
  const detail = upstreamErrorData(data);
  const hasErrorEnvelope = Object.prototype.hasOwnProperty.call(response, 'error');
  if (!detail || (!hasErrorEnvelope && status < 400)) return null;

  const upstream = upstreamText(
    UPSTREAM_DETAIL_KEYS.map((key) => detail[key]).find((value) => value != null),
  );
  for (const { needles, error } of knownErrors) {
    if (needles.some((needle) => upstream.includes(needle))) return error;
  }

  const upstreamCode = safeUpstreamCode(
    UPSTREAM_CODE_KEYS.map((key) => detail[key]).find((value) => value != null),
  );
  return new ZhihuUpstreamError({
    status,
    code: upstreamCode || null,
    messageKey: safeMessageKey(upstreamCode, upstream),
  });
}

function responseData<T>(data: T, status: number): T {
  const upstreamError = translatedUpstreamError(data, status);
  if (upstreamError) throw upstreamError;
  return data;
}

export function zhihuSyncErrorDetail(error: unknown): string {
  if (error instanceof ZhihuUpstreamError) {
    const { status, code, messageKey } = error.diagnostic;
    const prefix = `知乎接口失败（HTTP ${status}${code ? ` / code ${code}` : ''}）`;
    if (messageKey === 'keyword_rule') return `${prefix}：关键词不符合知乎规则，请更换关键词`;
    if (messageKey === 'channel_invalid') return `${prefix}：渠道 ID 无效，请重新同步渠道`;
    return prefix;
  }
  if (error instanceof AppError && knownErrors.some((item) => item.error === error)) return error.message;
  return '知乎同步失败，请稍后重试';
}

function translateError(error: unknown): never {
  if (error instanceof AppError) throw error;
  if (axios.isAxiosError<Record<string, unknown>>(error) && error.response) {
    throw translatedUpstreamError(error.response.data, error.response.status)
      ?? new ZhihuUpstreamError({ status: error.response.status, code: null, messageKey: null });
  }
  throw new AppError(502, 50002, '知乎服务暂时不可用，请稍后重试');
}

export async function zhihuGet<T = unknown>(path: string, params: Record<string, unknown> = {}): Promise<T> {
  try {
    const authenticated = TOKEN_ONLY_GET_PATHS.has(path)
      ? { ...params, access_token: config.zhihu.accessToken }
      : injectSignParams(params, config.zhihu.accessToken, config.zhihu.secretKey);
    const response = await client.get<T>(path, { params: authenticated });
    return responseData(response.data, response.status);
  } catch (error) { return translateError(error); }
}

export async function zhihuPost<T = unknown>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  try {
    const signed = injectSignParams(body, config.zhihu.accessToken, config.zhihu.secretKey);
    const response = await client.post<T>(path, signed);
    return responseData(response.data, response.status);
  } catch (error) { return translateError(error); }
}

export async function zhihuPut<T = unknown>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  try {
    const signed = injectSignParams(body, config.zhihu.accessToken, config.zhihu.secretKey);
    const response = await client.put<T>(path, signed);
    return responseData(response.data, response.status);
  } catch (error) { return translateError(error); }
}
