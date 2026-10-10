import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../../auth/middleware';
import { asyncHandler } from '../../../middleware/errors';
import { ok } from '../../../utils/response';
import { legacyFinanceReadOnly } from '../services/legacy-finance-access';
import { financeHistory, historyLines, historyKinds } from '../services/finance-history';
import {previewLegacyImportRemoval,removeLegacyImport} from '../services/legacy-import-removal';
const paging = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export const financeHistoryRouter = Router();
financeHistoryRouter.use(requireAuth);
financeHistoryRouter.get('/data-import/:id/removal',asyncHandler(async(req,res)=>{
 ok(res,await previewLegacyImportRemoval(req.user,z.string().regex(/^\d+$/).parse(req.params.id)));
}));
financeHistoryRouter.post('/data-import/:id/removal',asyncHandler(async(req,res)=>{
 const body=z.object({reviewHash:z.string().length(64)}).parse(req.body);
 ok(res,await removeLegacyImport(req.user,z.string().regex(/^\d+$/).parse(req.params.id),body.reviewHash));
}));
financeHistoryRouter.use(legacyFinanceReadOnly);
financeHistoryRouter.get(
  '/:kind',
  asyncHandler(async (req, res) => {
    const q = paging.parse(req.query);
    ok(res, await financeHistory(req.user, z.enum(historyKinds).parse(req.params.kind), q.page, q.pageSize));
  }),
);
financeHistoryRouter.get(
  '/:kind/:id/lines',
  asyncHandler(async (req, res) => {
    const q = paging.parse(req.query);
    ok(
      res,
      await historyLines(
        req.user,
        z.enum(historyKinds).parse(req.params.kind),
        z.string().regex(/^\d+$/).parse(req.params.id),
        q.page,
        q.pageSize,
      ),
    );
  }),
);
