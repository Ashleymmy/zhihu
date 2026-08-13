import { Router } from 'express';
import { requireAuth } from '../auth/middleware';
import { ok } from '../utils/response';
import { COMPOSITION_SUB_TYPES, COMPOSITION_TYPES, ZHIHU_MEDIA_TYPES } from '../zhihu/composition';

export const metaRouter = Router();
metaRouter.use(requireAuth);
metaRouter.get('/enums', (_req, res) => ok(res, {
  mediaType: ZHIHU_MEDIA_TYPES.map((value) => ({ value, label: value })),
  compositionType: COMPOSITION_TYPES,
  compositionSubType: COMPOSITION_SUB_TYPES,
  popularizeType: [{ value: 0, label: '内容推广' }],
  planStatus: [
    { value: 'pending', label: '待同步', color: 'gold' },
    { value: 'active', label: '投放中', color: 'green' },
    { value: 'paused', label: '已暂停', color: 'orange' },
    { value: 'rejected', label: '已驳回', color: 'red' },
    { value: 'ended', label: '已结束', color: 'default' },
  ],
}));
