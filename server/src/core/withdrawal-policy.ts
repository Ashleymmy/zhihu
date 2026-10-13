import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { AppError } from '../middleware/errors';
import { cash, cashText, checksum } from './money';

export const WITHDRAWAL_POLICY_VERSION = '2026-10-13-v1';
export const withdrawalPolicyEnabled = () => process.env.OPC_WITHDRAWAL_POLICY_ENABLED === '1';
export const shanghaiDay = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now);
const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d);
const calendarSchema = z
  .object({
    year: z.number().int().min(2026).max(2100),
    source: z.string().min(1),
    holidays: z.array(daySchema),
    workdays: z.array(daySchema),
  })
  .refine(
    (c) =>
      [...c.holidays, ...c.workdays].every((d) => d.startsWith(c.year + '-')) &&
      !c.holidays.some((d) => c.workdays.includes(d)),
  );
export type WorkCalendar = z.infer<typeof calendarSchema>;
const range = (from: string, to: string) => {
  const days: string[] = [];
  for (let day = from; day <= to; day = nextDay(day)) days.push(day);
  return days;
};
export function nextDay(day: string) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
// 国办发明电〔2025〕7号。Future years must be supplied from published official schedules.
// https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html
export const calendar2026: WorkCalendar = {
  year: 2026,
  source: '国办发明电〔2025〕7号',
  holidays: [
    ...range('2026-01-01', '2026-01-03'),
    ...range('2026-02-15', '2026-02-23'),
    ...range('2026-04-04', '2026-04-06'),
    ...range('2026-05-01', '2026-05-05'),
    ...range('2026-06-19', '2026-06-21'),
    ...range('2026-09-25', '2026-09-27'),
    ...range('2026-10-01', '2026-10-07'),
  ],
  workdays: ['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10'],
};
export function workCalendars(): WorkCalendar[] {
  const file = process.env.OPC_WITHDRAWAL_CALENDAR_FILE;
  if (!file) return [calendar2026];
  try {
    const extra = z.array(calendarSchema).parse(JSON.parse(readFileSync(file, 'utf8')));
    if (new Set(extra.map((c) => c.year)).size !== extra.length) throw new Error('duplicate year');
    const all = new Map([[2026, calendar2026]]);
    for (const c of extra) all.set(c.year, c);
    return [...all.values()];
  } catch {
    throw new AppError(503, 50300, '提现工作日日历配置有误，请稍后重试');
  }
}
export function isWorkday(day: string, calendars: WorkCalendar[]) {
  const c = calendars.find((c) => c.year === Number(day.slice(0, 4)));
  if (!c) throw new AppError(503, 50300, '提现工作日日历尚未更新，请稍后重试');
  if (c.workdays.includes(day)) return true;
  if (c.holidays.includes(day)) return false;
  return ![0, 6].includes(new Date(day + 'T00:00:00Z').getUTCDay());
}
export function afterWorkdays(day: string, count: number, calendars: WorkCalendar[]) {
  let result = day;
  for (let scanned = 0; count > 0 && scanned < 370; scanned++) {
    result = nextDay(result);
    if (isWorkday(result, calendars)) count--;
  }
  if (count > 0) throw new AppError(503, 50300, '提现工作日日历无法计算，请稍后重试');
  return result;
}
export const withdrawalRuleLines = [
  '10 元起提，每日最多申请 1 次，单笔不超过可提现余额。',
  '手续费为申请金额的 1%，从申请金额中扣除；申请 100 元，扣余额 100 元，到账 99 元。',
  '10—500 元（含 500 元）：3 个工作日内审核并结算。',
  '超过 500 元：15 个工作日内审核，在申请月份的次月内结算，最迟次月最后一日完成，无固定打款日。',
  '团长大额提现向平台开具发票；达人及独立达人无需提供发票。',
  '全天可提交；财务工作日 10:00—18:00 处理，法定节假日和调休按国家安排。',
];
export const withdrawalRuleDetails = [
  '按北京时间自然日计次，同一账号在 Web、小程序和不同项目合计每天最多 1 笔成功受理的申请。校验失败不计次；同一申请重试不重复计次；受理后撤回或退回仍占当日次数。',
  '提交成功后的下一个工作日计为第 1 日，审核或小额结算截至对应工作日 18:00。法定放假日排除，调休补班日计入。',
  '大额的结算月份以申请月份确定，审核跨月不改变最晚结算日。例如 10 月 1 日和 10 月 31 日申请，均最迟 11 月 30 日完成结算打款。月底为休息日时财务提前安排。',
  '手续费按申请金额的 1% 四舍五入到分，到账金额为申请金额减手续费。提交时占用申请总额，未付款而取消或退回时全部释放，不收手续费。',
  '团长可在原申请查看财务提供的开票要求并补充发票；补交不重新占用余额或次数。审核通过不等于已打款，付款进度以实际付款记录为准。',
  '本规则只适用于启用后按本规则确认的新申请，历史申请不补扣手续费。',
];
export function withdrawalRules() {
  return {
    enabled: withdrawalPolicyEnabled(),
    version: WITHDRAWAL_POLICY_VERSION,
    minAmount: '10.00',
    dailyLimit: 1,
    feeRate: '1%',
    lines: withdrawalRuleLines,
    details: withdrawalRuleDetails,
  };
}
export function calculateWithdrawal(amount: string, role: string, day = shanghaiDay(), calendars = workCalendars()) {
  if (!/^\d{1,16}(\.\d{1,2})?$/.test(amount)) throw new AppError(422, 42200, '提现金额最多保留两位小数');
  const gross = cash(amount);
  if (gross < 100000n) throw new AppError(422, 42200, '最低提现金额为 10 元');
  const cents = gross / 100n,
    feeCents = (cents + 50n) / 100n,
    fee = feeCents * 100n;
  const tier = gross <= 5000000n ? 'small' : 'large';
  const reviewDeadline = afterWorkdays(day, tier === 'small' ? 3 : 15, calendars);
  const start = new Date(day + 'T00:00:00Z');
  const settlementDeadline =
    tier === 'small'
      ? reviewDeadline
      : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 2, 0)).toISOString().slice(0, 10);
  const settlementMonth = tier === 'large' ? settlementDeadline.slice(0, 7) : null;
  return {
    policyVersion: WITHDRAWAL_POLICY_VERSION,
    appliedDay: day,
    amount: cashText(gross),
    feeAmount: cashText(fee),
    netAmount: cashText(gross - fee),
    tier,
    reviewDeadline: reviewDeadline > settlementDeadline ? settlementDeadline : reviewDeadline,
    settlementDeadline,
    settlementMonth,
    invoiceRequired: role === 'leader' && tier === 'large',
    calendarVersion: checksum(calendars),
    applicantRole: role,
  };
}
