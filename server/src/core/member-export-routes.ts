import { Router } from 'express';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import type { RowDataPacket } from 'mysql2/promise';
import { withTransaction } from '../db';
import { AppError, asyncHandler } from '../middleware/errors';
import { assertDuty } from './duties';
import { canViewWorkStatistics } from '../auth/roles';
import { userIdMap } from '../auth/user-id';
import { writeAudit } from '../services/audit.service';
import type { ModuleRuntime } from './module-runtime';
import { cash, cashText } from './money';

const query = z
  .object({
    memberIds: z
      .array(z.string().regex(/^[1-9]\d*$/))
      .min(1)
      .max(30000)
      .refine((ids) => new Set(ids).size === ids.length),
    from: z.string().date(),
    to: z.string().date(),
    includeEarnings: z.boolean().default(false),
    projectId: z
      .string()
      .regex(/^[1-9]\d*$/)
      .optional(),
  })
  .strict()
  .refine((q) => q.from <= q.to, { message: '开始日期不能晚于结束日期' });
const roles: Record<string, string> = {
  creator: '达人',
  leader: '团长',
  admin: '管理员',
  developer: '开发者',
  operator: '运营',
};
const sources: Record<string, string> = {
  registration: '注册',
  invitation_accept: '接受邀请加入',
  application: '入团申请通过',
  transfer: '管理员调整团队',
  promotion: '升级',
  demotion: '降级',
  removal: '移出团队',
  closure: '账号注销',
  manual: '管理员调整角色',
  migration: '历史关系基线',
};
const str = (value: unknown) => (value == null ? '' : String(value));
function sheet(book: XLSX.WorkBook, name: string, head: string[], data: unknown[][]) {
  // Account IDs, phones, and decimal amounts are strings, never formulas or floating-point numbers.
  const s = XLSX.utils.aoa_to_sheet([head, ...data]);
  s['!cols'] = head.map(() => ({ wch: 24 }));
  s['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: data.length, c: head.length - 1 } }) };
  XLSX.utils.book_append_sheet(book, s, name);
}
export function createMemberExportRouter(runtime: ModuleRuntime) {
  const r = Router();
  r.post(
    '/',
    asyncHandler(async (req, res) => {
      assertDuty(req.user, 'operations');
      if (!canViewWorkStatistics(req.user.role)) throw new AppError(403, 40300, '成员资料导出仅向管理员和开发者开放');
      const q = query.parse(req.body);
      if (q.includeEarnings) assertDuty(req.user, 'finance');
      const book = await withTransaction(async (c) => {
        const [members] = await c.query<RowDataPacket[]>(
          `
        SELECT CAST(u.id AS CHAR) id,u.username,u.display_name,u.role,u.phone,u.is_active,u.closed_at,u.phone_verified_at,
          DATE_FORMAT(u.created_at,'%Y-%m-%d %H:%i:%s') registered_at,
          CAST(p.id AS CHAR) leader_id,p.display_name leader_name,p.phone leader_phone,
          CAST(i.id AS CHAR) inviter_id,i.display_name inviter_name,i.phone inviter_phone,r.channel,
          CAST(r.invitation_id AS CHAR) invitation_id,mi.label invitation_label,
          DATE_FORMAT(m.effective_from,'%Y-%m-%d %H:%i:%s') team_since,m.source team_source,
          DATE_FORMAT(r.registered_at,'%Y-%m-%d %H:%i:%s') referral_at
        FROM users u LEFT JOIN users p ON p.id=u.parent_id AND p.role='leader'
        LEFT JOIN member_referrals r ON r.user_id=u.id LEFT JOIN users i ON i.id=r.inviter_id
        LEFT JOIN member_invitations mi ON mi.id=r.invitation_id
        LEFT JOIN team_memberships m ON m.open_user=u.id
        WHERE u.id IN (?) ORDER BY p.id,u.role,u.id`,
          [q.memberIds],
        );
        if (members.length !== q.memberIds.length) throw new AppError(409, 40900, '成员名单已变化，请刷新后重新导出');
        const publicIds = await userIdMap(c, members.flatMap(m => [m.id, m.leader_id, m.inviter_id]));
        const uid = (id: unknown) => id == null ? '' : publicIds.get(String(id)) ?? '';
        const [projects] = await c.query<RowDataPacket[]>(
          `SELECT CAST(pm.user_id AS CHAR) user_id,p.name FROM project_members pm
        JOIN projects p ON p.id=pm.project_id WHERE pm.user_id IN (?) AND pm.left_at IS NULL ORDER BY p.id`,
          [q.memberIds],
        );
        const wb = XLSX.utils.book_new();
        const exportedAt = new Intl.DateTimeFormat('sv-SE', {
          timeZone: 'Asia/Shanghai',
          dateStyle: 'short',
          timeStyle: 'medium',
        }).format(new Date());
        const channel: Record<string, string> = {
          leader_invite: '团长邀请链接',
          creator_invite: '达人邀请链接',
          staff_invite: '平台邀请链接',
          leader_created: '团长创建',
          organic: '自行注册',
          admin_assign: '平台创建',
          migration: '历史资料整理',
        };
        sheet(
          wb,
          '成员与归属',
          [
            '用户ID',
            '姓名',
            '登录账号',
            '手机号',
            '手机号验证',
            '角色',
            '状态',
            '注册时间（北京时间）',
            '当前团长ID',
            '当前团长',
            '团长手机号',
            '当前归属起始记录（北京时间）',
            '归属时间依据',
            '邀请人ID',
            '邀请人',
            '邀请人手机号',
            '邀请来源',
            '邀请记录ID',
            '邀请名称',
            '邀请记录时间（北京时间）',
            '已开通项目',
            '导出时间（北京时间）',
          ],
          members.map((m) => [
            uid(m.id),
            str(m.display_name),
            str(m.username),
            str(m.phone),
            m.phone_verified_at ? '已验证' : '未验证',
            roles[m.role] || str(m.role),
            m.closed_at ? '已注销' : m.is_active ? '启用' : '停用',
            str(m.registered_at),
            uid(m.leader_id),
            str(m.leader_name),
            str(m.leader_phone),
            str(m.team_since),
            m.team_source === 'migration'
              ? '整理时的当前归属；此前时间未核实'
              : m.team_since
                ? '实际变更记录'
                : '尚未整理',
            uid(m.inviter_id),
            str(m.inviter_name),
            str(m.inviter_phone),
            channel[m.channel] || '尚未整理',
            str(m.invitation_id),
            str(m.invitation_label),
            str(m.referral_at),
            projects
              .filter((p) => String(p.user_id) === String(m.id))
              .map((p) => p.name)
              .join('、'),
            exportedAt,
          ]),
        );
        const [history] = await c.query<RowDataPacket[]>(
          `SELECT CAST(m.user_id AS CHAR) user_id,CAST(m.leader_id AS CHAR) leader_id,l.display_name leader_name,
        DATE_FORMAT(m.effective_from,'%Y-%m-%d %H:%i:%s.%f') since,DATE_FORMAT(m.effective_to,'%Y-%m-%d %H:%i:%s.%f') until,
        m.source,m.reason,CAST(m.operator_id AS CHAR) operator_id,o.display_name operator_name
        FROM team_memberships m LEFT JOIN users l ON l.id=m.leader_id LEFT JOIN users o ON o.id=m.operator_id
        WHERE m.user_id IN (?) ORDER BY m.user_id,m.effective_from,m.id LIMIT 30001`,
          [q.memberIds],
        );
        if (history.length > 30000) throw new AppError(422, 42200, '关系记录超过 30000 条，请缩小成员范围后导出');
        for (const [id, value] of await userIdMap(c, history.flatMap(h => [h.user_id,h.leader_id,h.operator_id]))) publicIds.set(id,value);
        sheet(
          wb,
          '团队归属历史',
          [
            '用户ID',
            '团长ID',
            '团长',
            '开始时间（北京时间）',
            '结束时间（北京时间）',
            '来源',
            '说明',
            '操作人ID',
            '操作人',
          ],
          history.map((h) => [
            uid(h.user_id),
            uid(h.leader_id),
            str(h.leader_name),
            str(h.since),
            str(h.until),
            sources[h.source] || '历史记录',
            str(h.reason),
            uid(h.operator_id),
            str(h.operator_name),
          ]),
        );
        const [rolesHistory] = await c.query<RowDataPacket[]>(
          `SELECT CAST(h.user_id AS CHAR) user_id,h.from_role,h.to_role,h.reason,h.note,
        DATE_FORMAT(h.effective_at,'%Y-%m-%d %H:%i:%s.%f') at,CAST(h.operator_id AS CHAR) operator_id,o.display_name operator_name
        FROM member_role_history h LEFT JOIN users o ON o.id=h.operator_id
        WHERE h.user_id IN (?) ORDER BY h.user_id,h.effective_at,h.id LIMIT 30001`,
          [q.memberIds],
        );
        if (rolesHistory.length > 30000) throw new AppError(422, 42200, '角色变更记录超过 30000 条，请缩小成员范围');
        for (const [id, value] of await userIdMap(c, rolesHistory.flatMap(h => [h.user_id,h.operator_id]))) publicIds.set(id,value);
        sheet(
          wb,
          '角色变更历史',
          ['用户ID', '原角色', '新角色', '变更时间（北京时间）', '来源', '说明', '操作人ID', '操作人'],
          rolesHistory.map((h) => [
            uid(h.user_id),
            roles[h.from_role] || '',
            roles[h.to_role] || str(h.to_role),
            str(h.at),
            h.reason === 'migration' ? '整理时的角色基线' : sources[h.reason] || '历史记录',
            str(h.note),
            uid(h.operator_id),
            str(h.operator_name),
          ]),
        );

        if (q.includeEarnings) {
          const modules = runtime
            .all()
            .filter((m) => m.manifest.roles.includes(req.user.role))
            .map((m) => m.manifest.id);
          const [earnings] = await c.query<RowDataPacket[]>(
            `
          SELECT CAST(u.id AS CHAR) user_id,u.display_name,CAST(s.project_id AS CHAR) project_id,p.name project_name,
            s.metric_type,s.metric_label,s.quantity_unit,
            IF(l.performer_id IS NULL OR l.performer_id=l.payee_id,'个人收益','团队分成') earning_group,
            COUNT(*) records,SUM(l.amount IS NULL) uncalculated,
            CAST(COALESCE(SUM(l.amount),0) AS CHAR) amount,'0.0000' confirmed
          FROM opc_earning_lines l JOIN opc_earning_sources s ON s.id=l.source_id
          JOIN users u ON u.id=l.payee_id JOIN projects p ON p.id=s.project_id
          JOIN integration_accounts a ON a.id=s.account_id AND a.module_id=s.module_id
          JOIN project_integrations pi ON pi.project_id=s.project_id AND pi.account_id=s.account_id
          WHERE l.payee_id IN (?) AND l.source_version=s.current_version AND l.is_internal=0
            AND s.module_id IN (?) AND s.business_date BETWEEN ? AND ? ${q.projectId ? 'AND s.project_id=?' : ''}
          GROUP BY u.id,u.display_name,s.project_id,p.name,s.metric_type,s.metric_label,s.quantity_unit,earning_group
          ORDER BY u.id,s.project_id,s.metric_type,earning_group LIMIT 30001`,
            [q.memberIds, modules.length ? modules : [''], q.from, q.to, ...(q.projectId ? [q.projectId] : [])],
          );
          if (earnings.length > 30000) throw new AppError(422, 42200, '收益记录超过 30000 条，请缩小成员或日期范围');
          // Read confirmed ledger separately: an old payee can disappear from the current projection.
          // A correction must not make that member's historical confirmed income disappear from export.
          const [paidRows] = await c.query<RowDataPacket[]>(
            `
          SELECT CAST(u.id AS CHAR) user_id,u.display_name,CAST(s.project_id AS CHAR) project_id,p.name project_name,
            COALESCE(es.metric_type,'unclassified') metric_type,COALESCE(es.metric_label,'未分类历史收益') metric_label,
            COALESCE(es.quantity_unit,'') quantity_unit,
            CASE WHEN l.id IS NULL THEN '未分类历史收益' WHEN l.performer_id IS NULL OR l.performer_id=l.payee_id THEN '个人收益' ELSE '团队分成' END earning_group,
            COUNT(*) records,0 uncalculated,'0.0000' amount,CAST(SUM(paid.amount) AS CHAR) confirmed
          FROM (SELECT source_id,user_id,SUM(amount) amount FROM opc_income_entries WHERE user_id IN (?) GROUP BY source_id,user_id) paid
          JOIN opc_income_sources s ON s.id=paid.source_id JOIN users u ON u.id=paid.user_id JOIN projects p ON p.id=s.project_id
          JOIN integration_accounts a ON a.id=s.account_id AND a.module_id=s.module_id
          JOIN project_integrations pi ON pi.project_id=s.project_id AND pi.account_id=s.account_id
          LEFT JOIN opc_earning_sources es ON es.module_id=s.module_id AND es.project_id=s.project_id AND es.account_id=s.account_id AND es.source_key=s.source_key
          LEFT JOIN opc_earning_lines l ON l.id=(SELECT latest.id FROM opc_earning_lines latest
            WHERE latest.source_id=es.id AND latest.payee_id=paid.user_id AND latest.confirmed_at IS NOT NULL ORDER BY latest.confirmed_at DESC,latest.id DESC LIMIT 1)
          WHERE s.module_id IN (?) AND s.business_date BETWEEN ? AND ? AND (l.id IS NULL OR l.is_internal=0) ${q.projectId ? 'AND s.project_id=?' : ''}
          GROUP BY u.id,u.display_name,s.project_id,p.name,es.metric_type,es.metric_label,es.quantity_unit,earning_group
          ORDER BY u.id,s.project_id,metric_type,earning_group LIMIT 30001`,
            [q.memberIds, modules.length ? modules : [''], q.from, q.to, ...(q.projectId ? [q.projectId] : [])],
          );
          const key = (e: RowDataPacket) => JSON.stringify([e.user_id, e.project_id, e.metric_type, e.earning_group]);
          const grouped = new Map(earnings.map((e) => [key(e), e]));
          for (const paid of paidRows) {
            const current = grouped.get(key(paid));
            if (current) current.confirmed = paid.confirmed;
            else grouped.set(key(paid), paid);
          }
          if (paidRows.length > 30000 || grouped.size > 30000)
            throw new AppError(422, 42200, '收益记录超过 30000 条，请缩小成员或日期范围');

          sheet(
            wb,
            '收益分类',
            [
              '用户ID',
              '姓名',
              '项目ID',
              '项目',
              '收益归属',
              '业绩类型',
              '统计开始日期',
              '统计结束日期',
              '记录数',
              '待计算记录数',
              '当前应得金额（元）',
              '已确认净额（元）',
              '待确认差额（元）',
            ],
            [...grouped.values()].map((e) => [
              uid(e.user_id),
              str(e.display_name),
              str(e.project_id),
              str(e.project_name),
              str(e.earning_group),
              str(e.metric_label),
              q.from,
              q.to,
              Number(e.records),
              Number(e.uncalculated),
              str(e.amount),
              str(e.confirmed),
              cashText(cash(str(e.amount), true) - cash(str(e.confirmed), true)),
            ]),
          );
        }
        sheet(
          wb,
          '导出口径',
          ['项目', '说明'],
          [
            ['导出时间（北京时间）', exportedAt],
            ['成员人数', String(members.length)],
            ['收益日期范围', q.from + ' 至 ' + q.to],
            [
              '收益范围',
              q.includeEarnings
                ? '已接入平台的收益明细及收入账目，排除内部演示记录；无分类依据的账目标为未分类历史收益，未接入平台的旧账不混入'
                : '本文件不包含金额',
            ],
            [
              '收益分类',
              '个人收益 / 团队分成与拉新 / 拉活是两个交叉维度，请勿把同一金额重复相加。邀请关系本身不产生额外收益。',
            ],
            ['未生成收益', '成员与归属表保留所有选中成员；没有收益分类行表示本期没有该口径记录，不补造金额。'],
            [
              '归属说明',
              '成员表是导出时的当前归属；收益使用原记录的收款人，不按当前团队重分配。历史关系基线不证明此前的入团日期。',
            ],
            ['已确认净额', '已确认账目包含历次更正，按净额汇总；待确认差额可能为负数。金额按四位小数字符串保留。'],
          ],
        );
        await writeAudit(
          {
            userId: req.user.sub,
            action: 'members.export',
            resourceType: 'members',
            detail: {
              count: members.length,
              memberIds: q.memberIds,
              from: q.from,
              to: q.to,
              includeEarnings: q.includeEarnings,
            },
          },
          c,
        );
        return wb;
      });
      res
        .set('Cache-Control', 'no-store')
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .attachment(`成员归属_${q.from}_${q.to}.xlsx`)
        .send(XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true }));
    }),
  );
  return r;
}
