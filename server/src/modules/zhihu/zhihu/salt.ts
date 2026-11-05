import { z } from 'zod';
import { config } from '../config';
import { AppError } from '../../../middleware/errors';
import { requestAlliance } from './allianceEgress';
import { resolveClientEndpoint } from './allianceEndpointRegistry';

// Upstream IDs exceed Number.MAX_SAFE_INTEGER; never round them through Number.
export const saltId = z.string().regex(/^\d{1,32}$/);
const upstreamId = z.union([saltId, z.number().int().safe().nonnegative().transform(String)]);
const text = z
  .string()
  .nullish()
  .transform((value) => value ?? '');
const link = text.transform((value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
});
const boardSchema = z.object({ id: upstreamId, name: z.string().min(1), type: z.number().int(), updated_at: text });
const contentSchema = z.object({
  id: upstreamId,
  title: z.string().min(1),
  url: link,
  paid_column: z.object({ title: text, url: link }).nullish(),
  topic: z.array(z.object({ name: text, url: link })).nullish(),
  category: text,
  content_type: text,
  content_subjective_level: text,
  bayes_first_category: text,
  bayes_second_category: text,
  theme: text,
  r_cmd_consume_value: text,
});
export const saltPaging = z.object({
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const contentsSchema = z.object({
  data: z.array(contentSchema),
  pagination: z.object({
    is_first: z.boolean(),
    is_end: z.boolean(),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  }),
});
async function get(path: string, params: Record<string, string | number> = {}) {
  const endpoint = resolveClientEndpoint('GET', '/alliance/api' + path);
  if (!endpoint) throw new Error('Missing salt endpoint');
  return (await requestAlliance({ endpoint, params: { ...params, access_token: config.zhihu.accessToken } })).data;
}
export async function saltBoards() {
  try {
    return {
      list: z
        .array(boardSchema)
        .parse(await get('/vip/content/rule/labels'))
        .map((row) => ({ id: row.id, name: row.name, type: row.type, updatedAt: row.updated_at })),
    };
  } catch {
    throw new AppError(502, 50002, '暂时无法读取知乎榜单，请重新加载');
  }
}
export async function saltContents(ruleId: string, paging: z.infer<typeof saltPaging>) {
  try {
    const result = contentsSchema.parse(await get('/vip/rule_contents', { rule_id: ruleId, ...paging }));
    const p = result.pagination;
    if (p.offset !== paging.offset || result.data.length > paging.limit || (!p.is_end && !result.data.length))
      throw new Error('Invalid pagination');
    return {
      list: result.data.map((row) => ({
        id: row.id,
        title: row.title,
        url: row.url,
        columnTitle: row.paid_column?.title ?? '',
        columnUrl: row.paid_column?.url ?? '',
        topics: (row.topic ?? []).map((topic) => topic.name).filter(Boolean),
        category: row.category,
        contentType: row.content_type,
        contentLevel: row.content_subjective_level,
        firstCategory: row.bayes_first_category,
        secondCategory: row.bayes_second_category,
        theme: row.theme,
        consumeValue: row.r_cmd_consume_value,
      })),
      total: p.total,
      offset: p.offset,
      limit: paging.limit,
      hasNext: !p.is_end,
    };
  } catch {
    throw new AppError(502, 50002, '暂时无法读取榜单内容，请重试或切换榜单');
  }
}
