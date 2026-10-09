import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { AppError } from '../middleware/errors';
import { cash, cashText } from './money';

export interface RateScope {
  projectId: string;
  moduleId: string;
  metricType: string;
  ruleCode: string;
  date: string;
}

export async function rateRuleFor(c: PoolConnection, s: RateScope): Promise<{ id: string; unitPrice: string } | null> {
  const [rows] = await c.query<RowDataPacket[]>(
    `SELECT CAST(id AS CHAR) id,CAST(unit_price AS CHAR) unit_price FROM opc_rate_rules
     WHERE project_id=? AND module_id=? AND metric_type=? AND rule_code=? AND status='published'
       AND effective_from<=? AND (effective_to IS NULL OR effective_to>?) LIMIT 2`,
    [s.projectId,s.moduleId,s.metricType,s.ruleCode,s.date,s.date],
  );
  if (rows.length > 1) throw new AppError(409,40900,'RATE_OVERLAP');
  return rows.length ? {id:String(rows[0].id),unitPrice:String(rows[0].unit_price)} : null;
}

export async function rateFor(c: PoolConnection, s: RateScope): Promise<string | null> {
  return (await rateRuleFor(c,s))?.unitPrice ?? null;
}

/** Calculate a published per-unit rule using exact platform money arithmetic. */
export async function quoteRate(c: PoolConnection,s: RateScope,quantity:string){
  if(!/^\d{1,16}$/.test(quantity))throw new AppError(422,42200,'数量必须是非负整数');
  const rule=await rateRuleFor(c,s);
  return rule?{...rule,quantity,amount:cashText(BigInt(quantity)*cash(rule.unitPrice))}:null;
}
