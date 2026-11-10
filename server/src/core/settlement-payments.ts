import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { AuthUser } from '../types';
import type { ModuleRuntime } from './module-runtime';
import type { SettlementDocument } from './settlement-contracts';
import { withTransaction } from '../db';
import { AppError } from '../middleware/errors';
import { writeAudit } from '../services/audit.service';
import { cash, cashText, checksum } from './money';
import { balance, dailyQuota, checkQuota } from './finance';
import { financeReceipt } from './finance-receipts';
import { assertSettlementPaymentSafe } from './settlement-payment-guards';
import { calculateWithdrawal, withdrawalPolicyEnabled, withdrawalRules } from './withdrawal-policy';
import { settlementAccess, storedDocument, commentView } from './settlements';

export interface PaymentOwner {
  moduleId: string;
  projectId: string;
  accountId: string;
  leaderId: string;
}
type Context = { actor: AuthUser; doc: SettlementDocument; recipient: RowDataPacket };
type PaymentAllocation = { sourceId: string; sourceKey: string; businessDate: string; amount: string };
const q = async (c: PoolConnection, sql: string, args: unknown[] = []) =>
  (await c.query<RowDataPacket[]>(sql, args))[0];
function fail(message: string, status = 409): never {
  throw new AppError(status, status * 100, message);
}
const amount = (v: unknown) => cash(String(v ?? '0'), true);
const positive = (v: bigint) => (v > 0n ? v : 0n);
const min = (...values: bigint[]) => values.reduce((a, b) => (a < b ? a : b));
const active = (s: unknown) => ['pending', 'approved', 'paid'].includes(String(s));
const ownerArgs = (s: PaymentOwner) => [s.moduleId, s.projectId, s.accountId, s.leaderId];
const pageOf = <T>(list: T[], page: number, pageSize: number) => ({
  list: list.slice((page - 1) * pageSize, page * pageSize),
  total: list.length,
  page,
  pageSize,
});
const decode = <T>(v: unknown): T => (typeof v === 'string' ? (JSON.parse(v) as T) : (v as T));

async function context(
  c: PoolConnection,
  runtime: ModuleRuntime,
  user: AuthUser,
  owner: PaymentOwner,
  id: string,
  lock = false,
): Promise<Context> {
  // Match applyWithdrawal: the recipient lock serializes its daily allowance across projects.
  const [recipient] = await q(
    c,
    'SELECT id,role,is_active,closed_at,display_name FROM users WHERE id=?' + (lock ? ' FOR UPDATE' : ''),
    [owner.leaderId],
  );
  const { actor } = await settlementAccess(
    c,
    runtime,
    user,
    owner,
    lock ? { ...owner, from: '2000-01-01', to: '2000-01-01' } : undefined,
  );
  const { doc } = await storedDocument(c, id, owner, lock);
  if (doc.status !== 'confirmed') fail('请先确认结算金额，再办理付款');
  if (!recipient) fail('收款人不存在，请重新选择', 404);
  return { actor, doc, recipient };
}

async function readModel(c: PoolConnection, owner: PaymentOwner, ctx: Context) {
  const selected = ctx.doc.items.filter((i) => i.status === 'confirmed');
  const sourceIds = selected.map((i) => i.record.id);
  const sources = sourceIds.length
    ? await q(
        c,
        `SELECT CAST(es.id AS CHAR) source_id,CAST(s.id AS CHAR) income_source_id,
    es.source_key,es.current_version,s.source_version,s.blocked_reason,es.blocked_reason earning_blocked,
    DATE_FORMAT(s.business_date,'%Y-%m-%d') business_date,es.task_name,
    CAST(SUM(e.amount) AS CHAR) confirmed_amount,
    CAST(SUM(IF(e.availability='held',e.amount,0)) AS CHAR) held_amount,
    CAST(SUM(IF(e.availability='available',e.amount,0)) AS CHAR) released_amount,
    (SELECT COUNT(*) FROM opc_earning_lines l WHERE l.source_id=es.id AND l.source_version=es.current_version AND (l.confirmed_at IS NULL OR l.is_ready=0)) unconfirmed
    FROM opc_earning_sources es JOIN opc_income_sources s ON s.module_id=es.module_id AND s.project_id=es.project_id AND s.account_id=es.account_id AND s.source_key=es.source_key
    JOIN opc_income_entries e ON e.source_id=s.id AND e.user_id=?
    WHERE es.id IN (?) AND es.module_id=? AND es.project_id=? AND es.account_id=?
    GROUP BY es.id,s.id ORDER BY es.id`,
        [owner.leaderId, sourceIds, owner.moduleId, owner.projectId, owner.accountId],
      )
    : [];
  const withdrawals = await q(
    c,
    `SELECT w.status,w.receiver_name,w.pay_method,w.pay_account,w.payment_version,w.payment_reference,w.proof_name,
    CAST(w.id AS CHAR) id,CAST(w.user_id AS CHAR) user_id,CAST(w.amount AS CHAR) amount,
    DATE_FORMAT(w.paid_on,'%Y-%m-%d') paid_day,DATE_FORMAT(w.created_at,'%Y-%m-%d %H:%i:%s') created_text,
    t.policy_version,CAST(COALESCE(t.fee_amount,0) AS CHAR) fee_amount,CAST(COALESCE(t.net_amount,w.amount) AS CHAR) net_amount,
    DATE_FORMAT(t.review_deadline,'%Y-%m-%d') review_deadline,DATE_FORMAT(t.settlement_deadline,'%Y-%m-%d') settlement_deadline,
    COALESCE(t.invoice_required,0) invoice_required,i.status invoice_status,COALESCE(i.version,0) invoice_version,i.filename invoice_name,i.reason invoice_reason,ii.instructions invoice_instructions,
    CAST(o.settlement_id AS CHAR) origin_settlement_id,CAST(o.initiated_by AS CHAR) initiated_by,o.failure_reason,o.attempt_version,
    initiator.display_name initiator_name,payer.display_name paid_by_name
    FROM opc_withdrawals w LEFT JOIN opc_withdrawal_terms t ON t.withdrawal_id=w.id
    LEFT JOIN opc_withdrawal_invoices i ON i.id=(SELECT MAX(i2.id) FROM opc_withdrawal_invoices i2 WHERE i2.withdrawal_id=w.id)
    LEFT JOIN opc_withdrawal_invoice_instructions ii ON ii.withdrawal_id=w.id
    LEFT JOIN opc_settlement_payment_origins o ON o.withdrawal_id=w.id LEFT JOIN users initiator ON initiator.id=o.initiated_by
    LEFT JOIN users payer ON payer.id=w.paid_by
    WHERE w.module_id=? AND w.project_id=? AND w.account_id=? AND w.user_id=? ORDER BY w.id`,
    ownerArgs(owner),
  );
  const allocations = withdrawals.length
    ? await q(
        c,
        `SELECT CAST(a.id AS CHAR) id,CAST(a.withdrawal_id AS CHAR) withdrawal_id,
    CAST(a.income_source_id AS CHAR) income_source_id,CAST(a.earning_source_id AS CHAR) source_id,CAST(a.settlement_id AS CHAR) settlement_id,
    CAST(a.amount AS CHAR) amount,a.source_version,a.entry_ids_json,CAST(a.linked_by AS CHAR) linked_by,
    es.source_key,DATE_FORMAT(es.business_date,'%Y-%m-%d') business_date
    FROM opc_settlement_payment_allocations a JOIN opc_earning_sources es ON es.id=a.earning_source_id WHERE a.withdrawal_id IN (?) ORDER BY a.withdrawal_id,a.id`,
        [withdrawals.map((w) => w.id)],
      )
    : [];
  const entries = sourceIds.length
    ? await q(
        c,
        `SELECT CAST(e.id AS CHAR) id,CAST(e.source_id AS CHAR) income_source_id,CAST(e.amount AS CHAR) amount,e.availability,e.source_version
    FROM opc_income_entries e JOIN opc_income_sources s ON s.id=e.source_id JOIN opc_earning_sources es ON es.module_id=s.module_id AND es.account_id=s.account_id AND es.source_key=s.source_key
    WHERE es.id IN (?) AND e.user_id=? ORDER BY e.id`,
        [sourceIds, owner.leaderId],
      )
    : [];
  const recipientUser = { ...ctx.actor, sub: owner.leaderId, role: ctx.recipient.role } as AuthUser;
  const funds = await balance(c, recipientUser, owner),
    quota = await dailyQuota(c, recipientUser);
  const views = sources.map((s) => {
    const saved = selected.find((i) => i.record.id === s.source_id)!;
    const ceiling = min(amount(s.confirmed_amount), amount(saved.record.confirmedAmount));
    const reserved = allocations
      .filter((a) => a.source_id === s.source_id && active(withdrawals.find((w) => w.id === a.withdrawal_id)?.status))
      .reduce((n, a) => n + amount(a.amount), 0n);
    const blocked =
      !!s.blocked_reason || !!s.earning_blocked || s.source_version !== s.current_version || Number(s.unconfirmed) > 0;
    const remainder = positive(ceiling - reserved),
      released = positive(min(ceiling, amount(s.released_amount)) - reserved);
    const reason = blocked
      ? '关联收益仍需核对，请处理来源后继续'
      : reserved > ceiling
        ? '已办理金额超过更正后的收益，请先核对已办理款项'
        : '';
    return {
      sourceId: String(s.source_id),
      sourceKey: String(s.source_key),
      businessDate: String(s.business_date),
      taskName: String(s.task_name),
      originalConfirmedAmount: cashText(amount(saved.record.confirmedAmount)),
      currentConfirmedAmount: cashText(amount(s.confirmed_amount)),
      correctionAmount: cashText(amount(s.confirmed_amount) - amount(saved.record.confirmedAmount)),
      confirmedAmount: cashText(ceiling),
      allocatedAmount: cashText(reserved),
      remainingAmount: cashText(remainder),
      availableAmount: cashText(blocked ? 0n : released),
      reason,
      raw: s,
      ceiling,
      blocked,
      reserved,
    };
  });
  const paymentRows = withdrawals.map((w) => {
    const all = allocations.filter((a) => a.withdrawal_id === w.id && amount(a.amount) > 0n);
    let cumulative = 0n,
      allocated = 0n,
      netAllocated = 0n;
    const gross = amount(w.amount),
      net = amount(w.net_amount);
    for (const a of all) {
      const before = cumulative;
      cumulative += amount(a.amount);
      // Cumulative integer allocation makes fees add up exactly across all linked sources.
      if (sourceIds.includes(a.source_id)) {
        allocated += amount(a.amount);
        netAllocated += gross > 0n ? (cumulative * net) / gross - (before * net) / gross : 0n;
      }
    }
    return {
      withdrawalId: String(w.id),
      settlementId: w.origin_settlement_id ? String(w.origin_settlement_id) : null,
      initiatedBy: w.initiated_by ? String(w.initiated_by) : null,
      initiatorName: w.initiator_name ? String(w.initiator_name) : null,
      paidByName: w.paid_by_name ? String(w.paid_by_name) : null,
      recipientId: owner.leaderId,
      recipientName: String(ctx.recipient.display_name),
      amount: cashText(gross),
      feeAmount: cashText(amount(w.fee_amount)),
      netAmount: cashText(net),
      allocatedAmount: cashText(allocated),
      allocatedNetAmount: cashText(netAllocated),
      unallocatedAmount: cashText(positive(gross - cumulative)),
      status: w.status as 'pending' | 'approved' | 'paid' | 'rejected' | 'cancelled',
      allocations: all.map((a) => ({
        sourceId: String(a.source_id),
        sourceKey: String(a.source_key),
        businessDate: String(a.business_date),
        amount: cashText(amount(a.amount)),
        editable: sourceIds.includes(a.source_id),
      })),
      paymentVersion: Number(w.payment_version),
      policyVersion: w.policy_version ? String(w.policy_version) : null,
      createdAt: String(w.created_text),
      invoiceName: w.invoice_name ? String(w.invoice_name) : null,
      invoiceReason: w.invoice_reason ? String(w.invoice_reason) : null,
      invoiceInstructions: w.invoice_instructions ? String(w.invoice_instructions) : null,
      receiverName: w.receiver_name ? String(w.receiver_name) : null,
      payMethod: w.pay_method as 'wechat' | 'alipay' | 'bank',
      payAccount: w.pay_account ? String(w.pay_account) : null,
      reviewDeadline: w.review_deadline ? String(w.review_deadline) : null,
      settlementDeadline: w.settlement_deadline ? String(w.settlement_deadline) : null,
      invoiceRequired: Number(w.invoice_required) === 1,
      invoiceStatus: w.invoice_status ? String(w.invoice_status) : null,
      invoiceVersion: Number(w.invoice_version),
      paidOn: w.paid_day ? String(w.paid_day) : null,
      paymentReference: w.payment_reference ? String(w.payment_reference) : null,
      proofName: w.proof_name ? String(w.proof_name) : null,
      failureReason: w.failure_reason ? String(w.failure_reason) : null,
      next: w.failure_reason
        ? '财务：核对失败原因后继续原办理记录'
        : w.status === 'pending'
          ? '财务：核对收款资料并审核'
          : w.status === 'approved'
            ? Number(w.invoice_required) && w.invoice_status !== 'accepted'
              ? '财务：核验已约定的发票'
              : '财务：实际转账后登记付款'
            : '',
      canCancel: !!w.initiated_by && ['pending', 'approved'].includes(w.status),
      canRetry: !!w.initiated_by && !!w.failure_reason && ['pending', 'approved'].includes(w.status),
    };
  });
  // Zeroed historical links retain a reachable audit/comment context without reserving money.
  const visible = paymentRows.filter(
    (w) =>
      amount(w.allocatedAmount) > 0n ||
      w.settlementId === ctx.doc.id ||
      allocations.some((a) => a.withdrawal_id === w.withdrawalId && sourceIds.includes(a.source_id)),
  );
  const legacy = paymentRows.filter((w) => active(w.status) && amount(w.unallocatedAmount) > 0n);
  const legacyAmount = legacy.reduce((n, w) => n + amount(w.unallocatedAmount), 0n);
  const total = (field: 'confirmedAmount' | 'remainingAmount' | 'availableAmount') =>
    views.reduce((n, s) => n + amount(s[field]), 0n);
  const fundingRows = entries.filter(
    (e) =>
      e.availability === 'held' &&
      views.some(
        (s) =>
          s.raw.income_source_id === e.income_source_id && !s.blocked && amount(s.raw.confirmed_amount) <= s.ceiling,
      ),
  );
  const fundingAmount = positive(fundingRows.reduce((n, e) => n + amount(e.amount), 0n));
  const sourceDeficit = views.reduce((n, s) => n + positive(s.reserved - s.ceiling), 0n);
  // Source deficits and wallet deficits overlap; never add the same shortage twice.
  const offset = amount(funds.offset) > sourceDeficit ? amount(funds.offset) : sourceDeficit;
  const available = legacyAmount || offset ? 0n : min(total('availableAmount'), amount(funds.available));
  const paidGross = visible.filter((w) => w.status === 'paid').reduce((n, w) => n + amount(w.allocatedAmount), 0n);
  const paidNet = visible.filter((w) => w.status === 'paid').reduce((n, w) => n + amount(w.allocatedNetAmount), 0n);
  const processing = visible
    .filter((w) => ['pending', 'approved'].includes(w.status))
    .reduce((n, w) => n + amount(w.allocatedAmount), 0n);
  const blockers: Array<{
    kind: string;
    reason: string;
    next: string;
    action: 'funding' | 'link' | 'review_sources' | 'recipient' | 'none';
  }> = [];
  const eligible =
    !!ctx.recipient.is_active && !ctx.recipient.closed_at && ['leader', 'creator'].includes(ctx.recipient.role);
  if (!eligible)
    blockers.push({
      kind: 'recipient',
      reason: '收款人当前账号状态或角色不能申请付款',
      next: '完整管理员：核对收款人的账号状态',
      action: 'recipient',
    });
  if (legacyAmount)
    blockers.push({
      kind: 'legacy',
      reason: '已有付款或提现尚未对应到收益日期，需先核对以免重复办理',
      next: '财务：选择已有记录并核对对应收益',
      action: 'link',
    });
  if (offset || views.some((s) => s.reason))
    blockers.push({
      kind: 'source',
      reason: '收益发生更正或存在待核对项目',
      next: '财务：核对来源金额和已办理记录',
      action: 'review_sources',
    });
  if (visible.some((w) => w.failureReason && active(w.status)))
    blockers.push({
      kind: 'failure',
      reason: '有付款办理失败，原申请仍保留金额',
      next: '财务：核对失败原因后继续原办理记录',
      action: 'none',
    });
  if (fundingAmount)
    blockers.push({
      kind: 'funding',
      reason: '所选收益还有未开放款项',
      next: '财务：核实款项到账并开放',
      action: 'funding',
    });
  if (!withdrawalPolicyEnabled())
    blockers.push({
      kind: 'policy',
      reason: '当前项目尚未启用付款申请规则',
      next: '完整管理员：核实付款申请设置',
      action: 'none',
    });
  const remaining = total('remainingAmount');
  const status =
    legacyAmount || offset || views.some((s) => s.reason) || visible.some((w) => w.failureReason && active(w.status))
      ? 'needs_review'
      : processing > 0n
        ? paidGross > 0n
          ? 'partially_paid'
          : 'processing'
        : paidGross > 0n
          ? remaining > 0n
            ? 'partially_paid'
            : 'paid'
          : 'not_initiated';
  const version = checksum([
    ctx.doc.id,
    ctx.doc.version,
    sources,
    entries,
    allocations,
    withdrawals.map((w) => [
      w.id,
      w.amount,
      w.status,
      w.payment_version,
      w.failure_reason,
      w.attempt_version,
      w.policy_version,
      w.invoice_status,
      w.invoice_version,
    ]),
    ctx.recipient,
    quota,
    withdrawalRules(ctx.recipient.role),
  ]);
  return {
    ctx,
    sources: views,
    entries,
    allocations,
    withdrawals,
    fundingRows,
    legacy,
    overview: {
      settlementId: ctx.doc.id,
      scope: owner,
      paymentStatus: status,
      version,
      totals: {
        confirmedAmount: cashText(total('confirmedAmount')),
        heldAmount: cashText(sources.reduce((n, s) => n + amount(s.held_amount), 0n)),
        releasedAmount: cashText(sources.reduce((n, s) => n + amount(s.released_amount), 0n)),
        processingAmount: cashText(processing),
        paidGrossAmount: cashText(paidGross),
        paidNetAmount: cashText(paidNet),
        remainingAmount: cashText(remaining),
        availableAmount: cashText(eligible ? (available / 100n) * 100n : 0n),
        legacyUnallocatedAmount: cashText(legacyAmount),
        offsetAmount: cashText(offset),
        residualAmount: cashText(positive(remaining) % 100n),
      },
      payments: visible,
      sources: views.map(({ raw, ceiling, blocked, reserved, ...v }) => v),
      total: visible.length,
      page: 1,
      pageSize: 25,
      funding: { amount: cashText(fundingAmount), version: checksum(fundingRows) },
      policy: { ...withdrawalRules(ctx.recipient.role), ...quota, dailyAmountLimit: quota.dailyAmountLimit },
      blockers,
    },
  };
}
type Model = Awaited<ReturnType<typeof readModel>>;

export async function settlementPayments(
  runtime: ModuleRuntime,
  u: AuthUser,
  owner: PaymentOwner,
  id: string,
  page = 1,
  pageSize = 25,
  withdrawalId?: string,
  paymentView: 'all' | 'processing' | 'paid' = 'all',
) {
  return withTransaction(async (c) => {
    const model = await readModel(c, owner, await context(c, runtime, u, owner, id));
    if (withdrawalId) {
      const index = model.overview.payments.findIndex((w) => w.withdrawalId === withdrawalId);
      if (index < 0) fail('该付款记录不在当前结算范围', 404);
      page = Math.floor(index / pageSize) + 1;
    }
    const displayed =
      withdrawalId || paymentView === 'all'
        ? model.overview.payments
        : model.overview.payments.filter((w) =>
            paymentView === 'paid' ? w.status === 'paid' : ['pending', 'approved'].includes(w.status),
          );
    const { list, ...paging } = pageOf(displayed, page, pageSize);
    return { ...model.overview, ...paging, payments: list };
  });
}
function requireVersion(model: Model, expected: string) {
  if (model.overview.version !== expected) fail('办理金额或状态已变化，请刷新核对后继续');
}
function buildAllocations(model: Model, value: string): PaymentAllocation[] {
  let rest = cash(value);
  const result: PaymentAllocation[] = [];
  for (const s of model.sources) {
    const take = min(rest, amount(s.availableAmount));
    if (take > 0n) {
      result.push({
        sourceId: s.sourceId,
        sourceKey: s.sourceKey,
        businessDate: s.businessDate,
        amount: cashText(take),
      });
      rest -= take;
    }
  }
  if (rest > 0n) fail('所选收益可办理金额不足，请重新核对');
  return result;
}
function quoteFor(model: Model, owner: PaymentOwner, value: string) {
  if (!withdrawalPolicyEnabled()) fail('付款申请规则尚未启用，请稍后重试');
  if (!model.ctx.recipient.is_active || model.ctx.recipient.closed_at) fail('收款人账号不可办理，请核对账号状态');
  if (cash(value) % 100n !== 0n) fail('付款金额最多保留两位小数', 422);
  const terms = calculateWithdrawal(cashText(cash(value)).slice(0, -2), model.ctx.recipient.role);
  checkQuota(value, model.overview.policy);
  if (cash(value) > cash(model.overview.totals.availableAmount)) fail('所选收益可办理金额不足，请先处理提示事项');
  const allocations = buildAllocations(model, value);
  const publicQuote = {
    settlementId: model.ctx.doc.id,
    amount: terms.amount,
    feeAmount: terms.feeAmount,
    netAmount: terms.netAmount,
    policyVersion: terms.policyVersion,
    expectedVersion: model.overview.version,
    reviewDeadline: terms.reviewDeadline,
    settlementDeadline: terms.settlementDeadline,
    invoiceRequired: terms.invoiceRequired,
    allocations,
  };
  return { terms, quote: { ...publicQuote, quoteToken: checksum([owner, publicQuote, terms]) } };
}
export async function settlementPaymentQuote(
  runtime: ModuleRuntime,
  u: AuthUser,
  owner: PaymentOwner,
  id: string,
  value: string,
  expected: string,
) {
  return withTransaction(async (c) => {
    const model = await readModel(c, owner, await context(c, runtime, u, owner, id, true));
    requireVersion(model, expected);
    return quoteFor(model, owner, value).quote;
  });
}
async function saveAllocations(
  c: PoolConnection,
  ctx: Context,
  model: Model,
  withdrawalId: string,
  allocations: PaymentAllocation[],
) {
  for (const a of allocations) {
    const s = model.sources.find((s) => s.sourceId === a.sourceId)!;
    await c.query(
      `INSERT INTO opc_settlement_payment_allocations(withdrawal_id,settlement_id,income_source_id,earning_source_id,user_id,amount,source_version,entry_ids_json,linked_by)
      VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE settlement_id=VALUES(settlement_id),amount=VALUES(amount),source_version=VALUES(source_version),entry_ids_json=VALUES(entry_ids_json),linked_by=VALUES(linked_by),linked_at=NOW(3)`,
      [
        withdrawalId,
        ctx.doc.id,
        s.raw.income_source_id,
        a.sourceId,
        ctx.doc.scope.leaderId,
        a.amount,
        s.raw.source_version,
        JSON.stringify(model.entries.filter((e) => e.income_source_id === s.raw.income_source_id).map((e) => e.id)),
        ctx.actor.sub,
      ],
    );
  }
}
export interface CreatePaymentInput {
  requestKey: string;
  expectedVersion: string;
  amount: string;
  policyVersion: string | null;
  quoteToken: string;
  receiverName: string;
  payMethod: 'wechat' | 'alipay' | 'bank';
  payAccount: string;
}
export async function createSettlementPayment(
  runtime: ModuleRuntime,
  u: AuthUser,
  owner: PaymentOwner,
  id: string,
  input: CreatePaymentInput,
) {
  return withTransaction(async (c) => {
    const ctx = await context(c, runtime, u, owner, id, true);
    return financeReceipt(
      c,
      ctx.actor,
      owner,
      'settlement.payment.create',
      input.requestKey,
      { id, ...input },
      async () => {
        const model = await readModel(c, owner, ctx);
        requireVersion(model, input.expectedVersion);
        const { quote, terms } = quoteFor(model, owner, input.amount);
        if (input.quoteToken !== quote.quoteToken || input.policyVersion !== quote.policyVersion)
          fail('付款规则或日期已变化，请重新核对费用和实付金额');
        const recipient = { ...ctx.actor, sub: owner.leaderId, role: ctx.recipient.role } as AuthUser;
        checkQuota(input.amount, await dailyQuota(c, recipient, terms.appliedDay, true));
        const internalKey = 'settlement.' + checksum([ctx.actor.sub, input.requestKey]);
        const [r] = await c.query<ResultSetHeader>(
          `INSERT INTO opc_withdrawals(module_id,project_id,account_id,user_id,amount,request_key,request_hash,receiver_name,pay_method,pay_account) VALUES(?,?,?,?,?,?,?,?,?,?)`,
          [
            owner.moduleId,
            owner.projectId,
            owner.accountId,
            owner.leaderId,
            terms.amount,
            internalKey,
            checksum(input),
            input.receiverName,
            input.payMethod,
            input.payAccount,
          ],
        );
        const wid = String(r.insertId);
        await c.query(
          `INSERT INTO opc_withdrawal_terms(withdrawal_id,user_id,applied_day,policy_version,applicant_role,fee_amount,net_amount,tier,review_deadline,settlement_deadline,settlement_month,invoice_required,terms_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            wid,
            owner.leaderId,
            terms.appliedDay,
            terms.policyVersion,
            recipient.role,
            terms.feeAmount,
            terms.netAmount,
            terms.tier,
            terms.reviewDeadline,
            terms.settlementDeadline,
            terms.settlementMonth,
            terms.invoiceRequired,
            JSON.stringify(terms),
          ],
        );
        await c.query(
          'INSERT INTO opc_settlement_payment_origins(withdrawal_id,settlement_id,initiated_by) VALUES(?,?,?)',
          [wid, id, ctx.actor.sub],
        );
        await saveAllocations(c, ctx, model, wid, quote.allocations);
        await writeAudit(
          {
            userId: ctx.actor.sub,
            action: 'settlement.payment_create',
            resourceType: 'withdrawal',
            resourceId: wid,
            detail: {
              settlementId: id,
              recipientId: owner.leaderId,
              amount: terms.amount,
              allocations: quote.allocations,
            },
          },
          c,
        );
        return { withdrawalId: wid, settlementId: id };
      },
    );
  });
}
export async function settlementPaymentFunding(
  runtime: ModuleRuntime,
  u: AuthUser,
  owner: PaymentOwner,
  id: string,
  input: { requestKey: string; expectedVersion: string; reference?: string },
) {
  const reference = input.reference?.trim() || '财务已核实所选款项到账';
  return withTransaction(async (c) => {
    const ctx = await context(c, runtime, u, owner, id, true);
    return financeReceipt(
      c,
      ctx.actor,
      owner,
      'settlement.funding',
      input.requestKey,
      { id, ...input, reference },
      async () => {
        const model = await readModel(c, owner, ctx);
        requireVersion(model, input.expectedVersion);
        if (!model.fundingRows.length || cash(model.overview.funding.amount) <= 0n)
          fail('没有可开放的款项，请核对收益来源');
        await c.query(
          "UPDATE opc_income_entries SET availability='available',released_by=?,released_at=NOW(3),release_reference=? WHERE id IN (?) AND availability='held'",
          [ctx.actor.sub, reference, model.fundingRows.map((e) => e.id)],
        );
        await writeAudit(
          {
            userId: ctx.actor.sub,
            action: 'settlement.funding_release',
            resourceType: 'settlement',
            resourceId: id,
            detail: {
              recipientId: owner.leaderId,
              amount: model.overview.funding.amount,
              entryIds: model.fundingRows.map((e) => e.id),
              reference,
            },
          },
          c,
        );
        return { amount: model.overview.funding.amount };
      },
    );
  });
}

export async function settlementPaymentAction(
  runtime: ModuleRuntime,
  u: AuthUser,
  owner: PaymentOwner,
  id: string,
  wid: string,
  input: { requestKey: string; expectedVersion: string; action: 'cancel' | 'failed' | 'retry'; reason: string },
) {
  const reason = input.reason.trim() || (input.action === 'retry' ? '核对后继续原付款办理' : '');
  if (!reason) fail('请填写取消或失败的原因', 422);
  return withTransaction(async (c) => {
    const ctx = await context(c, runtime, u, owner, id, true);
    return financeReceipt(
      c,
      ctx.actor,
      owner,
      'settlement.payment.action',
      input.requestKey,
      { id, wid, ...input },
      async () => {
        const model = await readModel(c, owner, ctx);
        requireVersion(model, input.expectedVersion);
        const w = model.withdrawals.find(
          (w) =>
            w.id === wid && !!w.origin_settlement_id && model.overview.payments.some((row) => row.withdrawalId === wid),
        );
        if (!w) fail('该付款办理不属于当前结算记录', 404);
        if (!['pending', 'approved'].includes(w.status)) fail('仅能处理尚未付款的办理记录，请刷新核对');
        if (input.action === 'retry') {
          if (!w.failure_reason) fail('这笔付款没有待恢复的失败记录');
          if (model.sources.some((s) => s.reason) || amount(model.overview.totals.offsetAmount) > 0n)
            fail('收益或付款金额有变化，请先核对后继续办理');
          await assertSettlementPaymentSafe(c, wid, true);
        }
        const after = {
          status: input.action === 'cancel' ? 'cancelled' : w.status,
          failureReason: input.action === 'failed' ? reason : null,
        };
        if (input.action === 'cancel')
          await c.query(
            "UPDATE opc_withdrawals SET status='cancelled',remark=?,reviewed_by=?,reviewed_at=NOW(3),payment_version=payment_version+1 WHERE id=?",
            [reason, ctx.actor.sub, wid],
          );
        await c.query(
          'UPDATE opc_settlement_payment_origins SET failure_reason=?,attempt_version=attempt_version+1 WHERE withdrawal_id=?',
          [after.failureReason, wid],
        );
        await c.query(
          'INSERT INTO opc_settlement_payment_events(withdrawal_id,settlement_id,actor_id,event_type,reason,before_json,after_json) VALUES(?,?,?,?,?,?,?)',
          [
            wid,
            w.origin_settlement_id,
            ctx.actor.sub,
            input.action,
            reason,
            JSON.stringify({
              status: w.status,
              failureReason: w.failure_reason,
              originSettlementId: w.origin_settlement_id,
            }),
            JSON.stringify({ ...after, openedFromSettlementId: id }),
          ],
        );
        await writeAudit(
          {
            userId: ctx.actor.sub,
            action: 'settlement.payment_' + input.action,
            resourceType: 'withdrawal',
            resourceId: wid,
            detail: { settlementId: w.origin_settlement_id, openedFromSettlementId: id, reason },
          },
          c,
        );
        return { withdrawalId: wid };
      },
    );
  });
}

export async function legacySettlementPayments(
  runtime: ModuleRuntime,
  u: AuthUser,
  owner: PaymentOwner,
  id: string,
  page = 1,
  pageSize = 25,
) {
  return withTransaction(async (c) => {
    const model = await readModel(c, owner, await context(c, runtime, u, owner, id));
    return { ...pageOf(model.legacy, page, pageSize), version: model.overview.version };
  });
}
export interface PaymentLinkInput {
  withdrawalId: string;
  allocations: Array<{ sourceId: string; amount: string }>;
}
function linkPreview(model: Model, input: PaymentLinkInput) {
  const w = model.withdrawals.find((w) => w.id === input.withdrawalId);
  if (!w || !active(w.status)) fail('请选择当前收款人已受理或已付款的记录', 404);
  if (w.origin_settlement_id) fail('财务主动办理已有对应收益，不能重新指定历史归属');
  if (new Set(input.allocations.map((a) => a.sourceId)).size !== input.allocations.length)
    fail('同一收益记录不能重复选择', 422);
  const proposed = input.allocations.map((a) => {
    const s = model.sources.find((s) => s.sourceId === a.sourceId);
    if (!s) fail('所选收益不在这份已确认结算中', 403);
    const value = cash(a.amount);
    if (value < 0n) fail('对应金额不能为负数', 422);
    const old = model.allocations.find((x) => x.withdrawal_id === input.withdrawalId && x.source_id === a.sourceId);
    if (
      value > 0n &&
      (s.blocked || value > positive(min(s.ceiling, amount(s.raw.released_amount)) - s.reserved + amount(old?.amount)))
    )
      fail('对应金额超过该项收益已开放的剩余可核对金额');
    return { sourceId: s.sourceId, sourceKey: s.sourceKey, businessDate: s.businessDate, amount: cashText(value) };
  });
  const replaceIds = new Set(proposed.map((a) => a.sourceId));
  const others = model.allocations
    .filter((a) => a.withdrawal_id === input.withdrawalId && !replaceIds.has(a.source_id))
    .reduce((n, a) => n + amount(a.amount), 0n);
  const total = proposed.reduce((n, a) => n + cash(a.amount), 0n);
  if (total + others > amount(w.amount)) fail('对应金额合计超过原付款申请总额');
  if (proposed.length === 0) fail('请选择要核对的收益记录', 422);
  return {
    version: checksum([model.overview.version, input]),
    withdrawalId: input.withdrawalId,
    allocations: proposed,
    totalAmount: cashText(total),
    warnings: ['请依据原付款记录核实收益日期。此操作只记录对应关系，不新增付款，也不改变原费用和期限。'],
  };
}
export async function previewSettlementPaymentLink(
  runtime: ModuleRuntime,
  u: AuthUser,
  owner: PaymentOwner,
  id: string,
  input: PaymentLinkInput,
) {
  return withTransaction(async (c) =>
    linkPreview(await readModel(c, owner, await context(c, runtime, u, owner, id, true)), input),
  );
}
export async function linkSettlementPayment(
  runtime: ModuleRuntime,
  u: AuthUser,
  owner: PaymentOwner,
  id: string,
  input: PaymentLinkInput & { expectedVersion: string; requestKey: string },
) {
  return withTransaction(async (c) => {
    const ctx = await context(c, runtime, u, owner, id, true);
    return financeReceipt(
      c,
      ctx.actor,
      owner,
      'settlement.payment.link',
      input.requestKey,
      { id, ...input },
      async () => {
        const model = await readModel(c, owner, ctx),
          preview = linkPreview(model, { withdrawalId: input.withdrawalId, allocations: input.allocations });
        if (preview.version !== input.expectedVersion) fail('付款或收益记录已变化，请重新核对对应关系');
        const before = model.allocations.filter((a) => a.withdrawal_id === input.withdrawalId);
        await saveAllocations(c, ctx, model, input.withdrawalId, preview.allocations);
        await c.query(
          'INSERT INTO opc_settlement_payment_events(withdrawal_id,settlement_id,actor_id,event_type,reason,before_json,after_json) VALUES(?,?,?,?,?,?,?)',
          [
            input.withdrawalId,
            id,
            ctx.actor.sub,
            'link',
            '财务核实原付款与收益对应关系',
            JSON.stringify(before),
            JSON.stringify(preview.allocations),
          ],
        );
        await writeAudit(
          {
            userId: ctx.actor.sub,
            action: 'settlement.payment_link',
            resourceType: 'withdrawal',
            resourceId: input.withdrawalId,
            detail: { settlementId: id, before, after: preview.allocations },
          },
          c,
        );
        return { withdrawalId: input.withdrawalId };
      },
    );
  });
}

export async function settlementPaymentComments(
  runtime: ModuleRuntime,
  u: AuthUser,
  owner: PaymentOwner,
  id: string,
  wid: string,
  input: { body?: string; requestKey?: string; page?: number; pageSize?: number },
) {
  return withTransaction(async (c) => {
    const ctx = await context(c, runtime, u, owner, id, input.body !== undefined);
    const model = await readModel(c, owner, ctx);
    if (!model.overview.payments.some((w) => w.withdrawalId === wid)) fail('该付款记录不在当前结算范围', 404);
    const where =
        "cm.module_id=? AND cm.project_id=? AND cm.account_id=? AND cm.leader_id=? AND cm.context_kind='withdrawal' AND cm.context_id=?",
      args = [...ownerArgs(owner), wid];
    const columns =
      "CAST(cm.id AS CHAR) id,CAST(cm.author_id AS CHAR) author_id,u.display_name,cm.body,DATE_FORMAT(cm.created_at,'%Y-%m-%d %H:%i:%s') created_at";
    if (input.body !== undefined)
      return financeReceipt(
        c,
        ctx.actor,
        owner,
        'settlement.payment.comment',
        input.requestKey,
        { wid, body: input.body },
        async () => {
          const [r] = await c.query<ResultSetHeader>(
            "INSERT INTO opc_record_comments(module_id,project_id,account_id,leader_id,context_kind,context_id,author_id,body) VALUES(?,?,?,?,'withdrawal',?,?,?)",
            [...args, ctx.actor.sub, input.body],
          );
          return commentView(
            (
              await q(
                c,
                `SELECT ${columns} FROM opc_record_comments cm JOIN users u ON u.id=cm.author_id WHERE cm.id=?`,
                [r.insertId],
              )
            )[0],
          );
        },
      );
    const page = input.page ?? 1,
      pageSize = input.pageSize ?? 25;
    const [count] = await q(c, `SELECT COUNT(*) total FROM opc_record_comments cm WHERE ${where}`, args);
    const rows = await q(
      c,
      `SELECT ${columns} FROM opc_record_comments cm JOIN users u ON u.id=cm.author_id WHERE ${where} ORDER BY cm.id LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize],
    );
    return { list: rows.map(commentView), total: Number(count.total), page, pageSize };
  });
}

export async function settlementPaymentExport(runtime: ModuleRuntime, u: AuthUser, owner: PaymentOwner, id: string) {
  return withTransaction(async (c) => {
    const ctx = await context(c, runtime, u, owner, id),
      model = await readModel(c, owner, ctx);
    const lines: unknown[][] = [
      ['结算对象', ctx.doc.recipient.name, '开始日期', ctx.doc.scope.from, '结束日期', ctx.doc.scope.to],
      ['业绩日期', '任务', '收益类别', '业绩类型', '核对状态', '确认金额', '已关联办理金额', '待办理金额', '原因'],
    ];
    for (const item of ctx.doc.items) {
      const s = model.overview.sources.find((s) => s.sourceId === item.record.id);
      lines.push([
        item.record.businessDate,
        item.record.taskName,
        item.record.group === 'self' ? '本人收益' : '团队分成',
        item.record.metricLabel,
        item.status === 'confirmed' ? '已确认' : item.status === 'blocked' ? '待处理' : '待确认',
        s?.confirmedAmount ?? item.record.confirmedAmount,
        s?.allocatedAmount ?? '0.0000',
        s?.remainingAmount ?? '',
        s?.reason || item.reason,
      ]);
    }
    lines.push(
      [],
      [
        '付款办理',
        '状态',
        '申请金额',
        '费用',
        '实付金额',
        '本期关联金额',
        '本期实付金额',
        '付款日期',
        '付款流水',
        '经办人',
        '待处理原因',
        '预计实付金额',
        '本期预计实付金额',
      ],
    );
    const names: Record<string, string> = {
      pending: '待审核',
      approved: '待付款',
      paid: '已付款',
      rejected: '已退回',
      cancelled: '已取消',
    };
    for (const w of model.overview.payments)
      lines.push([
        w.withdrawalId,
        names[w.status],
        w.amount,
        w.feeAmount,
        w.status === 'paid' ? w.netAmount : '0.0000',
        w.allocatedAmount,
        w.status === 'paid' ? w.allocatedNetAmount : '0.0000',
        w.paidOn,
        w.paymentReference,
        w.initiatorName,
        w.failureReason || w.next,
        ['pending', 'approved'].includes(w.status) ? w.netAmount : '0.0000',
        ['pending', 'approved'].includes(w.status) ? w.allocatedNetAmount : '0.0000',
      ]);
    lines.push([], ['尚未明确对应收益的已有款项', '状态', '申请金额', '尚未对应金额', '付款日期']);
    for (const w of model.legacy)
      lines.push([w.withdrawalId, names[w.status], w.amount, w.unallocatedAmount, w.paidOn]);
    const escape = (v: unknown) => {
      let s = String(v ?? '');
      if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    return '\ufeff' + lines.map((row) => row.map(escape).join(',')).join('\r\n');
  });
}
