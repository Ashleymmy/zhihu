import { z, type ZodTypeAny } from 'zod';
import { injectSignParams, type SignatureProfile } from '../sign/zhihu';
import { isCanonicalCompositionId, type AllianceEndpoint } from './allianceEndpointRegistry';

export const ALLIANCE_MEDIA_TYPES = [
  'KOC视频号',
  'KOC百家号',
  'KOC抖音',
  'KOC快手',
  'KOC微博',
  'KOC小红书',
  'KOC定向',
  'KOC头条号',
  'KOC哔哩哔哩',
  'KOC公众号',
] as const;

export const ALLIANCE_REALTIME_FIELDS = ['search_num', 'order_num', 'created_at'] as const;
export const ALLIANCE_BATCH_UPLOAD_UNAVAILABLE_MESSAGE = '批量上传暂未开放' as const;

const MAX_PAGE = Math.floor(Number.MAX_SAFE_INTEGER / 100) + 1;
const INTEGER_TEXT = /^(?:0|[1-9][0-9]*)$/u;
const TIMEZONE_ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;

const hasOwn = (value: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const nonEmptyString = z.string().trim().min(1).max(2048);
const identifier = z.string().min(1).max(128);
const httpUrl = z
  .string()
  .url()
  .max(2048)
  .refine((value) => /^https?:\/\//iu.test(value), '必须是 HTTP URL');

function queryInteger(minimum: number, maximum: number) {
  return z.preprocess(
    (value) => (typeof value === 'string' && INTEGER_TEXT.test(value) ? Number(value) : value),
    z.number().int().min(minimum).max(maximum),
  );
}

const jsonPopularizeType = z.number().int().min(0).max(0);
const jsonBindType = z.number().int().min(1).max(2);
const jsonCompositionType = z.number().int().min(0).max(2);
const jsonCompositionSubType = z.number().int().min(1).max(11);
const queryType = queryInteger(1, 1);
const queryTimeScale = queryInteger(1, 1);
const releaseTime = z
  .string()
  .regex(TIMEZONE_ISO_8601, '必须包含显式时区的 ISO 8601 时间')
  .refine((value) => {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && Number.isSafeInteger(Math.floor(timestamp / 1000)) && timestamp >= 0;
  }, '必须是有效的带时区时间');

const compositionFields = {
  planId: identifier,
  channelId: identifier,
  mediaType: z.enum(ALLIANCE_MEDIA_TYPES),
  mediaAccount: nonEmptyString,
  compositionType: jsonCompositionType,
  compositionSubType: jsonCompositionSubType,
  compositionUrl: httpUrl,
  releaseTime,
};

const compositionFieldsRefinement = <Schema extends ZodTypeAny>(schema: Schema) =>
  schema.superRefine((value, context) => {
    const input = value as Record<string, unknown>;
    const type = input.compositionType;
    const subtype = input.compositionSubType;
    const allowed =
      (type === 0 && subtype === 11) ||
      (type === 1 && typeof subtype === 'number' && subtype >= 1 && subtype <= 4) ||
      (type === 2 && typeof subtype === 'number' && subtype >= 5 && subtype <= 10);
    if (!allowed) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['compositionSubType'],
        message: '作品分类组合不受支持',
      });
    }
  });

const planIngressSchema = z
  .object({
    taskId: identifier,
    channelId: identifier,
    contentUrl: httpUrl,
    popularizeType: jsonPopularizeType,
    keyword: nonEmptyString,
    secondChannelId: identifier.optional(),
  })
  .strict();

const planBatchIngressSchema = z
  .object({
    taskId: identifier,
    channelId: identifier,
    popularizeType: jsonPopularizeType,
    secondChannelId: identifier.optional(),
  })
  .strict();

const compositionCreateIngressSchema = compositionFieldsRefinement(z.object(compositionFields).strict());

const compositionBatchIngressSchema = z
  .object({
    bindType: jsonBindType,
    channelId: identifier,
  })
  .strict();

const compositionUpdateBodySchema = compositionFieldsRefinement(z.object(compositionFields).strict());
const compositionUpdateIngressSchema = compositionFieldsRefinement(
  z
    .object({
      compositionId: z.string().regex(/^[1-9][0-9]{0,19}$/u),
      ...compositionFields,
    })
    .strict(),
);

const compositionListIngressSchema = z
  .object({
    channelId: identifier,
    keyword: nonEmptyString,
    page: queryInteger(1, MAX_PAGE).default(1),
    pageSize: queryInteger(1, 100).default(10),
  })
  .strict();

const realtimeIngressSchema = z
  .object({
    type: queryType,
    timeScale: queryTimeScale,
    fields: z.string().min(1).max(128),
  })
  .strict()
  .superRefine((value, context) => {
    const fields = value.fields.split(',');
    const valid =
      fields.length > 0 &&
      fields.every((field) => ALLIANCE_REALTIME_FIELDS.includes(field as (typeof ALLIANCE_REALTIME_FIELDS)[number])) &&
      new Set(fields).size === fields.length;
    if (!valid) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['fields'], message: '指标字段不受支持' });
    }
  });

const planUpstreamSchema = z
  .object({
    task_id: identifier,
    channel_id: identifier,
    content_url: httpUrl,
    popularize_type: z.literal(0),
    keyword: nonEmptyString,
    second_channel_id: identifier.optional(),
  })
  .strict();

const planBatchUpstreamSchema = z
  .object({
    task_id: identifier,
    channel_id: identifier,
    popularize_type: z.literal(0),
    second_channel_id: identifier.optional(),
  })
  .strict();

const compositionUpstreamSchema = z
  .object({
    plan_id: identifier,
    channel_id: identifier,
    media_type: z.enum(ALLIANCE_MEDIA_TYPES),
    media_account: nonEmptyString,
    composition_type: z.number().int().min(0).max(2),
    composition_sub_type: z.number().int().min(1).max(11),
    composition_url: httpUrl,
    release_time: z.number().int().safe().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    const allowed =
      (value.composition_type === 0 && value.composition_sub_type === 11) ||
      (value.composition_type === 1 && value.composition_sub_type >= 1 && value.composition_sub_type <= 4) ||
      (value.composition_type === 2 && value.composition_sub_type >= 5 && value.composition_sub_type <= 10);
    if (!allowed) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['composition_sub_type'],
        message: '作品分类组合不受支持',
      });
    }
  });

const compositionBatchUpstreamSchema = z
  .object({
    bind_type: z.union([z.literal(1), z.literal(2)]),
    channel_id: identifier,
  })
  .strict();

const compositionListUpstreamSchema = z
  .object({
    channel_id: identifier,
    keyword: nonEmptyString,
    offset: z.number().int().safe().nonnegative(),
    limit: z.number().int().min(1).max(100),
  })
  .strict();

const realtimeUpstreamSchema = z
  .object({
    type: z.literal(1),
    time_scale: z.literal(1),
    fields: z.string().min(1).max(128),
  })
  .strict();

const reportDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, '日期格式应为 YYYY-MM-DD');

const dailyIngressSchema = z
  .object({
    startDate: reportDate,
    endDate: reportDate,
  })
  .strict();

const dailyUpstreamSchema = z
  .object({
    start_date: reportDate,
    end_date: reportDate,
  })
  .strict();

export type AllianceOperationKey =
  | 'POST /popularize_plan'
  | 'POST /popularize_plans'
  | 'POST /popularize_composition/v2'
  | 'POST /popularize_compositions/v2'
  | 'PUT /popularize_composition/v2/{composition_id}'
  | 'GET /popularize_compositions'
  | 'GET /data_report/real_time_data'
  | 'GET /data_report/daily_data';

export interface AllianceSignatureProfile extends SignatureProfile {
  readonly mode: 'signed' | 'token-only';
  readonly pathParametersIncluded: false;
}

function signedProfile(...excludedKeys: string[]): AllianceSignatureProfile {
  return Object.freeze({
    mode: 'signed' as const,
    pathParametersIncluded: false as const,
    excludedKeys: Object.freeze(['signature', ...excludedKeys]),
  });
}

const tokenOnlyProfile: AllianceSignatureProfile = Object.freeze({
  mode: 'token-only',
  pathParametersIncluded: false,
  excludedKeys: Object.freeze([]),
});

export const ALLIANCE_SIGNATURE_PROFILES: Record<AllianceOperationKey, AllianceSignatureProfile> = Object.freeze({
  'POST /popularize_plan': signedProfile('second_channel_id'),
  'POST /popularize_plans': signedProfile('second_channel_id', 'file', 'X-Requested-With'),
  'POST /popularize_composition/v2': signedProfile(),
  'POST /popularize_compositions/v2': signedProfile('file', 'X-Requested-With'),
  'PUT /popularize_composition/v2/{composition_id}': signedProfile(),
  'GET /popularize_compositions': signedProfile('offset', 'limit'),
  'GET /data_report/real_time_data': tokenOnlyProfile,
  'GET /data_report/daily_data': tokenOnlyProfile,
});

export const ALLIANCE_SUCCESS_MESSAGES: Record<AllianceOperationKey, string> = Object.freeze({
  'POST /popularize_plan': '推广计划创建成功',
  'POST /popularize_plans': '推广计划批量提交成功',
  'POST /popularize_composition/v2': '作品创建成功',
  'POST /popularize_compositions/v2': '作品批量提交成功',
  'PUT /popularize_composition/v2/{composition_id}': '作品更新成功',
  'GET /popularize_compositions': '作品列表获取成功',
  'GET /data_report/real_time_data': '实时数据获取成功',
  'GET /data_report/daily_data': '每日数据获取成功',
});

export interface AllianceListMeta {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface AllianceSuccessProjection {
  readonly data: unknown;
  readonly clientData: unknown;
  readonly message: string;
  readonly meta?: AllianceListMeta;
}

export class AllianceBusinessError extends Error {
  constructor() {
    super('alliance upstream rejected the request');
  }
}

export class AllianceProtocolError extends Error {
  constructor() {
    super('alliance upstream response did not match the contract');
  }
}

interface AllianceOperationContract {
  readonly ingressSchema: ZodTypeAny;
  readonly upstreamRequestSchema: ZodTypeAny;
  readonly signatureProfile: AllianceSignatureProfile;
  readonly message: string;
  parseIngress(input: unknown, pathCompositionId?: unknown): Record<string, unknown>;
  toUpstream(ingress: Record<string, unknown>): Record<string, unknown>;
  projectSuccess(upstream: unknown, ingress: Record<string, unknown>): AllianceSuccessProjection;
}

function recordOf(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new AllianceProtocolError();
  return value as Record<string, unknown>;
}

function envelopeData(value: unknown): unknown {
  const envelope = recordOf(value);
  if (!hasOwn(envelope, 'data')) throw new AllianceProtocolError();
  return envelope.data;
}

function safeId(value: unknown): string {
  if (!isCanonicalCompositionId(value)) throw new AllianceProtocolError();
  return value;
}

function safeString(value: unknown): string {
  if (typeof value !== 'string') throw new AllianceProtocolError();
  return value;
}

function safeScalar(value: unknown): string | number {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new AllianceProtocolError();
}

function safeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new AllianceProtocolError();
  return value;
}

function releaseTimeSeconds(value: string): number {
  const timestamp = Date.parse(value);
  const seconds = Math.floor(timestamp / 1000);
  if (!Number.isSafeInteger(seconds) || seconds < 0) throw new AllianceProtocolError();
  return seconds;
}

function optionalProperty<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

function projectPlan(upstream: unknown, message: string): AllianceSuccessProjection {
  const data = recordOf(envelopeData(upstream));
  const planId = safeId(data.plan_id);
  return { data: { planId }, clientData: { data: { plan_id: planId } }, message };
}

function projectBatch(upstream: unknown, message: string): AllianceSuccessProjection {
  const data = recordOf(envelopeData(upstream));
  const batchTaskId = safeId(data.batch_task_id);
  return { data: { batchTaskId }, clientData: { data: { batch_task_id: batchTaskId } }, message };
}

function projectCompositionCreate(upstream: unknown, message: string): AllianceSuccessProjection {
  const data = recordOf(envelopeData(upstream));
  const compositionId = safeId(data.composition_id);
  return { data: { compositionId }, clientData: { data: { composition_id: compositionId } }, message };
}

function projectCompositionUpdate(upstream: unknown, message: string): AllianceSuccessProjection {
  const data = envelopeData(upstream);
  if (data !== '' && data !== null) throw new AllianceProtocolError();
  return { data: null, clientData: { data: null }, message };
}

function projectCompositionList(
  upstream: unknown,
  ingress: Record<string, unknown>,
  message: string,
): AllianceSuccessProjection {
  const data = envelopeData(upstream);
  if (!Array.isArray(data)) throw new AllianceProtocolError();
  const pagination = recordOf(recordOf(upstream).pagination);
  const total = safeInteger(pagination.total);
  const offset = safeInteger(pagination.offset);
  const upstreamLimit = safeInteger(pagination.limit);
  if (upstreamLimit < 1 || upstreamLimit > 100 || offset % upstreamLimit !== 0) throw new AllianceProtocolError();

  const items = data.map((item) => {
    const source = recordOf(item);
    return {
      compositionId: safeId(source.composition_id),
      compositionUrl: safeString(source.composition_url),
      submitTime: safeScalar(source.submit_time),
      compositionType: safeInteger(source.composition_type),
      compositionSubType: safeInteger(source.composition_sub_type),
      keyword: safeString(source.keyword),
    };
  });
  const page = offset / upstreamLimit + 1;
  const pageSize = upstreamLimit;
  if (
    (ingress.page !== undefined && ingress.page !== page) ||
    (ingress.pageSize !== undefined && ingress.pageSize !== pageSize)
  ) {
    throw new AllianceProtocolError();
  }
  const meta = { page, pageSize, total };
  return { data: items, clientData: { data: items }, message, meta };
}

function projectRealtime(upstream: unknown, message: string): AllianceSuccessProjection {
  const envelope = recordOf(upstream);
  const data = envelopeData(envelope);
  if (!Array.isArray(data)) throw new AllianceProtocolError();
  const timeRange = safeString(envelope.time_range);
  const items = data.map((item) => {
    const source = recordOf(item);
    const sourceFields = recordOf(source.fields_data);
    const fieldsData: Record<string, string | number> = {};
    for (const field of ALLIANCE_REALTIME_FIELDS) {
      if (!hasOwn(sourceFields, field)) continue;
      const publicField = field === 'search_num' ? 'searchNum' : field === 'order_num' ? 'orderNum' : 'createdAt';
      fieldsData[publicField] = safeScalar(sourceFields[field]);
    }
    return {
      keyword: safeString(source.keyword),
      channelId: safeString(source.channel_id),
      channelName: safeString(source.channel_name),
      fieldsData,
    };
  });
  return {
    data: { timeRange, items },
    clientData: { data: { time_range: timeRange, items } },
    message,
  };
}

function asPlanUpstream(ingress: Record<string, unknown>): Record<string, unknown> {
  return {
    task_id: ingress.taskId,
    channel_id: ingress.channelId,
    content_url: ingress.contentUrl,
    popularize_type: ingress.popularizeType,
    keyword: ingress.keyword,
    ...optionalProperty('second_channel_id', ingress.secondChannelId),
  };
}

function asPlanBatchUpstream(ingress: Record<string, unknown>): Record<string, unknown> {
  return {
    task_id: ingress.taskId,
    channel_id: ingress.channelId,
    popularize_type: ingress.popularizeType,
    ...optionalProperty('second_channel_id', ingress.secondChannelId),
  };
}

function asCompositionUpstream(ingress: Record<string, unknown>): Record<string, unknown> {
  if (typeof ingress.releaseTime !== 'string') throw new AllianceProtocolError();
  return {
    plan_id: ingress.planId,
    channel_id: ingress.channelId,
    media_type: ingress.mediaType,
    media_account: ingress.mediaAccount,
    composition_type: ingress.compositionType,
    composition_sub_type: ingress.compositionSubType,
    composition_url: ingress.compositionUrl,
    release_time: releaseTimeSeconds(ingress.releaseTime),
  };
}

function asCompositionBatchUpstream(ingress: Record<string, unknown>): Record<string, unknown> {
  return { bind_type: ingress.bindType, channel_id: ingress.channelId };
}

function asCompositionListUpstream(ingress: Record<string, unknown>): Record<string, unknown> {
  const page = ingress.page;
  const pageSize = ingress.pageSize;
  if (typeof page !== 'number' || typeof pageSize !== 'number') throw new AllianceProtocolError();
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset)) throw new AllianceProtocolError();
  return {
    channel_id: ingress.channelId,
    keyword: ingress.keyword,
    offset,
    limit: pageSize,
  };
}

function asRealtimeUpstream(ingress: Record<string, unknown>): Record<string, unknown> {
  return { type: ingress.type, time_scale: ingress.timeScale, fields: ingress.fields };
}

function asDailyUpstream(ingress: Record<string, unknown>): Record<string, unknown> {
  return { start_date: ingress.startDate, end_date: ingress.endDate };
}

function projectDaily(upstream: unknown, message: string): AllianceSuccessProjection {
  const envelope = recordOf(upstream);
  const container = recordOf(envelopeData(envelope));
  if (!Array.isArray(container.list)) throw new AllianceProtocolError();
  const items = container.list.map((item) => {
    const source = recordOf(item);
    return {
      channel_id: safeString(source.channel_id),
      keyword: safeString(source.keyword),
      stat_date: safeString(source.stat_date),
      impressions: safeScalar(source.impressions ?? 0),
      clicks: safeScalar(source.clicks ?? 0),
      conversions: safeScalar(source.conversions ?? 0),
      earning: safeScalar(source.earning ?? 0),
    };
  });
  return {
    data: { list: items },
    clientData: { data: { list: items } },
    message,
  };
}

function parseWith(schema: ZodTypeAny, value: unknown): Record<string, unknown> {
  return schema.parse(value) as Record<string, unknown>;
}

export const ALLIANCE_OPERATION_CONTRACTS: Record<AllianceOperationKey, AllianceOperationContract> = Object.freeze({
  'POST /popularize_plan': {
    ingressSchema: planIngressSchema,
    upstreamRequestSchema: planUpstreamSchema,
    signatureProfile: ALLIANCE_SIGNATURE_PROFILES['POST /popularize_plan'],
    message: ALLIANCE_SUCCESS_MESSAGES['POST /popularize_plan'],
    parseIngress: (input) => parseWith(planIngressSchema, input),
    toUpstream: asPlanUpstream,
    projectSuccess: (upstream, _ingress) => projectPlan(upstream, ALLIANCE_SUCCESS_MESSAGES['POST /popularize_plan']),
  },
  'POST /popularize_plans': {
    ingressSchema: planBatchIngressSchema,
    upstreamRequestSchema: planBatchUpstreamSchema,
    signatureProfile: ALLIANCE_SIGNATURE_PROFILES['POST /popularize_plans'],
    message: ALLIANCE_SUCCESS_MESSAGES['POST /popularize_plans'],
    parseIngress: (input) => parseWith(planBatchIngressSchema, input),
    toUpstream: asPlanBatchUpstream,
    projectSuccess: (upstream, _ingress) => projectBatch(upstream, ALLIANCE_SUCCESS_MESSAGES['POST /popularize_plans']),
  },
  'POST /popularize_composition/v2': {
    ingressSchema: compositionCreateIngressSchema,
    upstreamRequestSchema: compositionUpstreamSchema,
    signatureProfile: ALLIANCE_SIGNATURE_PROFILES['POST /popularize_composition/v2'],
    message: ALLIANCE_SUCCESS_MESSAGES['POST /popularize_composition/v2'],
    parseIngress: (input) => parseWith(compositionCreateIngressSchema, input),
    toUpstream: asCompositionUpstream,
    projectSuccess: (upstream, _ingress) =>
      projectCompositionCreate(upstream, ALLIANCE_SUCCESS_MESSAGES['POST /popularize_composition/v2']),
  },
  'POST /popularize_compositions/v2': {
    ingressSchema: compositionBatchIngressSchema,
    upstreamRequestSchema: compositionBatchUpstreamSchema,
    signatureProfile: ALLIANCE_SIGNATURE_PROFILES['POST /popularize_compositions/v2'],
    message: ALLIANCE_SUCCESS_MESSAGES['POST /popularize_compositions/v2'],
    parseIngress: (input) => parseWith(compositionBatchIngressSchema, input),
    toUpstream: asCompositionBatchUpstream,
    projectSuccess: (upstream, _ingress) =>
      projectBatch(upstream, ALLIANCE_SUCCESS_MESSAGES['POST /popularize_compositions/v2']),
  },
  'PUT /popularize_composition/v2/{composition_id}': {
    ingressSchema: compositionUpdateIngressSchema,
    upstreamRequestSchema: compositionUpstreamSchema,
    signatureProfile: ALLIANCE_SIGNATURE_PROFILES['PUT /popularize_composition/v2/{composition_id}'],
    message: ALLIANCE_SUCCESS_MESSAGES['PUT /popularize_composition/v2/{composition_id}'],
    parseIngress: (input, pathCompositionId) => {
      const body = parseWith(compositionUpdateBodySchema, input);
      return parseWith(compositionUpdateIngressSchema, { ...body, compositionId: pathCompositionId });
    },
    toUpstream: asCompositionUpstream,
    projectSuccess: (upstream, _ingress) =>
      projectCompositionUpdate(upstream, ALLIANCE_SUCCESS_MESSAGES['PUT /popularize_composition/v2/{composition_id}']),
  },
  'GET /popularize_compositions': {
    ingressSchema: compositionListIngressSchema,
    upstreamRequestSchema: compositionListUpstreamSchema,
    signatureProfile: ALLIANCE_SIGNATURE_PROFILES['GET /popularize_compositions'],
    message: ALLIANCE_SUCCESS_MESSAGES['GET /popularize_compositions'],
    parseIngress: (input) => parseWith(compositionListIngressSchema, input),
    toUpstream: asCompositionListUpstream,
    projectSuccess: (upstream, ingress) =>
      projectCompositionList(upstream, ingress, ALLIANCE_SUCCESS_MESSAGES['GET /popularize_compositions']),
  },
  'GET /data_report/real_time_data': {
    ingressSchema: realtimeIngressSchema,
    upstreamRequestSchema: realtimeUpstreamSchema,
    signatureProfile: ALLIANCE_SIGNATURE_PROFILES['GET /data_report/real_time_data'],
    message: ALLIANCE_SUCCESS_MESSAGES['GET /data_report/real_time_data'],
    parseIngress: (input) => parseWith(realtimeIngressSchema, input),
    toUpstream: asRealtimeUpstream,
    projectSuccess: (upstream, _ingress) =>
      projectRealtime(upstream, ALLIANCE_SUCCESS_MESSAGES['GET /data_report/real_time_data']),
  },
  'GET /data_report/daily_data': {
    ingressSchema: dailyIngressSchema,
    upstreamRequestSchema: dailyUpstreamSchema,
    signatureProfile: ALLIANCE_SIGNATURE_PROFILES['GET /data_report/daily_data'],
    message: ALLIANCE_SUCCESS_MESSAGES['GET /data_report/daily_data'],
    parseIngress: (input) => parseWith(dailyIngressSchema, input),
    toUpstream: asDailyUpstream,
    projectSuccess: (upstream, _ingress) =>
      projectDaily(upstream, ALLIANCE_SUCCESS_MESSAGES['GET /data_report/daily_data']),
  },
});

function operationKey(endpoint: AllianceEndpoint): AllianceOperationKey {
  const key = endpoint.definitionKey as AllianceOperationKey;
  if (!ALLIANCE_OPERATION_CONTRACTS[key]) throw new AllianceProtocolError();
  return key;
}

export function getAllianceContract(endpoint: AllianceEndpoint): AllianceOperationContract {
  return ALLIANCE_OPERATION_CONTRACTS[operationKey(endpoint)];
}

export function getAllianceSignatureProfile(endpoint: AllianceEndpoint): AllianceSignatureProfile {
  return getAllianceContract(endpoint).signatureProfile;
}

export function parseAllianceIngress(
  endpoint: AllianceEndpoint,
  input: unknown,
  pathCompositionId?: unknown,
): Record<string, unknown> {
  return getAllianceContract(endpoint).parseIngress(input, pathCompositionId);
}

export function adaptAllianceIngress(
  endpoint: AllianceEndpoint,
  ingress: Record<string, unknown>,
): Record<string, unknown> {
  const contract = getAllianceContract(endpoint);
  return parseWith(contract.upstreamRequestSchema, contract.toUpstream(ingress));
}

export function parseAllianceUpstreamRequest(endpoint: AllianceEndpoint, input: unknown): Record<string, unknown> {
  return parseWith(getAllianceContract(endpoint).upstreamRequestSchema, input);
}

export function prepareAllianceRequest(
  endpoint: AllianceEndpoint,
  upstreamInput: unknown,
  accessToken: string,
  secretKey: string,
  timestamp = Math.floor(Date.now() / 1000),
): Record<string, unknown> {
  const upstream = parseAllianceUpstreamRequest(endpoint, upstreamInput);
  const profile = getAllianceSignatureProfile(endpoint);
  if (profile.mode === 'token-only') return { ...upstream, access_token: accessToken };
  return injectSignParams(upstream, accessToken, secretKey, timestamp, profile);
}

export function isAllianceBusinessFailure(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const envelope = value as Record<string, unknown>;
  return hasOwn(envelope, 'error') || envelope.success === false;
}

export function projectAllianceSuccess(
  endpoint: AllianceEndpoint,
  upstream: unknown,
  ingress: Record<string, unknown>,
): AllianceSuccessProjection {
  if (isAllianceBusinessFailure(upstream)) throw new AllianceBusinessError();
  return getAllianceContract(endpoint).projectSuccess(upstream, ingress);
}
