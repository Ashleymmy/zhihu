import axios, { AxiosError } from 'axios';
import { config } from '../config';
import { AppError } from '../middleware/errors';
import { injectSignParams } from '../sign/zhihu';

const client = axios.create({ baseURL: config.zhihu.apiBase, timeout: 15_000 });

const TOKEN_ONLY_GET_PATHS = new Set([
  '/alliance/api/get_agent_channels',
]);

const errorMap: Record<string, AppError> = {
  timestamp无效: new AppError(502, 50001, '系统时间校验失败，请稍后重试'),
  签名错误: new AppError(502, 50001, '系统时间校验失败，请稍后重试'),
  关键词已存在: new AppError(409, 40901, '该关键词已被绑定，请换一个词'),
  内容URL不合法: new AppError(422, 42201, '推广内容链接格式不正确'),
  配额超限: new AppError(429, 42901, '今日操作次数已达上限，请明天再试'),
};

const UPSTREAM_DETAIL_KEYS = ['message', 'msg', 'error_description', 'error'] as const;
const UPSTREAM_CODE_KEYS = ['code', 'error_code', 'errno'] as const;

function safeUpstreamText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\b(access[_-]?token|token|signature|secret(?:[_-]?key)?)\s*[:=]\s*[^\s,;&]+/gi, '$1=[REDACTED]')
    .replace(/\bBearer\s+[^\s,;&]+/gi, 'Bearer [REDACTED]')
    .trim()
    .slice(0, maxLength);
}

function translateError(error: unknown): never {
  const axiosError = error as AxiosError<Record<string, unknown>>;
  const responseData = axiosError.response?.data;
  const upstream = safeUpstreamText(
    UPSTREAM_DETAIL_KEYS.map((key) => responseData?.[key]).find((value) => value != null),
    240,
  );
  for (const [needle, mapped] of Object.entries(errorMap)) if (upstream.includes(needle)) throw mapped;

  if (axiosError.response) {
    const status = axiosError.response.status;
    const upstreamCode = safeUpstreamText(
      UPSTREAM_CODE_KEYS.map((key) => responseData?.[key]).find((value) => value != null),
      64,
    );
    const codeDetail = upstreamCode ? ` / code ${upstreamCode}` : '';
    const messageDetail = upstream ? `：${upstream}` : '';
    throw new AppError(502, 50002, `知乎接口失败（HTTP ${status}${codeDetail}）${messageDetail}`);
  }
  throw new AppError(502, 50002, '知乎服务暂时不可用，请稍后重试');
}

export async function zhihuGet<T = unknown>(path: string, params: Record<string, unknown> = {}): Promise<T> {
  try {
    const authenticated = TOKEN_ONLY_GET_PATHS.has(path)
      ? { ...params, access_token: config.zhihu.accessToken }
      : injectSignParams(params, config.zhihu.accessToken, config.zhihu.secretKey);
    return (await client.get<T>(path, { params: authenticated })).data;
  } catch (error) { return translateError(error); }
}

export async function zhihuPost<T = unknown>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  try {
    const signed = injectSignParams(body, config.zhihu.accessToken, config.zhihu.secretKey);
    return (await client.post<T>(path, signed)).data;
  } catch (error) { return translateError(error); }
}

export async function zhihuPut<T = unknown>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  try {
    const signed = injectSignParams(body, config.zhihu.accessToken, config.zhihu.secretKey);
    return (await client.put<T>(path, signed)).data;
  } catch (error) { return translateError(error); }
}
