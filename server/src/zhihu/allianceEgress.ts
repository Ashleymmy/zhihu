import axios, { type AxiosResponse } from 'axios';
import { AppError } from '../middleware/errors';
import { isCurrentAllianceEndpoint, type AllianceEndpoint } from './allianceEndpointRegistry';
import { parseZhihuJson } from './json';

export const ALLIANCE_EGRESS_BASE = 'https://open.zhihu.com/alliance/api' as const;
export const ALLIANCE_EGRESS_TIMEOUT_MS = 15_000 as const;
export const ALLIANCE_UPSTREAM_UNAVAILABLE_MESSAGE = '知乎服务暂时不可用，请稍后重试' as const;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const allianceHttp = axios.create({
  baseURL: ALLIANCE_EGRESS_BASE,
  timeout: ALLIANCE_EGRESS_TIMEOUT_MS,
  maxRedirects: 0,
  proxy: false,
  allowAbsoluteUrls: false,
  transformResponse: [parseZhihuJson],
});

export interface AllianceEgressRequest {
  endpoint: AllianceEndpoint;
  params?: Record<string, unknown>;
  data?: unknown;
}

function unavailableError(): AppError {
  return new AppError(502, 50002, ALLIANCE_UPSTREAM_UNAVAILABLE_MESSAGE);
}

function assertEndpoint(endpoint: unknown): asserts endpoint is AllianceEndpoint {
  if (!isCurrentAllianceEndpoint(endpoint)) throw unavailableError();
}

function isNativeFormData(value: unknown): value is FormData {
  if (typeof FormData === 'undefined' || !(value instanceof FormData)) return false;
  try {
    FormData.prototype.has.call(value, '__alliance_brand_probe__');
    return true;
  } catch {
    return false;
  }
}

function assertRequestShape(request: AllianceEgressRequest): void {
  const multipart = request.endpoint.requestKind === 'multipart';
  if (multipart) {
    if (request.params !== undefined || !isNativeFormData(request.data)) throw unavailableError();
    return;
  }
  if (isNativeFormData(request.data)) throw unavailableError();
}

export async function requestAlliance<T = unknown>(request: AllianceEgressRequest): Promise<AxiosResponse<T>> {
  assertEndpoint(request.endpoint);
  assertRequestShape(request);
  try {
    return await allianceHttp.request<T>({
      method: request.endpoint.method,
      url: request.endpoint.upstreamPath,
      params: request.params,
      data: request.data,
      headers: request.endpoint.requestKind === 'multipart' ? { 'X-Requested-With': 'openApi' } : undefined,
      timeout: ALLIANCE_EGRESS_TIMEOUT_MS,
      maxRedirects: 0,
      proxy: false,
      allowAbsoluteUrls: false,
    });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response && REDIRECT_STATUSES.has(error.response.status)) {
      throw unavailableError();
    }
    throw error;
  }
}

export function isAllianceRedirectStatus(status: number): boolean {
  return REDIRECT_STATUSES.has(status);
}
