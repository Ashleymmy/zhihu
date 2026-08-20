import { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import * as XLSX from 'xlsx';
import { rows, withTransaction } from '../db';
import { AppError } from '../middleware/errors';
import { AuthUser } from '../types';
import { writeAudit } from './audit.service';
import { validateAllianceXlsx, AllianceXlsxValidationError, type AllianceUploadFile } from '../zhihu/allianceXlsx';

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
      `SELECT i.*, u.parent_id, p.role AS parent_role
       FROM settlement_items i
       JOIN users u ON u.id = i.creator_id
       LEFT JOIN users p ON p.id = u.parent_id
       WHERE i.batch_id = ?`,
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

      // 团长收益：仅当归属上级确实是团长角色时计提（parent 是 admin 等不走团长规则）
      const parentRole = (item as ItemRow & { parent_role?: string | null }).parent_role;
      if (item.parent_id && parentRole === 'leader') {
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

/* ===== XLSX 结算批次导入适配器（D-001 来源入口，可替换为官方结算 API）===== */

const USERNAME_HEADERS = ['达人用户名', '用户名', '达人', '账号', 'username'];
const AMOUNT_HEADERS = ['来源金额', '结算金额', '金额', '收益金额', 'amount'];
const NOTE_HEADERS = ['备注', '说明', 'note'];

function findColumn(headers: string[], candidates: string[]): number {
  const normalized = headers.map((h) => h.trim().toLowerCase());
  for (const c of candidates) {
    const idx = normalized.indexOf(c.toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseAmountCell(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/[¥￥,\s]/g, '');
  if (!/^\d+(\.\d{1,4})?$/.test(text)) return null;
  return text;
}

/** 上传 XLSX 创建草稿批次。模板：表头含「达人用户名 + 来源金额（+可选备注）」，每行一条达人归属金额。 */
export async function importBatch(
  user: AuthUser,
  file: AllianceUploadFile,
  meta: { title: string; periodStart: string; periodEnd: string },
  ip?: string,
) {
  try {
    await validateAllianceXlsx(file);
  } catch (error) {
    if (error instanceof AllianceXlsxValidationError) throw new AppError(422, 42216, '上传文件不符合要求：仅接受合法的 .xlsx 文件');
    throw error;
  }

  const workbook = XLSX.read(file.buffer as Buffer, { type: 'buffer', dense: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new AppError(422, 42217, 'XLSX 中没有任何工作表');
  const rows2d = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null });
  if (!rows2d.length) throw new AppError(422, 42217, 'XLSX 内容为空');

  // 定位表头行（前 5 行内找到用户名列与金额列）
  let headerRow = -1;
  let colUser = -1;
  let colAmount = -1;
  let colNote = -1;
  for (let i = 0; i < Math.min(5, rows2d.length); i++) {
    const cells = (rows2d[i] ?? []).map((c) => (c === null ? '' : String(c)));
    const u = findColumn(cells, USERNAME_HEADERS);
    const a = findColumn(cells, AMOUNT_HEADERS);
    if (u !== -1 && a !== -1) {
      headerRow = i;
      colUser = u;
      colAmount = a;
      colNote = findColumn(cells, NOTE_HEADERS);
      break;
    }
  }
  if (headerRow === -1) {
    throw new AppError(422, 42217, '未找到表头：需要包含「达人用户名」和「来源金额」两列（可选「备注」）');
  }

  const items: Array<{ creatorId: string; sourceAmount: string; note?: string | null }> = [];
  const problems: string[] = [];
  for (let i = headerRow + 1; i < rows2d.length; i++) {
    const rowNum = i + 1; // 1-based，与 Excel 行号一致
    const row = rows2d[i] ?? [];
    const username = String(row[colUser] ?? '').trim();
    const amount = parseAmountCell(row[colAmount]);
    if (!username && amount === null) continue; // 跳过整行空白
    if (!username) { problems.push(`第 ${rowNum} 行：用户名为空`); continue; }
    if (amount === null) { problems.push(`第 ${rowNum} 行：金额「${row[colAmount]}」不是合法数字`); continue; }
    const [creator] = await rows<RowDataPacket & { id: string; is_active: number; role: string }>(
      "SELECT id, is_active, role FROM users WHERE username = ? AND role = 'creator' LIMIT 1",
      [username],
    );
    if (!creator) { problems.push(`第 ${rowNum} 行：达人账号「${username}」不存在`); continue; }
    if (!creator.is_active) { problems.push(`第 ${rowNum} 行：达人账号「${username}」已停用`); continue; }
    const note = colNote !== -1 ? String(row[colNote] ?? '').trim() || null : null;
    items.push({ creatorId: String(creator.id), sourceAmount: amount, note });
  }
  if (problems.length) throw new AppError(422, 42217, `导入校验未通过：${problems.slice(0, 5).join('；')}${problems.length > 5 ? ` 等 ${problems.length} 处` : ''}`);
  if (!items.length) throw new AppError(422, 42217, 'XLSX 中没有可导入的明细行');

  const created = await createBatch(user, { title: meta.title, periodStart: meta.periodStart, periodEnd: meta.periodEnd, items }, ip);
  return { ...created, imported: items.length };
}
