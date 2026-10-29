import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { AppError } from '../middleware/errors';
import { cash, cashText, checksum } from './money';

export const WITHDRAWAL_POLICY_VERSION = '2026-10-21-v2';
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
// All new applications share one account-wide gross daily allowance.
export const dailyWithdrawalLimit = (role: string) => role === 'leader' ? '500.00' : '100.00';
export const withdrawalRuleLines = [
  "可提现余额为内容推广报酬及团队服务分成中，已完成结算并开放提现的金额。",
  "不设最低起提金额，不限申请次数，单笔不超过可提现余额及当日剩余额度。",
  "每日累计限额：个人达人100元，团长500元；无额外周限额或月限额。按北京时间自然日、同一账号跨项目合并计算，以扣除手续费前的申请金额计。",
  "提现手续费为申请金额的1%，从申请金额中扣除。例如申请100元，扣减余额100元，手续费1元，实际到账99元。",
  "成功受理后3个工作日内完成审核并结算打款，从下一个工作日起算。",
  "全天可提交申请；财务处理时间为工作日10:00—18:00，节假日及调休按国家安排计算。"
];
export const withdrawalRuleDetails = [
  "一、收益来源与可提现余额",
  "本平台收益来源于用户参与内容推广项目所取得的推广报酬，以及依据项目规则取得的团队服务分成。具体收益根据有效业务记录、项目结算报表、作品审核结果及约定结算标准核算。",
  "作品登记或审核通过不代表立即产生收益。相关收益经核对确认、款项实际到账并由财务核实开放后，计入可提现余额。尚未完成结算的收益与可提现余额分别展示。",
  "用户可以在可提现余额和当日剩余提现额度范围内提交申请。已被其他提现申请占用的金额不得重复申请。",
  "二、提现金额与申请次数",
  "平台不设置最低起提金额，不设置固定提现次数限制。",
  "提现金额须大于零，以人民币元为单位，精确到分。用户可以在当日剩余提现额度及可提现余额范围内，一次或分多次申请提现。",
  "三、每日累计提现限额",
  "1. 个人达人，包括团队内达人和独立达人：每个账号每日累计提现申请金额不超过100元。\n2. 团长：每个账号每日累计提现申请金额不超过500元。\n3. 每日按北京时间00:00至24:00计算，同一账号在不同项目提交的申请合并统计。每日限额按扣除手续费前的申请金额计算。\n4. 不设置额外的周累计提现限额或月累计提现限额。每日额度独立计算，未使用的额度不累计至后续日期。",
  "例如，个人达人当日已申请60元，当日剩余提现额度为40元；在余额充足的情况下，可以继续一次或分多次申请，合计不超过40元。",
  "四、手续费与实际到账金额",
  "提现手续费为申请金额的1%，由申请人承担，从申请金额中扣除。手续费按四舍五入保留至人民币分，实际到账金额为申请金额减去手续费。",
  "例如：申请提现100元，平台余额扣减100元，手续费为1元，实际到账99元；申请提现500元，平台余额扣减500元，手续费为5元，实际到账495元。",
  "提交申请前，页面展示申请金额、手续费及预计到账金额，用户确认后提交。申请受理时占用申请总额。未付款的申请被取消或退回时，释放全部申请金额，不收取该笔提现手续费。",
  "五、审核与打款时间",
  "按本规则提交的提现申请，单笔金额均不超过500元，平台在申请成功受理后3个工作日内完成审核并结算打款。",
  "提交成功后的下一个工作日为第1个工作日，最迟处理时间为第3个工作日18:00。工作日按照国家法定节假日及调休安排计算，法定放假日不计入，调休补班日计入。",
  "例如：周一成功提交申请，且周二至周四均为正常工作日，则最迟于周四18:00前完成审核并结算打款。",
  "每笔申请独立计算处理期限。多笔申请或财务合并打款不改变各笔申请原定的处理期限。",
  "六、申请时间与办理流程",
  "用户可全天提交提现申请，财务处理时间为工作日10:00—18:00。非财务处理时间提交的申请，按上述工作日规则计算处理期限。",
  "办理流程为：填写提现金额及真实收款信息，确认手续费和预计到账金额，提交申请，财务审核，实际打款，更新付款记录。",
  "申请提交后，用户可查看申请记录和处理进度。审核通过表示该笔申请已完成审核，实际付款情况以付款记录及收款账户到账信息为准。",
  "七、收款资料与发票",
  "用户应填写真实、准确的收款信息，并核对收款账户能够正常接收款项。资料需要补充或更正时，平台在原申请中告知具体原因和办理要求。",
  "个人达人及团长按本规则提交的提现申请，无需向平台提供发票。此前已受理且约定需提供发票的团长大额申请，按照受理时的要求提交和核验发票。",
  "八、异常处理与申请查询",
  "网络异常或页面未及时显示结果时，用户应先查询原申请记录，确认是否已受理。同一申请的重复提交或重试不应导致重复扣减余额或重复打款。",
  "申请被退回、付款失败或需要补充资料时，平台应说明具体原因，并提供查询或后续处理方式。用户可以通过业务负责人或平台运营者核查申请状态、手续费及付款情况。",
  "九、已受理申请",
  "已受理申请按照受理时向用户公示并确认的规则办理，不追加手续费，不因本规则变更而延后原承诺的付款期限。申请、审核及付款等必要记录按适用要求保留。"
];
export function withdrawalRules(role?: string) {
  return {
    enabled: withdrawalPolicyEnabled(), version: WITHDRAWAL_POLICY_VERSION,
    minAmount: '0.00', dailyLimit: null, dailyAmountLimit: role ? dailyWithdrawalLimit(role) : null,
    dailyAmountLimits: { creator: '100.00', leader: '500.00' }, feeRate: '1%',
    lines: withdrawalRuleLines, details: withdrawalRuleDetails,
  };
}
export function calculateWithdrawal(amount: string, role: string, day = shanghaiDay(), calendars = workCalendars()) {
  if (!/^\d{1,16}(\.\d{1,2})?$/.test(amount)) throw new AppError(422, 42200, '提现金额最多保留两位小数');
  const gross = cash(amount);
  if (!['leader', 'creator'].includes(role)) throw new AppError(403, 40300, '请使用团长或达人账号申请提现');
  if (gross <= 0n) throw new AppError(422, 42200, '提现金额须大于零');
  if (gross > cash(dailyWithdrawalLimit(role))) throw new AppError(422, 42200, '申请金额超过每日累计限额 ' + dailyWithdrawalLimit(role) + ' 元');
  const cents = gross / 100n,
    feeCents = (cents + 50n) / 100n,
    fee = feeCents * 100n;
  const tier = 'small';
  const reviewDeadline = afterWorkdays(day, 3, calendars);
  const settlementDeadline = reviewDeadline;
  const settlementMonth = null;
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
    invoiceRequired: false,
    calendarVersion: checksum(calendars),
    applicantRole: role,
  };
}
