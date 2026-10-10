import type { PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { AuthUser } from '../types';
import { AppError } from '../middleware/errors';
import { cash, cashText } from './money';
import { lockFinance, syncIncome, type FinanceScope } from './finance';

const query = async (c: PoolConnection, sql: string, args: unknown[] = []) =>
  (await c.query<RowDataPacket[]>(sql, args))[0];
const conflict = (): never => {
  throw new AppError(409, 40900, '收益记录已更新，请刷新后核对');
};
/** Remove an unconfirmed projection; a module may never erase confirmed income. */
export async function removeUnconfirmedEarningSource(c:PoolConnection,s:FinanceScope,sourceKey:string){
  await lockFinance(c,s);
  const income=await query(c,'SELECT id FROM opc_income_sources WHERE module_id=? AND project_id=? AND account_id=? AND source_key=?',[s.moduleId,s.projectId,s.accountId,sourceKey]);
  const [source]=await query(c,'SELECT id FROM opc_earning_sources WHERE module_id=? AND project_id=? AND account_id=? AND source_key=? FOR UPDATE',[s.moduleId,s.projectId,s.accountId,sourceKey]);
  if(income.length)conflict();
  if(!source)return;
  if((await query(c,'SELECT id FROM opc_earning_lines WHERE source_id=? AND confirmed_at IS NOT NULL LIMIT 1',[source.id])).length)conflict();
  await c.query('DELETE FROM opc_earning_lines WHERE source_id=?',[source.id]);
  await c.query('DELETE FROM opc_earning_sources WHERE id=?',[source.id]);
}
export interface EarningLineInput {
  payeeId: string;
  performerId: string | null;
  performerName: string;
  ruleCode: string;
  quantity: string | null;
  unitPrice: string | null;
  amount: string | null;
  internal: boolean;
  ready: boolean;
  reason: string;
  next: string;
}
export interface EarningSourceInput {
  sourceKey: string;
  version: string;
  date: string;
  taskId: string;
  taskName: string;
  metricType: string;
  metricLabel: string;
  unit: string;
  lines: EarningLineInput[];
}
/** Called by a module inside its business transaction. Confirmed rows are never rewritten. */
export async function writeEarningLines(c: PoolConnection, s: FinanceScope, input: EarningSourceInput) {
  await lockFinance(c, s);
  if (new Set(input.lines.map((l) => l.payeeId)).size !== input.lines.length) conflict();
  for (const line of input.lines) {
    if (line.quantity !== null && !/^\d{1,20}$/.test(line.quantity)) throw new AppError(422, 42200, '业绩数量不正确');
    if (line.amount !== null) cash(line.amount);
    if (line.unitPrice !== null) cash(line.unitPrice);
  }
  let [source] = await query(
    c,
    'SELECT * FROM opc_earning_sources WHERE module_id=? AND account_id=? AND source_key=? FOR UPDATE',
    [s.moduleId, s.accountId, input.sourceKey],
  );
  if (source && String(source.project_id) !== s.projectId) conflict();
  if (!source) {
    const [result] = await c.query<ResultSetHeader>(
      `INSERT INTO opc_earning_sources(module_id,project_id,account_id,source_key,current_version,business_date,task_id,task_name,metric_type,metric_label,quantity_unit) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [
        s.moduleId,
        s.projectId,
        s.accountId,
        input.sourceKey,
        input.version,
        input.date,
        input.taskId,
        input.taskName,
        input.metricType,
        input.metricLabel,
        input.unit,
      ],
    );
    source = { id: String(result.insertId) } as RowDataPacket;
  }
  const [income] = await query(
    c,
    'SELECT id,source_version FROM opc_income_sources WHERE module_id=? AND project_id=? AND account_id=? AND source_key=?',
    [s.moduleId, s.projectId, s.accountId, input.sourceKey],
  );
  const balances = income
    ? await query(
        c,
        'SELECT CAST(user_id AS CHAR) user_id,CAST(SUM(amount) AS CHAR) amount,MAX(confirmed_at) confirmed_at FROM opc_income_entries WHERE source_id=? GROUP BY user_id',
        [income.id],
      )
    : [];
  const existing = await query(c, 'SELECT * FROM opc_earning_lines WHERE source_id=? AND source_version=?', [
    source.id,
    input.version,
  ]);
  for (const row of existing.filter((row) => row.confirmed_at)) {
    const line = input.lines.find((line) => line.payeeId === String(row.payee_id));
    if (!line || line.internal || line.amount === null || cash(line.amount) !== cash(String(row.amount))) conflict();
  }
  await c.query(
    'DELETE FROM opc_earning_lines WHERE source_id=? AND confirmed_at IS NULL AND (source_version<>? OR payee_id NOT IN (?))',
    [source.id, input.version, input.lines.length ? input.lines.map((l) => l.payeeId) : ['0']],
  );
  for (const line of input.lines) {
    if (existing.some((row) => row.confirmed_at && String(row.payee_id) === line.payeeId)) continue;
    const before = balances.find((row) => row.user_id === line.payeeId)?.amount ?? '0';
    const confirmed =
      !line.internal &&
      income?.source_version === input.version &&
      line.amount !== null &&
      cash(line.amount) === cash(String(before), true);
    await c.query(
      `INSERT INTO opc_earning_lines(source_id,source_version,payee_id,performer_id,performer_name,rule_code,quantity,unit_price,amount,is_internal,is_ready,blocked_reason,next_action,confirmed_at,delta_amount) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE performer_id=VALUES(performer_id),performer_name=VALUES(performer_name),rule_code=VALUES(rule_code),quantity=VALUES(quantity),unit_price=VALUES(unit_price),amount=VALUES(amount),is_internal=VALUES(is_internal),is_ready=VALUES(is_ready),blocked_reason=VALUES(blocked_reason),next_action=VALUES(next_action),confirmed_at=VALUES(confirmed_at),delta_amount=VALUES(delta_amount)`,
      [
        source.id,
        input.version,
        line.payeeId,
        line.performerId,
        line.performerName,
        line.ruleCode,
        line.quantity,
        line.unitPrice,
        line.amount,
        Number(line.internal),
        Number(line.ready),
        line.reason,
        line.next,
        confirmed ? balances.find((row) => row.user_id === line.payeeId)?.confirmed_at : null,
        confirmed ? '0.0000' : null,
      ],
    );
  }
  await c.query('UPDATE opc_earning_sources SET current_version=?,blocked_reason=NULL,next_action=NULL WHERE id=?', [
    input.version,
    source.id,
  ]);
}

/** Confirm from the platform projection, then synchronize the shared cash ledger atomically. */
export async function confirmEarningSource(
  c: PoolConnection,
  u: AuthUser,
  s: FinanceScope,
  sourceKey: string,
  version: string,
) {
  await lockFinance(c, s);
  const [source] = await query(
    c,
    "SELECT *,DATE_FORMAT(business_date,'%Y-%m-%d') day FROM opc_earning_sources WHERE module_id=? AND project_id=? AND account_id=? AND source_key=? FOR UPDATE",
    [s.moduleId, s.projectId, s.accountId, sourceKey],
  );
  if (!source || source.current_version !== version || source.blocked_reason) conflict();
  const lines = await query(
    c,
    'SELECT *,CAST(amount AS CHAR) target FROM opc_earning_lines WHERE source_id=? AND source_version=? ORDER BY payee_id FOR UPDATE',
    [source.id, version],
  );
  if (!lines.length || lines.some((l) => l.is_internal || !l.is_ready || l.amount === null)) conflict();
  const prior = await query(
    c,
    `SELECT CAST(e.user_id AS CHAR) user_id,CAST(SUM(e.amount) AS CHAR) amount FROM opc_income_entries e JOIN opc_income_sources s ON s.id=e.source_id WHERE s.module_id=? AND s.project_id=? AND s.account_id=? AND s.source_key=? GROUP BY e.user_id`,
    [s.moduleId, s.projectId, s.accountId, sourceKey],
  );
  const allocations = lines.map((l) => ({ userId: String(l.payee_id), amount: String(l.target) }));
  await syncIncome(c, u, s, {
    sourceKey,
    version,
    date: String(source.day),
    description: String(source.task_name),
    allocations,
    total: cashText(allocations.reduce((sum, l) => sum + cash(l.amount), 0n)),
  });
  for (const line of lines)
    if (!line.confirmed_at) {
      const before = String(prior.find((r) => r.user_id === String(line.payee_id))?.amount ?? '0');
      await c.query(
        'UPDATE opc_earning_lines SET confirmed_at=NOW(3),confirmed_by=?,delta_amount=? WHERE id=? AND confirmed_at IS NULL',
        [u.sub, cashText(cash(String(line.target)) - cash(before, true)), line.id],
      );
    }
}
