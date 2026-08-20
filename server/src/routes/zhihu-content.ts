import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { requirePermission } from '../auth/permissions';
import { asyncHandler } from '../middleware/errors';
import { validateQuery } from '../middleware/validate';
import { zhihuGet } from '../zhihu/client';
import { ok } from '../utils/response';

/**
 * 知乎故事内容域：盐选榜单/有声书/漫剧/评论截流/风险举报/内容标签。
 * 薄代理：权限校验后直接转发知乎联盟 OpenApi（OpenApi V1.4.17 §2.7-2.13），数据不落库。
 */

const paging = z.object({
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const zhihuContentRouter = Router();
zhihuContentRouter.use(requireAuth);
zhihuContentRouter.use(requirePermission('story.read'));

/** 盐选榜单列表（§2.7.1） */
zhihuContentRouter.get(
  '/salt/boards',
  asyncHandler(async (_req, res) => ok(res, await zhihuGet('/alliance/api/vip/content/rule/labels'))),
);

/** 榜单内容数据列表（§2.7.2） */
zhihuContentRouter.get(
  '/salt/boards/:ruleId/contents',
  validateQuery(paging),
  asyncHandler(async (req, res) =>
    ok(res, await zhihuGet('/alliance/api/vip/rule_contents', { rule_id: req.params.ruleId, ...req.query })),
  ),
);

/** 有声书内容列表（§2.8.1） */
zhihuContentRouter.get(
  '/audio/contents',
  validateQuery(paging),
  asyncHandler(async (req, res) => ok(res, await zhihuGet('/alliance/api/vip/audio/contents', req.query))),
);

/** 漫剧剧目列表（§2.11.1） */
zhihuContentRouter.get(
  '/comic-dramas',
  validateQuery(paging.extend({ title: z.string().trim().max(128).optional() })),
  asyncHandler(async (req, res) => ok(res, await zhihuGet('/alliance/api/comic_dramas', req.query))),
);

/** 评论截流词列表（§2.9.3） */
zhihuContentRouter.get(
  '/intercept-words',
  validateQuery(
    paging.extend({
      type: z.coerce.number().int().min(0).max(1).optional(),
      keyword: z.string().trim().max(128).optional(),
      status: z.coerce.number().int().min(1).max(3).optional(),
    }),
  ),
  asyncHandler(async (req, res) => ok(res, await zhihuGet('/alliance/api/intercept_words', req.query))),
);

/** 风险词列表（§2.13.2） */
zhihuContentRouter.get(
  '/risk-words',
  validateQuery(
    paging.extend({
      type: z.coerce.number().int().min(0).max(1).optional(),
      keyword: z.string().trim().max(128).optional(),
      risk_type: z.coerce.number().int().min(1).max(2).optional(),
      status: z.coerce.number().int().min(1).max(3).optional(),
    }),
  ),
  asyncHandler(async (req, res) => ok(res, await zhihuGet('/alliance/api/risk_words', req.query))),
);

/** 单个内容标签查询（§2.12.1） */
zhihuContentRouter.get(
  '/content-tag',
  validateQuery(
    z.object({
      url: z.string().url().max(1024),
      tags: z.string().regex(/^[123](,[123])*$/, 'tags 只能是 1/2/3 的逗号组合'),
    }),
  ),
  asyncHandler(async (req, res) => ok(res, await zhihuGet('/alliance/api/content_tag', req.query))),
);
