import { z } from 'zod';
import { config } from '../config';
import { AppError } from '../../../middleware/errors';
import { injectSignParams } from '../sign/zhihu';
import { resolveClientEndpoint } from './allianceEndpointRegistry';
import { requestAlliance } from './allianceEgress';

export class RiskRejectedError extends Error {}
export const riskFilters = z.object({
  type: z.coerce.number().int().min(0).max(1).default(1),
  keyword: z.string().trim().max(128).optional(),
  risk_type: z.coerce.number().int().min(1).max(2).optional(),
  // Keep UI query values 1/2/3. Live GET verification on 2026-11-05 showed
  // upstream accepts 0/1/2 and rejects 3, contrary to V1.4.20 p.58.
  status: z.coerce.number().int().min(1).max(3).optional(),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const responseSchema = z.object({
  data: z.array(
    z.object({
      type: z.number().int().min(0).max(1),
      risk_type: z.number().int().min(1).max(2),
      keyword: z.string(),
      channel: z.string().nullish(),
      create_channel: z.string().nullish(),
      status: z.number().int(),
      valided_at: z.string().nullish(),
    }),
  ),
  pagination: z.object({
    is_first: z.boolean(),
    is_end: z.boolean(),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  }),
});
const endpoint = (method: 'GET' | 'POST', path: string) => {
  const value = resolveClientEndpoint(method, '/alliance/api/' + path);
  if (!value) throw new Error('Risk endpoint is not registered');
  return value;
};
function signed(input: Record<string, unknown>) {
  return injectSignParams(input, config.zhihu.accessToken, config.zhihu.secretKey, Math.floor(Date.now() / 1000), {
    excludedKeys: ['signature', 'file', 'image', 'X-Requested-With'],
  });
}
function rejected(value: unknown) {
  return !!value && typeof value === 'object' && ('error' in value || ('success' in value && value.success === false));
}
export async function riskList(input: z.infer<typeof riskFilters>) {
  try {
    const response = await requestAlliance({
      endpoint: endpoint('GET', 'risk_words'),
      params: {
        ...input,
        ...(input.status === undefined ? {} : { status: input.status - 1 }),
        access_token: config.zhihu.accessToken,
      },
    });
    const data = responseSchema.parse(response.data);
    return {
      list: data.data.map((row) => ({
        keyword: row.keyword,
        type: row.type,
        riskType: row.risk_type,
        channel: row.channel ?? '',
        createChannel: row.create_channel ?? '',
        status: ({ 0: 'reviewing', 1: 'violation', 2: 'normal' } as Record<number, string>)[row.status] ?? 'unknown',
        validedAt: row.valided_at ?? '',
      })),
      total: data.pagination.total,
      hasNext: !data.pagination.is_end,
      offset: data.pagination.offset,
      limit: data.pagination.limit,
    };
  } catch {
    throw new AppError(502, 50002, '暂时无法读取知乎举报结果，请重新查询');
  }
}
export async function uploadRiskImage(file: { buffer: Buffer; mimetype: string }) {
  const form = new FormData();
  for (const [key, value] of Object.entries(signed({ file_type: 1 }))) form.set(key, String(value));
  form.set(
    'file',
    new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
    file.mimetype === 'image/png' ? 'evidence.png' : 'evidence.jpg',
  );
  try {
    const response = await requestAlliance({ endpoint: endpoint('POST', 'basic/file_upload'), data: form });
    const value = z
      .object({
        success: z.literal(true),
        data: z.object({
          file_token: z
            .string()
            .min(1)
            .max(512)
            .regex(/^[\w-]+$/),
        }),
      })
      .parse(response.data);
    return value.data.file_token;
  } catch {
    throw new AppError(502, 50002, '截图上传知乎失败，请重新上传这张截图');
  }
}
export async function sendRiskReport(input: Record<string, unknown>) {
  let response;
  try {
    response = await requestAlliance({ endpoint: endpoint('POST', 'risk_words'), data: signed(input) });
  } catch (error) {
    // Only an explicit upstream business rejection is safe to call unsuccessful.
    const data = (error as { response?: { data?: unknown } })?.response?.data;
    if (rejected(data)) throw new RiskRejectedError();
    throw error;
  }
  if (rejected(response.data)) throw new RiskRejectedError();
  if (
    !response.data ||
    typeof response.data !== 'object' ||
    !('success' in response.data) ||
    response.data.success !== true
  )
    throw new Error('Unknown risk submission result');
}
