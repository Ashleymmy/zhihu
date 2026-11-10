import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errors';
import { ok } from '../utils/response';
import type { ModuleRuntime } from './module-runtime';
import { createSettlementPaymentsRouter } from './settlement-payments-routes';
import {
  settlementBaseSchema,
  settlementOwnerSchema,
  settlementScopeSchema,
  settlementId,
  settlementKey,
  settlementPage,
  settlementRecipients,
  settlementReview,
  settlementRecord,
  previewSettlement,
  confirmSettlement,
  settlementDetail,
  settlementList,
  financeRecordComments,
} from './settlements';

const version = z.string().regex(/^[a-f0-9]{64}$/);
const comment = { body: z.string().trim().min(1).max(2000), requestKey: settlementKey };
export function createSettlementRouter(runtime: ModuleRuntime) {
  const r = Router();
  r.use(createSettlementPaymentsRouter(runtime));
  r.get(
    '/recipients',
    asyncHandler(async (req, res) => {
      const { search, page, pageSize, ...scope } = settlementBaseSchema
        .extend({ search: z.string().trim().max(128).default(''), ...settlementPage })
        .strict()
        .parse(req.query);
      ok(res, await settlementRecipients(runtime, req.user, scope, search, page, pageSize));
    }),
  );
  r.get(
    '/review',
    asyncHandler(async (req, res) => {
      const { page, pageSize, status, ...scope } = settlementScopeSchema
        .extend({ ...settlementPage, status: z.enum(['all', 'ready', 'blocked', 'confirmed']).default('all') })
        .strict()
        .parse(req.query);
      ok(res, await settlementReview(runtime, req.user, scope, page, pageSize, status));
    }),
  );
  r.get(
    '/records/:sourceId',
    asyncHandler(async (req, res) => {
      ok(
        res,
        await settlementRecord(
          runtime,
          req.user,
          settlementScopeSchema.strict().parse(req.query),
          settlementId.parse(req.params.sourceId),
        ),
      );
    }),
  );
  r.get(
    '/records/:sourceId/comments',
    asyncHandler(async (req, res) => {
      const { page, pageSize, ...scope } = settlementScopeSchema.extend(settlementPage).strict().parse(req.query);
      ok(
        res,
        await financeRecordComments(
          runtime,
          req.user,
          scope,
          'earning_source',
          settlementId.parse(req.params.sourceId),
          { scope, page, pageSize },
        ),
      );
    }),
  );
  r.post(
    '/records/:sourceId/comments',
    asyncHandler(async (req, res) => {
      const { body, requestKey, ...scope } = settlementScopeSchema.extend(comment).strict().parse(req.body);
      ok(
        res,
        await financeRecordComments(
          runtime,
          req.user,
          scope,
          'earning_source',
          settlementId.parse(req.params.sourceId),
          { scope, body, requestKey },
        ),
        201,
      );
    }),
  );
  r.post(
    '/previews',
    asyncHandler(async (req, res) => {
      const { expectedReviewVersion, requestKey, ...scope } = settlementScopeSchema
        .extend({ expectedReviewVersion: version, requestKey: settlementKey })
        .strict()
        .parse(req.body);
      ok(res, await previewSettlement(runtime, req.user, scope, expectedReviewVersion, requestKey), 201);
    }),
  );
  r.get(
    '/',
    asyncHandler(async (req, res) => {
      const { page, pageSize, ...scope } = settlementBaseSchema
        .extend({ leaderId: settlementId.optional(), ...settlementPage })
        .strict()
        .parse(req.query);
      ok(res, await settlementList(runtime, req.user, scope, page, pageSize));
    }),
  );
  r.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const { page, pageSize, ...owner } = settlementOwnerSchema.extend(settlementPage).strict().parse(req.query);
      ok(res, await settlementDetail(runtime, req.user, owner, settlementId.parse(req.params.id), page, pageSize));
    }),
  );
  r.post(
    '/:id/confirm',
    asyncHandler(async (req, res) => {
      const { expectedVersion, requestKey, ...owner } = settlementOwnerSchema
        .extend({ expectedVersion: version, requestKey: settlementKey })
        .strict()
        .parse(req.body);
      ok(
        res,
        await confirmSettlement(
          runtime,
          req.user,
          owner,
          settlementId.parse(req.params.id),
          expectedVersion,
          requestKey,
        ),
      );
    }),
  );
  r.get(
    '/:id/comments',
    asyncHandler(async (req, res) => {
      const { page, pageSize, ...owner } = settlementOwnerSchema.extend(settlementPage).strict().parse(req.query);
      ok(
        res,
        await financeRecordComments(runtime, req.user, owner, 'settlement', settlementId.parse(req.params.id), {
          page,
          pageSize,
        }),
      );
    }),
  );
  r.post(
    '/:id/comments',
    asyncHandler(async (req, res) => {
      const { body, requestKey, ...owner } = settlementOwnerSchema.extend(comment).strict().parse(req.body);
      ok(
        res,
        await financeRecordComments(runtime, req.user, owner, 'settlement', settlementId.parse(req.params.id), {
          body,
          requestKey,
        }),
        201,
      );
    }),
  );
  return r;
}
