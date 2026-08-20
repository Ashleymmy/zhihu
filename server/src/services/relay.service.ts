import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { rows, withTransaction } from '../db';
import { AppError } from '../middleware/errors';
import { AuthUser } from '../types';
import { writeAudit } from './audit.service';

/* ===== 类型 ===== */

export interface PricingRuleInput {
  targetUserId?: string | null;
  targetRole: 'leader' | 'creator';
  method: 'fixed' | 'percentage';
  unitPrice?: string | null;
  percentage?: string | null;
  priority?: number;
}

interface RuleRow extends RowDataPacket {
  id: string;
  target_user_id: string | null;
  target_role: 'leader' | 'creator';
  method: 'fixed' | 'percentage';
  unit_price: string | null;
  percentage: string | null;
  status: string;
  priority: number;
}

interface ItemRow extends RowDataPacket {
  id: string;
  creator_id: string;
  source_amount: string;
  note: string | null;
}

interface BatchRow extends RowDataPacket {
  id: string;
  title: string;
  status: string;
  period_start: string;
  period_end: string;
}

/* ===== 精确十进制：金额 4 位小数、比例 6 位小数，全程 BigInt，严禁浮点 ===== */

/** 元（最多 4 位小数字符串）→ 1e4 微单位 BigInt */
function toMicro(value: string): bigint {
  const [intPart, frac = ''] = value.split('.');
  return BigInt(intPart) * 10000n + BigInt((frac + '0000').slice(0, 4));
}

/** 1e4 微单位 → 4 位小数字符串 */
function fromMicro(micro: bigint): string {
  const intPart = micro / 10000n;
  const frac = (micro % 10000n).toString().padStart(4, '0');
  return `${intPart}.${frac}`;
}

/** 比例字符串（最多 6 位小数）→ 1e6 缩放 BigInt；兼容 "0.6" / "0.600000" / 数值型 toString */
function toPct6(value: string): bigint {
  const [intPart, frac = ''] = value.split('.');
  return BigInt(intPart) * 1000000n + BigInt((frac + '000000').slice(0, 6));
}

/** source × percentage（6dp），四舍五入到 4dp */
function multiplyByPercentage(sourceMicro: bigint, percentage: string): bigint {
  const pct = toPct6(percentage);
  // sourceMicro(1e4) × pct(1e6) → 1e10；换算回 1e4 需除以 1e6，+500000 实现四舍五入
  return (sourceMicro * pct + 500000n) / 1000000n;
}

/* ===== 定价规则 ===== */

export async function listRules() {
  return rows(
    `SELECT r.id, r.target_user_id, r.target_role, r.method, r.unit_price, r.percentage, r.status, r.priority, r.effective_from, r.created_at,
            u.username AS target_username, u.display_name AS target_name
     FROM pricing_rules r LEFT JOIN users u ON u.id = r.target_user_id
     ORDER BY r.status = 'active' DESC, r.priority DESC, r.id DESC`,
  );
}

export async function createRule(user: AuthUser, input: PricingRuleInput, ip?: string) {
  const id = await withTransaction(async (connection) => {
    const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO pricing_rules (target_user_id, target_role, method, unit_price, percentage, priority, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [input.targetUserId ?? null, input.targetRole, input.method, input.unitPrice ?? null, input.percentage ?? null, input.priority ?? 0, user.sub],
    );
    await writeAudit(
      { userId: user.sub, action: 'finance.rule_create', resourceType: 'pricing_rule', resourceId: String(result.insertId), detail: input, ip },
      connection,
    );
    return String(result.insertId);
  });
  return { id };
}

export async function disableRule(user: AuthUser, id: string, ip?: string) {
  await withTransaction(async (connection) => {
    const [result] = await connection.query<ResultSetHeader>(
      "UPDATE pricing_rules SET status = 'disabled' WHERE id = ? AND status = 'active'",
      [id],
    );
    if (result.affectedRows === 0) throw new AppError(404, 40401, '规则不存在或已停用');
    await writeAudit(
      { userId: user.sub, action: 'finance.rule_disable', resourceType: 'pricing_rule', resourceId: id, ip },
      connection,
    );
  });
}

/** 命中规则：指定账号规则优先，其后按 priority 降序、最新优先 */
async function matchRule(role: 'leader' | 'creator', userId: string): Promise<RuleRow | null> {
  const [rule] = await rows<RuleRow>(
    `SELECT * FROM pricing_rules
     WHERE status = 'active' AND target_role = ? AND (target_user_id = ? OR target_user_id IS NULL) AND effective_from <= NOW()
     ORDER BY (target_user_id IS NOT NULL) DESC, priority DESC, id DESC
     LIMIT 1`,
    [role, userId],
  );
  return rule ?? null;
}

function applyRule(sourceMicro: bigint, rule: RuleRow | null): { amount: bigint; method: string } {
  if (!rule) return { amount: sourceMicro, method: 'passthrough' };
  if (rule.method === 'fixed') return { amount: toMicro(String(rule.unit_price)), method: 'fixed' };
  return { amount: multiplyByPercentage(sourceMicro, String(rule.percentage)), method: 'percentage' };
}

/* ===== 结算批次 ===== */

export async function listBatches() {
  return rows('SELECT * FROM settlement_batches ORDER BY created_at DESC');
}

export async function getBatch(id: string) {
  const [batch] = await rows<BatchRow>('SELECT * FROM settlement_batches WHERE id = ? LIMIT 1', [id]);
  if (!batch) throw new AppError(404, 40401, '批次不存在');
  const items = await rows(
    `SELECT i.*, u.username AS creator_username, u.display_name AS creator_name
     FROM settlement_items i JOIN users u ON u.id = i.creator_id WHERE i.batch_id = ? ORDER BY i.id`,
    [id],
  );
  const logs = await rows(
    `SELECT l.*, u.username AS receiver_username, u.display_name AS receiver_name
     FROM relay_logs l JOIN users u ON u.id = l.user_id WHERE l.batch_id = ? ORDER BY l.item_id, l.role`,
    [id],
  );
  return { ...batch, items, logs };
}

export async function createBatch(
  user: AuthUser,
  input: { title: string; periodStart: string; periodEnd: string; items: Array<{ creatorId: string; sourceAmount: string; note?: string | null }> },
  ip?: string,
) {
  return withTransaction(async (connection) => {
    const [result] = await connection.query<ResultSetHeader>(
      'INSERT INTO settlement_batches (title, period_start, period_end, created_by) VALUES (?, ?, ?, ?)',
      [input.title, input.periodStart, input.periodEnd, user.sub],
    );
    const batchId = String(result.insertId);
    let total = 0n;
    for (const item of input.items) {
      await connection.query(
        'INSERT INTO settlement_items (batch_id, creator_id, source_amount, note) VALUES (?, ?, ?, ?)',
        [batchId, item.creatorId, item.sourceAmount, item.note ?? null],
      );
      total += toMicro(item.sourceAmount);
    }
    await connection.query('UPDATE settlement_batches SET total_source = ? WHERE id = ?', [fromMicro(total), batchId]);
    await writeAudit(
      { userId: user.sub, action: 'finance.batch_create', resourceType: 'settlement_batch', resourceId: batchId, detail: { title: input.title, items: input.items.length }, ip },
      connection,
    );
    return { id: batchId };
  });
}

/** 审批批次 = 执行中继计算：按定价规则把达人来源金额转换为达人/团长收益，写入 earnings(confirmed)。一次性、幂等。 */
export async function approveBatch(user: AuthUser, id: string, ip?: string) {
  await withTransaction(async (connection) => {
    const [batchRows] = await connection.query<BatchRow[]>(
      'SELECT * FROM settlement_batches WHERE id = ? FOR UPDATE',
      [id],
    );
    const batch = batchRows[0];
    if (!batch) throw new AppError(404, 40401, '批次不存在');
    if (batch.status !== 'draft') throw new AppError(422, 42214, '只有草稿状态的批次可以审批');

    const [items] = await connection.query<ItemRow[]>(
      `SELECT i.*, u.parent_id, u.role AS creator_role
       FROM settlement_items i JOIN users u ON u.id = i.creator_id WHERE i.batch_id = ?`,
      [id],
    );
    if (!items.length) throw new AppError(422, 42215, '批次没有任何明细行');

    // earnings.project_id 必填：取知乎项目
    const [projectRows] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM projects WHERE slug = 'zhihu' LIMIT 1",
    );
    const projectId = projectRows[0]?.id;
    if (!projectId) throw new AppError(500, 50000, '缺少 zhihu 项目，无法入账');

    let totalRelay = 0n;
    for (const item of items as Array<ItemRow & { parent_id: string | null }>) {
      const sourceMicro = toMicro(String(item.source_amount));

      // 达人收益
      const creatorRule = await matchRule('creator', String(item.creator_id));
      const creatorResult = applyRule(sourceMicro, creatorRule);
      await writeEarning(connection, {
        batchId: id, itemId: String(item.id), receiverId: String(item.creator_id), role: 'creator',
        rule: creatorRule, method: creatorResult.method, amountMicro: creatorResult.amount, sourceMicro,
        projectId: String(projectId), settleDate: batch.period_end,
      });
      totalRelay += creatorResult.amount;

      // 团长收益：按达人归属（parent_id 指向团长）
      if (item.parent_id) {
        const leaderRule = await matchRule('leader', String(item.parent_id));
        if (leaderRule) {
          const leaderResult = applyRule(sourceMicro, leaderRule);
          if (leaderResult.amount > 0n) {
            await writeEarning(connection, {
              batchId: id, itemId: String(item.id), receiverId: String(item.parent_id), role: 'leader',
              rule: leaderRule, method: leaderResult.method, amountMicro: leaderResult.amount, sourceMicro,
              projectId: String(projectId), settleDate: batch.period_end,
            });
            totalRelay += leaderResult.amount;
          }
        }
      }
    }

    await connection.query(
      "UPDATE settlement_batches SET status = 'approved', approved_by = ?, approved_at = NOW(), total_relay = ? WHERE id = ?",
      [user.sub, fromMicro(totalRelay), id],
    );
    await writeAudit(
      { userId: user.sub, action: 'finance.batch_approve', resourceType: 'settlement_batch', resourceId: id, detail: { totalRelay: fromMicro(totalRelay) }, ip },
      connection,
    );
  });
}

interface EarningWriteInput {
  batchId: string;
  itemId: string;
  receiverId: string;
  role: 'leader' | 'creator';
  rule: RuleRow | null;
  method: string;
  amountMicro: bigint;
  sourceMicro: bigint;
  projectId: string;
  settleDate: string;
}

async function writeEarning(connection: PoolConnection, input: EarningWriteInput) {
  // earnings.amount 单位是分（与提现校验链路口径一致）；relay_logs 记录元（4dp）供对账展示
  const amountFen = fromMicro(input.amountMicro * 100n);
  const amountYuan = fromMicro(input.amountMicro);
  const [earning] = await connection.query<ResultSetHeader>(
    `INSERT INTO earnings (user_id, project_id, plan_id, settle_date, amount, status, source_ref)
     VALUES (?, ?, NULL, ?, ?, 'confirmed', ?)`,
    [input.receiverId, input.projectId, input.settleDate, amountFen, `batch:${input.batchId}:item:${input.itemId}`],
  );
  await connection.query(
    `INSERT INTO relay_logs (batch_id, item_id, earning_id, user_id, role, rule_id, method, unit_price, percentage, source_amount, relay_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.batchId, input.itemId, String(earning.insertId), input.receiverId, input.role,
      input.rule ? String(input.rule.id) : null, input.method,
      input.rule?.unit_price ?? null, input.rule?.percentage ?? null,
      fromMicro(input.sourceMicro), amountYuan,
    ],
  );
}

export async function cancelBatch(user: AuthUser, id: string, ip?: string) {
  await withTransaction(async (connection) => {
    const [result] = await connection.query<ResultSetHeader>(
      "UPDATE settlement_batches SET status = 'cancelled' WHERE id = ? AND status = 'draft'",
      [id],
    );
    if (result.affectedRows === 0) throw new AppError(422, 42214, '只有草稿状态的批次可以撤销');
    await writeAudit(
      { userId: user.sub, action: 'finance.batch_cancel', resourceType: 'settlement_batch', resourceId: id, ip },
      connection,
    );
  });
}
