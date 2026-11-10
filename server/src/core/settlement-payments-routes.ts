import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errors';
import { ok } from '../utils/response';
import type { ModuleRuntime } from './module-runtime';
import { settlementId, settlementKey, settlementOwnerSchema, settlementPage } from './settlements';
import {
  settlementPayments,
  settlementPaymentQuote,
  createSettlementPayment,
  settlementPaymentFunding,
  settlementPaymentAction,
  legacySettlementPayments,
  previewSettlementPaymentLink,
  linkSettlementPayment,
  settlementPaymentComments,
  settlementPaymentExport,
} from './settlement-payments';

const version = z.string().regex(/^[a-f0-9]{64}$/);
const money = z.string().regex(/^\d{1,16}(\.\d{1,2}0{0,2})?$/);
const links = {
  withdrawalId: settlementId,
  allocations: z
    .array(z.object({ sourceId: settlementId, amount: z.string().regex(/^\d{1,16}(\.\d{1,4})?$/) }).strict())
    .min(1)
    .max(1000),
};
const action = {
  requestKey: settlementKey,
  expectedVersion: version,
  action: z.enum(['cancel', 'failed', 'retry']),
  reason: z.string().trim().max(500).default(''),
};
export function createSettlementPaymentsRouter(runtime: ModuleRuntime) {
  const r = Router();
  r.get(
    '/:id/payments',
    asyncHandler(async (req, res) => {
      const { page, pageSize, withdrawalId, paymentView, ...owner } = settlementOwnerSchema
        .extend({
          ...settlementPage,
          withdrawalId: settlementId.optional(),
          paymentView: z.enum(['all', 'processing', 'paid']).default('all'),
        })
        .strict()
        .parse(req.query);
      ok(
        res,
        await settlementPayments(
          runtime,
          req.user,
          owner,
          settlementId.parse(req.params.id),
          page,
          pageSize,
          withdrawalId,
          paymentView,
        ),
      );
    }),
  );
  r.post(
    '/:id/payment-quote',
    asyncHandler(async (req, res) => {
      const { amount, expectedVersion, ...owner } = settlementOwnerSchema
        .extend({ amount: money, expectedVersion: version })
        .strict()
        .parse(req.body);
      ok(
        res,
        await settlementPaymentQuote(
          runtime,
          req.user,
          owner,
          settlementId.parse(req.params.id),
          amount,
          expectedVersion,
        ),
      );
    }),
  );
  r.post(
    '/:id/payments',
    asyncHandler(async (req, res) => {
      const {
        requestKey,
        expectedVersion,
        amount,
        policyVersion,
        quoteToken,
        receiverName,
        payMethod,
        payAccount,
        ...owner
      } = settlementOwnerSchema
        .extend({
          requestKey: settlementKey,
          expectedVersion: version,
          amount: money,
          policyVersion: z.string().max(64).nullable(),
          quoteToken: version,
          receiverName: z.string().trim().min(1).max(128),
          payMethod: z.enum(['wechat', 'alipay', 'bank']),
          payAccount: z.string().trim().min(1).max(128),
        })
        .strict()
        .parse(req.body);
      ok(
        res,
        await createSettlementPayment(runtime, req.user, owner, settlementId.parse(req.params.id), {
          requestKey,
          expectedVersion,
          amount,
          policyVersion,
          quoteToken,
          receiverName,
          payMethod,
          payAccount,
        }),
        201,
      );
    }),
  );
  r.post(
    '/:id/funding',
    asyncHandler(async (req, res) => {
      const { requestKey, expectedVersion, reference, ...owner } = settlementOwnerSchema
        .extend({
          requestKey: settlementKey,
          expectedVersion: version,
          reference: z.string().trim().max(255).optional(),
        })
        .strict()
        .parse(req.body);
      ok(
        res,
        await settlementPaymentFunding(runtime, req.user, owner, settlementId.parse(req.params.id), {
          requestKey,
          expectedVersion,
          reference,
        }),
      );
    }),
  );
  r.post(
    '/:id/payments/:withdrawalId/action',
    asyncHandler(async (req, res) => {
      const {
        requestKey,
        expectedVersion,
        action: command,
        reason,
        ...owner
      } = settlementOwnerSchema
        .extend(action)
        .strict()
        .refine((input) => input.action === 'retry' || input.reason.length > 0, {
          message: '请填写取消或失败的原因',
          path: ['reason'],
        })
        .parse(req.body);
      ok(
        res,
        await settlementPaymentAction(
          runtime,
          req.user,
          owner,
          settlementId.parse(req.params.id),
          settlementId.parse(req.params.withdrawalId),
          { requestKey, expectedVersion, action: command, reason },
        ),
      );
    }),
  );
  r.get(
    '/:id/legacy-payments',
    asyncHandler(async (req, res) => {
      const { page, pageSize, ...owner } = settlementOwnerSchema.extend(settlementPage).strict().parse(req.query);
      ok(
        res,
        await legacySettlementPayments(runtime, req.user, owner, settlementId.parse(req.params.id), page, pageSize),
      );
    }),
  );
  r.post(
    '/:id/payment-links/preview',
    asyncHandler(async (req, res) => {
      const { withdrawalId, allocations, ...owner } = settlementOwnerSchema.extend(links).strict().parse(req.body);
      ok(
        res,
        await previewSettlementPaymentLink(runtime, req.user, owner, settlementId.parse(req.params.id), {
          withdrawalId,
          allocations,
        }),
      );
    }),
  );
  r.post(
    '/:id/payment-links',
    asyncHandler(async (req, res) => {
      const { withdrawalId, allocations, requestKey, expectedVersion, ...owner } = settlementOwnerSchema
        .extend({ ...links, requestKey: settlementKey, expectedVersion: version })
        .strict()
        .parse(req.body);
      ok(
        res,
        await linkSettlementPayment(runtime, req.user, owner, settlementId.parse(req.params.id), {
          withdrawalId,
          allocations,
          requestKey,
          expectedVersion,
        }),
      );
    }),
  );
  r.get(
    '/:id/payments/:withdrawalId/comments',
    asyncHandler(async (req, res) => {
      const { page, pageSize, ...owner } = settlementOwnerSchema.extend(settlementPage).strict().parse(req.query);
      ok(
        res,
        await settlementPaymentComments(
          runtime,
          req.user,
          owner,
          settlementId.parse(req.params.id),
          settlementId.parse(req.params.withdrawalId),
          { page, pageSize },
        ),
      );
    }),
  );
  r.post(
    '/:id/payments/:withdrawalId/comments',
    asyncHandler(async (req, res) => {
      const { body, requestKey, ...owner } = settlementOwnerSchema
        .extend({ body: z.string().trim().min(1).max(2000), requestKey: settlementKey })
        .strict()
        .parse(req.body);
      ok(
        res,
        await settlementPaymentComments(
          runtime,
          req.user,
          owner,
          settlementId.parse(req.params.id),
          settlementId.parse(req.params.withdrawalId),
          { body, requestKey },
        ),
        201,
      );
    }),
  );
  r.get(
    '/:id/export',
    asyncHandler(async (req, res) => {
      const owner = settlementOwnerSchema.strict().parse(req.query),
        id = settlementId.parse(req.params.id);
      const csv = await settlementPaymentExport(runtime, req.user, owner, id);
      res
        .type('text/csv; charset=utf-8')
        .setHeader('Content-Disposition', `attachment; filename="settlement-${id}.csv"`);
      res.send(csv);
    }),
  );
  return r;
}
