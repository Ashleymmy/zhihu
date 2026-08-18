/**
 * 知乎联盟 API 精确路由。
 * 挂载路径：/api/alliance/api
 */
import { randomUUID } from 'node:crypto';
import axios from 'axios';
import express, { Router, type ErrorRequestHandler, type Request, type RequestHandler, type Response } from 'express';
import multer, { MulterError } from 'multer';
import { ZodError } from 'zod';
import { requireAuth } from '../auth/middleware';
import { requirePermission } from '../auth/permissions';
import { config } from '../config';
import { AppError, asyncHandler } from '../middleware/errors';
import {
  adaptAllianceIngress,
  AllianceBusinessError,
  AllianceProtocolError,
  parseAllianceIngress,
  prepareAllianceRequest,
  projectAllianceSuccess,
  type AllianceSuccessProjection,
} from '../zhihu/allianceContracts';
import { resolvePublicEndpoint, type AllianceEndpoint } from '../zhihu/allianceEndpointRegistry';
import {
  allianceAuditEvent,
  writeAllianceRejectedAudit,
  type AllianceAuditStage,
  type AllianceUpstreamFailure,
} from '../zhihu/allianceAudit';
import { ALLIANCE_UPSTREAM_UNAVAILABLE_MESSAGE, requestAlliance } from '../zhihu/allianceEgress';
import {
  AllianceQuotaConfigurationError,
  AllianceQuotaDeniedError,
  AllianceQuotaLease,
  AllianceQuotaStoreError,
  createRedisAllianceQuotaManager,
  getInstalledAllianceQuotaManager,
  installAllianceQuotaManager,
} from '../zhihu/allianceQuota';
import { evaluateAllianceVersionPolicy } from '../zhihu/allianceVersionPolicy';
import { AllianceXlsxValidationError, validateAllianceXlsx, XLSX_MAX_BYTES, XLSX_MIME } from '../zhihu/allianceXlsx';

const ALLIANCE_BUSINESS_REJECTED_MESSAGE = '知乎请求被拒绝，请稍后重试' as const;
const UPLOAD_CONTENT_TYPE_MESSAGE = '上传请求格式不正确' as const;
const UPLOAD_TOO_LARGE_MESSAGE = '上传文件过大' as const;
const UPLOAD_INVALID_MESSAGE = '上传文件不符合要求' as const;
const ALLIANCE_QUOTA_EXHAUSTED_MESSAGE = '今日请求配额已用尽，请稍后重试' as const;
const ALLIANCE_QUOTA_UNAVAILABLE_MESSAGE = '知乎配额服务暂不可用' as const;

interface AllianceRequestContext {
  readonly requestId: string;
  readonly timestamp: number;
}

interface AllianceQuotaRequestState {
  readonly lease: AllianceQuotaLease;
  readonly onFinish: () => void;
  readonly onClose: () => void;
  aborted: boolean;
}

interface AllianceErrorState {
  auditPromise?: Promise<void>;
}

interface AllianceNormalizedError {
  readonly status: number;
  readonly code: number;
  readonly message: string;
  readonly stage: AllianceAuditStage;
  readonly upstreamFailure?: AllianceUpstreamFailure;
}

type AllianceSafeError = AppError & { readonly allianceFailure?: AllianceUpstreamFailure };

function isAllianceTransportError(error: unknown): boolean {
  return axios.isAxiosError(error);
}

function isAllianceEgressAppError(error: unknown): boolean {
  return (
    error instanceof AppError && (error.code === 50002 || (error as AllianceSafeError).allianceFailure !== undefined)
  );
}

function safeAllianceError(
  status: number,
  code: number,
  message: string,
  allianceFailure?: AllianceUpstreamFailure,
): AllianceSafeError {
  const error = new AppError(status, code, message) as AllianceSafeError;
  if (allianceFailure !== undefined) Object.defineProperty(error, 'allianceFailure', { value: allianceFailure });
  return error;
}

export const allianceRouter = Router();

const allianceRequestContext: RequestHandler = (_req, res, next) => {
  const context: AllianceRequestContext = { requestId: randomUUID(), timestamp: Date.now() };
  res.locals.allianceContext = context;
  res.setHeader('X-Request-Id', context.requestId);
  next();
};

function requestContext(res: Response): AllianceRequestContext {
  const context = res.locals.allianceContext as AllianceRequestContext | undefined;
  if (!context) throw new Error('alliance request context is missing');
  return context;
}

function errorState(res: Response): AllianceErrorState {
  const current = res.locals.allianceError as AllianceErrorState | undefined;
  if (current) return current;
  const state: AllianceErrorState = {};
  res.locals.allianceError = state;
  return state;
}

function errorEnvelope(res: Response, status: number, code: number, message: string): void {
  const context = requestContext(res);
  res.status(status).json({ code, message, requestId: context.requestId, timestamp: context.timestamp });
}

function successEnvelope(res: Response, projection: AllianceSuccessProjection): void {
  const context = requestContext(res);
  res.status(200).json({
    code: 0,
    message: projection.message,
    data: projection.data,
    requestId: context.requestId,
    timestamp: context.timestamp,
    ...(projection.meta === undefined ? {} : { meta: projection.meta }),
  });
}

function safeUpstreamError(failure: AllianceUpstreamFailure = 'transport'): AppError {
  return safeAllianceError(502, 50200, ALLIANCE_UPSTREAM_UNAVAILABLE_MESSAGE, failure);
}

function businessRejectedError(): AppError {
  return safeAllianceError(503, 50300, ALLIANCE_BUSINESS_REJECTED_MESSAGE, 'business');
}

function quotaUnavailableError(): AppError {
  return new AppError(503, 50320, ALLIANCE_QUOTA_UNAVAILABLE_MESSAGE);
}

export function normalizeAllianceErrorForTest(error: unknown): AllianceNormalizedError {
  if (error instanceof AllianceQuotaDeniedError)
    return { status: 429, code: 42910, message: ALLIANCE_QUOTA_EXHAUSTED_MESSAGE, stage: 'quota' };
  if (error instanceof AllianceQuotaConfigurationError || error instanceof AllianceQuotaStoreError)
    return { status: 503, code: 50320, message: ALLIANCE_QUOTA_UNAVAILABLE_MESSAGE, stage: 'quota' };
  const parserError = error as { status?: number; type?: string };
  if (error instanceof SyntaxError && parserError.status === 400 && parserError.type === 'entity.parse.failed')
    return { status: 400, code: 40000, message: '请求体不是有效 JSON', stage: 'parser' };
  if (error instanceof MulterError)
    return { status: 400, code: 40000, message: UPLOAD_CONTENT_TYPE_MESSAGE, stage: 'parser' };
  if (error instanceof ZodError) return { status: 422, code: 42200, message: '请求参数不正确', stage: 'schema' };
  if (error instanceof AllianceBusinessError)
    return {
      status: 503,
      code: 50300,
      message: ALLIANCE_BUSINESS_REJECTED_MESSAGE,
      stage: 'upstream',
      upstreamFailure: 'business',
    };
  if (error instanceof AllianceProtocolError)
    return {
      status: 502,
      code: 50200,
      message: ALLIANCE_UPSTREAM_UNAVAILABLE_MESSAGE,
      stage: 'upstream',
      upstreamFailure: 'protocol',
    };
  if (error instanceof AppError && error.code === 40400)
    return { status: error.httpStatus, code: error.code, message: error.message, stage: 'allowlist' };
  if (error instanceof AppError && (error.code === 40100 || error.code === 40101))
    return { status: error.httpStatus, code: error.code, message: error.message, stage: 'auth' };
  if (error instanceof AppError && error.code === 40301)
    return { status: error.httpStatus, code: error.code, message: error.message, stage: 'permission' };
  if (error instanceof AppError && error.code === 42910)
    return { status: error.httpStatus, code: error.code, message: error.message, stage: 'quota' };
  if (error instanceof AppError && error.code === 50320)
    return { status: error.httpStatus, code: error.code, message: error.message, stage: 'quota' };
  if (error instanceof AppError && (error.code === 41300 || error.code === 41500))
    return { status: error.httpStatus, code: error.code, message: error.message, stage: 'parser' };
  if (error instanceof AppError && error.code === 42200)
    return { status: error.httpStatus, code: error.code, message: error.message, stage: 'schema' };
  if (error instanceof AppError && error.code === 50300)
    return {
      status: error.httpStatus,
      code: error.code,
      message: error.message,
      stage: 'upstream',
      upstreamFailure: (error as AllianceSafeError).allianceFailure ?? 'business',
    };
  if (error instanceof AppError && error.code === 50200)
    return {
      status: error.httpStatus,
      code: error.code,
      message: error.message,
      stage: 'upstream',
      upstreamFailure: (error as AllianceSafeError).allianceFailure ?? 'transport',
    };
  return { status: 500, code: 50000, message: '服务器内部错误', stage: 'internal' };
}

const normalizeAllianceError = normalizeAllianceErrorForTest;

async function auditRejectedOnce(req: Request, res: Response, error: unknown): Promise<void> {
  const state = errorState(res);
  if (!state.auditPromise) {
    const endpoint = resolvePublicEndpoint(req.method, req.url);
    const normalized = normalizeAllianceError(error);
    const event = allianceAuditEvent(
      req,
      res,
      endpoint,
      normalized.stage,
      normalized.status,
      normalized.code,
      normalized.upstreamFailure,
    );
    state.auditPromise = writeAllianceRejectedAudit(event);
  }
  await state.auditPromise;
}

function quotaManager() {
  const installed = getInstalledAllianceQuotaManager();
  if (installed) return installed;
  const manager = createRedisAllianceQuotaManager({
    redisUrl: config.redisUrl,
    accessToken: () => config.zhihu.accessToken,
  });
  installAllianceQuotaManager(manager);
  return manager;
}

if (config.nodeEnv === 'production') quotaManager();

function quotaState(res: Response): AllianceQuotaRequestState | undefined {
  return res.locals.allianceQuota as AllianceQuotaRequestState | undefined;
}

function detachQuotaFallback(res: Response, state: AllianceQuotaRequestState): void {
  res.off('finish', state.onFinish);
  res.off('close', state.onClose);
  if (quotaState(res) === state) delete res.locals.allianceQuota;
}

async function releaseQuota(res: Response): Promise<void> {
  const state = quotaState(res);
  if (!state) return;
  await state.lease.release();
  if (state.lease.state !== 'reserved') detachQuotaFallback(res, state);
}

async function releaseQuotaSafely(res: Response): Promise<void> {
  try {
    await releaseQuota(res);
  } catch {
    // The Redis lease TTL is the final recovery path when settlement is unavailable.
  }
}

async function confirmQuota(res: Response): Promise<void> {
  const state = quotaState(res);
  if (!state) throw new AllianceQuotaStoreError();
  if (state.aborted) {
    await state.lease.release();
    detachQuotaFallback(res, state);
    throw new AllianceQuotaStoreError();
  }
  await state.lease.confirm();
  if (state.lease.state !== 'confirmed') throw new AllianceQuotaStoreError();
  detachQuotaFallback(res, state);
}

const allianceQuotaGate: RequestHandler = (req, res, next) => {
  void (async () => {
    const endpoint = endpointForRequest(req);
    const manager = quotaManager();
    let requestClosed = false;
    const onEarlyClose = () => {
      requestClosed = true;
    };
    res.once('close', onEarlyClose);
    let reservation;
    try {
      reservation = await manager.reserve(endpoint.operationKey);
    } finally {
      res.off('close', onEarlyClose);
    }
    if (requestClosed || res.destroyed) {
      await manager.release(reservation);
      return;
    }
    const lease = manager.lease(reservation);
    const state = {
      lease,
      aborted: false,
      onFinish: () => {
        void releaseQuotaSafely(res);
      },
      onClose: () => {
        const current = quotaState(res);
        if (current) current.aborted = !res.writableFinished;
        void releaseQuotaSafely(res);
      },
    } satisfies AllianceQuotaRequestState;
    res.locals.allianceQuota = state;
    res.once('finish', state.onFinish);
    res.once('close', state.onClose);
    next();
  })().catch((error: unknown) => {
    if (error instanceof AllianceQuotaDeniedError) {
      next(new AppError(429, 42910, ALLIANCE_QUOTA_EXHAUSTED_MESSAGE));
      return;
    }
    if (error instanceof AllianceQuotaConfigurationError || error instanceof AllianceQuotaStoreError) {
      next(quotaUnavailableError());
      return;
    }
    next(quotaUnavailableError());
  });
};

const allianceEndpointPermissionGate: RequestHandler = (req, _res, next) => {
  const endpoint = endpointForRequest(req);
  requirePermission(endpoint.requiredPermission)(req, _res, next);
};

function endpointForRequest(req: Request): AllianceEndpoint {
  const endpoint = resolvePublicEndpoint(req.method, req.url);
  if (!endpoint) throw new AppError(404, 40400, '接口不存在');
  return endpoint;
}

async function proxyRequest(req: Request, res: Response): Promise<void> {
  try {
    const endpoint = endpointForRequest(req);
    const ingress = parseAllianceIngress(
      endpoint,
      endpoint.method === 'GET' ? req.query : (req.body ?? {}),
      req.params.composition_id,
    );
    const upstream = adaptAllianceIngress(endpoint, ingress);
    const prepared = prepareAllianceRequest(endpoint, upstream, config.zhihu.accessToken, config.zhihu.secretKey);
    const response = await requestAlliance({
      endpoint,
      ...(endpoint.method === 'GET' ? { params: prepared } : { data: prepared }),
    });
    const projection = projectAllianceSuccess(endpoint, response.data, ingress);
    await confirmQuota(res);
    successEnvelope(res, projection);
  } catch (error) {
    await releaseQuotaSafely(res);
    if (error instanceof ZodError) throw error;
    if (error instanceof AllianceQuotaConfigurationError || error instanceof AllianceQuotaStoreError) {
      throw quotaUnavailableError();
    }
    if (error instanceof AppError) {
      if (error.code === 40400) throw error;
      if (isAllianceEgressAppError(error)) {
        throw safeUpstreamError((error as AllianceSafeError).allianceFailure ?? 'transport');
      }
      throw new AppError(500, 50000, '服务器内部错误');
    }
    if (error instanceof AllianceBusinessError) throw businessRejectedError();
    if (error instanceof AllianceProtocolError) throw safeUpstreamError('protocol');
    if (isAllianceTransportError(error)) throw safeUpstreamError('transport');
    throw new AppError(500, 50000, '服务器内部错误');
  }
}

function uploadInvalidError(): AppError {
  return new AppError(422, 42200, UPLOAD_INVALID_MESSAGE);
}

function cleanupRequestFile(req: Request): void {
  const file = req.file;
  if (file?.buffer) file.buffer.fill(0);
  req.file = undefined;
}

function rawContentType(req: Request): string | null {
  const values: string[] = [];
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    if (req.rawHeaders[index]?.toLowerCase() === 'content-type') values.push(req.rawHeaders[index + 1] ?? '');
  }
  return values.length === 1 ? values[0] : null;
}

function validMultipartContentType(value: string): boolean {
  const match = /^multipart\/form-data\s*;\s*boundary=(?:"([^"\r\n]{1,70})"|([0-9A-Za-z'()+_./:=?-]{1,70}))\s*$/iu.exec(
    value,
  );
  const boundary = match?.[1] ?? match?.[2];
  return (
    boundary !== undefined &&
    Buffer.byteLength(boundary, 'ascii') >= 1 &&
    Buffer.byteLength(boundary, 'ascii') <= 70 &&
    boundary.trimEnd() === boundary &&
    /^[0-9A-Za-z'()+_./:=?-]+$/u.test(boundary)
  );
}

const multipartContentTypeGate: RequestHandler = (req, _res, next) => {
  const contentType = rawContentType(req);
  if (contentType === null || !validMultipartContentType(contentType)) {
    next(new AppError(415, 41500, UPLOAD_CONTENT_TYPE_MESSAGE));
    return;
  }
  next();
};

function batchUploadMiddleware(fields: number, parts: number): RequestHandler {
  const upload = multer({
    storage: multer.memoryStorage(),
    preservePath: true,
    limits: {
      // Busboy emits the file limit event when the byte count reaches the configured value.
      // Use an exclusive sentinel so the frozen 10 MiB semantic maximum remains inclusive.
      fileSize: XLSX_MAX_BYTES + 1,
      files: 1,
      fields,
      // Busboy emits partsLimit at equality, so its numeric limit is an exclusive sentinel.
      // files + fields still enforce the frozen semantic maximum of `parts`.
      parts: parts + 1,
      fieldNameSize: 64,
      fieldSize: 2048,
      headerPairs: 32,
      fieldNestingDepth: 0,
    },
  }).single('file');
  return (req, res, next) => {
    upload(req, res, (error) => {
      if (!error) {
        next();
        return;
      }
      cleanupRequestFile(req);
      if (error instanceof MulterError && error.code === 'LIMIT_FILE_SIZE') {
        next(new AppError(413, 41300, UPLOAD_TOO_LARGE_MESSAGE));
        return;
      }
      next(uploadInvalidError());
    });
  };
}

const planBatchUpload = batchUploadMiddleware(4, 5);
const compositionBatchUpload = batchUploadMiddleware(2, 3);

function multipartBody(req: Request): Record<string, unknown> {
  if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) throw uploadInvalidError();
  return req.body as Record<string, unknown>;
}

function exactString(body: Record<string, unknown>, key: string, optional = false): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(body, key)) {
    if (optional) return undefined;
    throw uploadInvalidError();
  }
  const value = body[key];
  if (typeof value !== 'string') throw uploadInvalidError();
  return value;
}

function normalizeBatchIngress(endpoint: AllianceEndpoint, req: Request): Record<string, unknown> {
  const body = multipartBody(req);
  if (endpoint.definitionKey === 'POST /popularize_plans') {
    const allowed = new Set(['taskId', 'channelId', 'popularizeType', 'secondChannelId']);
    if (Object.keys(body).some((key) => !allowed.has(key))) throw uploadInvalidError();
    const popularizeType = exactString(body, 'popularizeType');
    if (popularizeType !== '0') throw uploadInvalidError();
    return {
      taskId: exactString(body, 'taskId'),
      channelId: exactString(body, 'channelId'),
      popularizeType: 0,
      ...(Object.prototype.hasOwnProperty.call(body, 'secondChannelId')
        ? { secondChannelId: exactString(body, 'secondChannelId', true) }
        : {}),
    };
  }
  if (endpoint.definitionKey === 'POST /popularize_compositions/v2') {
    const allowed = new Set(['bindType', 'channelId']);
    if (Object.keys(body).some((key) => !allowed.has(key))) throw uploadInvalidError();
    const bindType = exactString(body, 'bindType');
    if (bindType !== '1' && bindType !== '2') throw uploadInvalidError();
    return { bindType: Number(bindType), channelId: exactString(body, 'channelId') };
  }
  throw new AppError(404, 40400, '接口不存在');
}

function appendScalar(form: FormData, name: string, value: unknown): void {
  if (typeof value !== 'string' && typeof value !== 'number') throw new AllianceProtocolError();
  form.append(name, String(value));
}

function batchFormData(
  endpoint: AllianceEndpoint,
  prepared: Record<string, unknown>,
  file: Express.Multer.File,
): FormData {
  const form = new FormData();
  if (endpoint.definitionKey === 'POST /popularize_plans') {
    appendScalar(form, 'task_id', prepared.task_id);
    appendScalar(form, 'channel_id', prepared.channel_id);
    appendScalar(form, 'popularize_type', prepared.popularize_type);
    if (prepared.second_channel_id !== undefined) appendScalar(form, 'second_channel_id', prepared.second_channel_id);
  } else if (endpoint.definitionKey === 'POST /popularize_compositions/v2') {
    appendScalar(form, 'bind_type', prepared.bind_type);
    appendScalar(form, 'channel_id', prepared.channel_id);
  } else throw new AllianceProtocolError();
  appendScalar(form, 'access_token', prepared.access_token);
  appendScalar(form, 'timestamp', prepared.timestamp);
  appendScalar(form, 'signature', prepared.signature);
  form.append('file', new Blob([new Uint8Array(file.buffer)], { type: XLSX_MIME }), 'upload.xlsx');
  return form;
}

async function proxyBatchRequest(req: Request, res: Response): Promise<void> {
  const file = req.file;
  let form: FormData | undefined;
  try {
    const endpoint = endpointForRequest(req);
    if (!file) throw uploadInvalidError();
    if (file.size > XLSX_MAX_BYTES || file.buffer.length > XLSX_MAX_BYTES) {
      throw new AppError(413, 41300, UPLOAD_TOO_LARGE_MESSAGE);
    }
    const normalized = normalizeBatchIngress(endpoint, req);
    let ingress: Record<string, unknown>;
    let upstream: Record<string, unknown>;
    try {
      ingress = parseAllianceIngress(endpoint, normalized);
      upstream = adaptAllianceIngress(endpoint, ingress);
    } catch (error) {
      if (error instanceof ZodError) throw uploadInvalidError();
      throw error;
    }
    await validateAllianceXlsx(file);
    const prepared = prepareAllianceRequest(endpoint, upstream, config.zhihu.accessToken, config.zhihu.secretKey);
    form = batchFormData(endpoint, prepared, file);
    const response = await requestAlliance({ endpoint, data: form });
    const projection = projectAllianceSuccess(endpoint, response.data, ingress);
    await confirmQuota(res);
    successEnvelope(res, projection);
  } catch (error) {
    await releaseQuotaSafely(res);
    if (error instanceof AllianceXlsxValidationError || error instanceof ZodError) throw uploadInvalidError();
    if (error instanceof AllianceQuotaConfigurationError || error instanceof AllianceQuotaStoreError) {
      throw quotaUnavailableError();
    }
    if (error instanceof AppError) {
      if (error.code === 40400 || error.code === 41300 || error.code === 41500 || error.code === 42200) throw error;
      if (isAllianceEgressAppError(error)) {
        throw safeUpstreamError((error as AllianceSafeError).allianceFailure ?? 'transport');
      }
      throw new AppError(500, 50000, '服务器内部错误');
    }
    if (error instanceof AllianceBusinessError) throw businessRejectedError();
    if (error instanceof AllianceProtocolError) throw safeUpstreamError('protocol');
    if (isAllianceTransportError(error)) throw safeUpstreamError('transport');
    throw new AppError(500, 50000, '服务器内部错误');
  } finally {
    form?.delete('file');
    cleanupRequestFile(req);
    form = undefined;
  }
}

export async function handleAllianceError(error: unknown, req: Request, res: Response): Promise<void> {
  await releaseQuotaSafely(res);
  cleanupRequestFile(req);
  try {
    await auditRejectedOnce(req, res, error);
  } catch {
    if (!res.writableEnded) {
      if (!res.headersSent) errorEnvelope(res, 500, 50000, '服务器内部错误');
      else res.end();
    }
    return;
  }
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  const normalized = normalizeAllianceError(error);
  const bodyParserError = error as { status?: number; type?: string };
  if (
    error instanceof SyntaxError &&
    bodyParserError.status === 400 &&
    bodyParserError.type === 'entity.parse.failed'
  ) {
    errorEnvelope(res, normalized.status, normalized.code, normalized.message);
    return;
  }
  if (error instanceof ZodError) {
    errorEnvelope(res, normalized.status, normalized.code, normalized.message);
    return;
  }
  if (error instanceof AppError) {
    errorEnvelope(res, normalized.status, normalized.code, normalized.message);
    return;
  }
  errorEnvelope(res, normalized.status, normalized.code, normalized.message);
}

const allianceErrorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  void handleAllianceError(error, req, res).catch(() => {
    if (!res.writableEnded) res.end();
  });
};

// requestId 上下文是唯一允许位于 raw Registry Gate 前的无副作用 middleware。
allianceRouter.use(allianceRequestContext);
allianceRouter.use((req, _res, next) => {
  const decision = evaluateAllianceVersionPolicy(req.method, req.url);
  if (decision.allowed) {
    next();
    return;
  }
  next(new AppError(404, 40400, '接口不存在'));
});
allianceRouter.use(requireAuth);
allianceRouter.use(allianceEndpointPermissionGate);
allianceRouter.use(allianceQuotaGate);

const parseAllianceJson = express.json({ limit: '1mb' });

allianceRouter.post(
  '/popularize_plan',
  parseAllianceJson,
  asyncHandler(async (req, res) => proxyRequest(req, res)),
);

allianceRouter.post(
  '/popularize_plans',
  multipartContentTypeGate,
  planBatchUpload,
  asyncHandler(async (req, res) => proxyBatchRequest(req, res)),
);

allianceRouter.post(
  '/popularize_composition/v2',
  parseAllianceJson,
  asyncHandler(async (req, res) => proxyRequest(req, res)),
);

allianceRouter.post(
  '/popularize_compositions/v2',
  multipartContentTypeGate,
  compositionBatchUpload,
  asyncHandler(async (req, res) => proxyBatchRequest(req, res)),
);

allianceRouter.put(
  '/popularize_composition/v2/:composition_id',
  parseAllianceJson,
  asyncHandler(async (req, res) => proxyRequest(req, res)),
);

allianceRouter.get(
  '/popularize_compositions',
  asyncHandler(async (req, res) => proxyRequest(req, res)),
);
allianceRouter.get(
  '/data_report/real_time_data',
  asyncHandler(async (req, res) => proxyRequest(req, res)),
);

allianceRouter.use(allianceErrorHandler);
