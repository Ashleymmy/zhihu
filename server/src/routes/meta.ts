import { Router } from 'express';
import { requireAuth } from '../auth/middleware';
import { ok } from '../utils/response';

export const metaRouter = Router();
metaRouter.use(requireAuth);
metaRouter.get('/enums', (_req, res) => ok(res, {
  mediaType: [{ value: 1, label: '抖音' }, { value: 2, label: '小红书' }],
  compositionType: [{ value: 1, label: '视频' }, { value: 2, label: '图文' }],
  compositionSubType: [{ value: 11, label: '口播', parent: 1 }, { value: 12, label: '剧情', parent: 1 }],
  popularizeType: [{ value: 0, label: '内容推广' }],
  planStatus: [
    { value: 'pending', label: '待同步', color: 'gold' },
    { value: 'active', label: '投放中', color: 'green' },
    { value: 'paused', label: '已暂停', color: 'orange' },
    { value: 'rejected', label: '已驳回', color: 'red' },
    { value: 'ended', label: '已结束', color: 'default' },
  ],
}));
