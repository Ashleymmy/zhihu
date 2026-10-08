import type { AuthUser } from '../../../types';
import { rows } from '../../../db';
import { isStaffRole } from '../../../auth/roles';
import { assertDuty } from '../../../core/duties';
import { AppError } from '../../../middleware/errors';
import { legacyOwnerScope, assertLegacyFinanceRead } from './legacy-finance-access';
import { money } from '../attribution/domain';

export const historyKinds = ['earnings', 'withdrawals', 'appeals', 'settlements', 'data-import'] as const;
export type HistoryKind = (typeof historyKinds)[number];
type RecordRow = Record<string, unknown>;
const text = (value: unknown) => (value == null ? '—' : String(value));
const state: Record<string, string> = {
  preview: '已读取，未确认',
  pending: '待处理',
  confirmed: '已确认',
  paid: '已支付',
  approved: '已完成',
  leader_approved: '已初审',
  rejected: '已退回',
  cancelled: '已取消',
  draft: '未完成',
  parsed: '已读取',
  invalid: '有错误',
  processing: '处理中',
};
// Historical earnings/withdrawals/appeal adjustments are stored in cents; relay totals are yuan.
function amount(value: unknown, cents = false) {
  if (value == null) return '—';
  const micro = money(String(value), true),
    n = micro < 0n ? -micro : micro,
    scale = cents ? 6 : 4,
    denominator = 10n ** BigInt(scale);
  return (
    (micro < 0n ? '-' : '') +
    String(n / denominator) +
    '.' +
    String(n % denominator)
      .padStart(scale, '0')
      .replace(/0+$/, '')
      .padEnd(2, '0')
  );
}
function problems(value: unknown) {
  try {
    const v = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(v) ? v.map(String).join('；') || '无' : text(value);
  } catch {
    return text(value);
  }
}
const field = (label: string, value: unknown) => ({ label, value: text(value) });
export async function financeHistory(
  user: AuthUser,
  kind: HistoryKind,
  page: number,
  pageSize: number,
  recordId?: string,
) {
  assertLegacyFinanceRead(user);
  if (['settlements', 'data-import'].includes(kind)) assertDuty(user, 'finance');
  const owner = legacyOwnerScope(user, 'h.user_id');
  let table = '',
    projection = '',
    join = '',
    where = '1=1';
  let params: unknown[] = [];
  if (kind === 'earnings') {
    table = 'earnings';
    projection =
      "h.id,h.status,h.user_id,CAST(h.amount AS CHAR) amount,DATE_FORMAT(h.settle_date,'%Y-%m-%d') record_date,h.source_ref,p.keyword,u.display_name owner_name";
    join = 'LEFT JOIN plans p ON p.id=h.plan_id LEFT JOIN users u ON u.id=h.user_id';
    where = owner.clause;
    params = owner.bindings;
  } else if (kind === 'withdrawals') {
    table = 'withdrawal_requests';
    projection =
      "h.id,h.status,h.user_id,CAST(h.amount AS CHAR) amount,DATE_FORMAT(h.created_at,'%Y-%m-%d') record_date,h.pay_method,h.remark,h.leader_remark,h.invoice_name,DATE_FORMAT(h.handled_at,'%Y-%m-%d %H:%i') handled_at,u.display_name owner_name";
    join = 'LEFT JOIN users u ON u.id=h.user_id';
    where = owner.clause;
    params = owner.bindings;
  } else if (kind === 'appeals') {
    table = 'finance_appeals';
    projection =
      "h.id,h.status,h.user_id,CAST(h.adjust_amount AS CHAR) amount,DATE_FORMAT(h.created_at,'%Y-%m-%d') record_date,h.title,h.kind,h.content,h.evidence,h.remark,h.leader_remark,u.display_name owner_name";
    join = 'LEFT JOIN users u ON u.id=h.user_id';
    where = owner.clause;
    params = owner.bindings;
  } else if (kind === 'settlements') {
    table = 'settlement_batches';
    projection =
      "h.id,h.status,h.title,CAST(h.total_source AS CHAR) source_amount,CAST(h.total_relay AS CHAR) amount,DATE_FORMAT(h.created_at,'%Y-%m-%d') record_date,DATE_FORMAT(h.period_start,'%Y-%m-%d') period_start,DATE_FORMAT(h.period_end,'%Y-%m-%d') period_end,u.display_name owner_name";
    join = 'LEFT JOIN users u ON u.id=h.created_by';
  } else {
    table = 'data_import_batches';
    projection =
      "h.id,h.status,h.file_name,h.total_rows,h.valid_rows,h.error_rows,h.rejection_reason,DATE_FORMAT(h.created_at,'%Y-%m-%d') record_date,u.display_name owner_name";
    join = 'LEFT JOIN users u ON u.id=h.created_by';
  }
  if (recordId) {
    where += ' AND h.id=?';
    params = [...params, recordId];
  }
  const [count] = await rows(`SELECT COUNT(*) total FROM ${table} h WHERE ${where}`, params);
  if (recordId && !Number(count?.total)) throw new AppError(404, 40401, '这条历史记录不存在或无权查看');
  const records = await rows(
    `SELECT ${projection} FROM ${table} h ${join} WHERE ${where} ORDER BY h.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return {
    list: records.map((r: RecordRow) => {
      const fields = [
        field('日期', r.record_date),
        field('记录人', r.owner_name),
        field('原状态', state[String(r.status)] || '已留存'),
      ];
      let title = text(
        r.keyword ||
          r.title ||
          r.file_name ||
          {
            earnings: '历史收益',
            withdrawals: '历史提现',
            appeals: '历史申诉',
            settlements: '历史结算',
            'data-import': '历史报表',
          }[kind],
      );
      const value = kind === 'data-import' ? null : amount(r.amount, kind !== 'settlements');
      if (value !== null) fields.push(field(kind === 'appeals' ? '调整金额' : '金额（元）', value));
      if (kind === 'withdrawals')
        fields.push(
          field(
            '收款方式',
            ({ wechat: '微信', alipay: '支付宝', bank_transfer: '银行转账' } as Record<string, string>)[
              String(r.pay_method)
            ],
          ),
          field('处理时间', r.handled_at),
          field('初审意见', r.leader_remark),
          field('处理意见', r.remark),
          field('发票文件', r.invoice_name),
        );
      if (kind === 'appeals')
        fields.push(
          field('类型', r.kind),
          field('说明', r.content),
          field('证据', r.evidence),
          field('初审意见', r.leader_remark),
          field('处理意见', r.remark),
        );
      if (kind === 'settlements')
        fields.push(
          field('开始日期', r.period_start),
          field('结束日期', r.period_end),
          field('来源金额（元）', amount(r.source_amount)),
        );
      if (kind === 'data-import')
        fields.push(
          field('总行数', r.total_rows),
          field('有效行', r.valid_rows),
          field('问题行', r.error_rows),
          field('退回说明', r.rejection_reason),
        );
      return {
        id: String(r.id),
        invoiceName: kind === 'withdrawals' && r.invoice_name ? String(r.invoice_name) : null,
        title,
        status: { key: String(r.status), label: state[String(r.status)] || '已留存', tone: 'neutral' as const },
        cells: { date: text(r.record_date), owner: text(r.owner_name), amount: value === null ? '—' : value },
        fields,
      };
    }),
    total: Number(count?.total || 0),
    page,
    pageSize,
    staff: isStaffRole(user.role),
  };
}
export async function historyLines(user: AuthUser, kind: HistoryKind, id: string, page: number, pageSize: number) {
  await financeHistory(user, kind, 1, 1, id); // Enforce the same owner and duty scope before reading details.
  if (!['settlements', 'data-import'].includes(kind)) return { list: [], total: 0, page, pageSize };
  const table = kind === 'settlements' ? 'settlement_items' : 'data_import_rows';
  const [count] = await rows(`SELECT COUNT(*) total FROM ${table} WHERE batch_id=?`, [id]);
  const list =
    kind === 'settlements'
      ? await rows(
          `SELECT h.id,u.display_name owner_name,CAST(h.source_amount AS CHAR) source_amount,h.note FROM settlement_items h LEFT JOIN users u ON u.id=h.creator_id WHERE h.batch_id=? ORDER BY h.id LIMIT ? OFFSET ?`,
          [id, pageSize, (page - 1) * pageSize],
        )
      : await rows(
          "SELECT `row_number`,DATE_FORMAT(occurred_at,'%Y-%m-%d') record_date,channel_name,keyword,promotion_task,search_volume,order_count,CAST(revenue_amount AS CHAR) revenue_amount,validation_status,errors_json FROM data_import_rows WHERE batch_id=? ORDER BY `row_number` LIMIT ? OFFSET ?",
          [id, pageSize, (page - 1) * pageSize],
        );
  return {
    list: list.map((r: RecordRow) =>
      kind === 'settlements'
        ? {
            id: String(r.id),
            fields: [
              field('成员', r.owner_name),
              field('来源金额（元）', amount(r.source_amount)),
              field('备注', r.note),
            ],
          }
        : {
            id: String(r.row_number),
            fields: [
              field('原表行号', r.row_number),
              field('日期', r.record_date),
              field('渠道', r.channel_name),
              field('关键词', r.keyword),
              field('推广活动', r.promotion_task),
              field('搜索量', r.search_volume),
              field('订单量', r.order_count),
              field('原表金额（元）', r.revenue_amount),
              field('检查结果', r.validation_status === 'valid' ? '有效' : '有问题'),
              field('问题说明', problems(r.errors_json)),
            ],
          },
    ),
    total: Number(count?.total || 0),
    page,
    pageSize,
  };
}
