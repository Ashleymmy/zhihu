import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { withTransaction } from '../db';
import { effectiveDuty, normalizeRole } from '../auth/roles';
import type { AuthUser } from '../types';
import { AppError } from '../middleware/errors';
import { dutyAllows } from './duties';
import type { ModuleRuntime } from './module-runtime';

export interface ReminderItem {
  id: string;
  kind: 'comment' | 'payment' | 'action';
  title: string;
  body: string;
  next: string;
  path: string;
  createdAt: string;
  readAt: string | null;
  handled: boolean;
}
export interface ReminderQuery {
  page: number;
  pageSize: number;
  state: 'unread' | 'all';
}
async function actor(c: PoolConnection, user: AuthUser): Promise<AuthUser> {
  const [[stored]] = await c.query<RowDataPacket[]>(
    'SELECT role,admin_duty,is_active,closed_at FROM users WHERE id=? FOR SHARE',
    [user.sub],
  );
  const role = normalizeRole(stored?.role);
  if (!stored?.is_active || stored.closed_at || !role) throw new AppError(403, 40301, '账号权限已变化，请重新登录');
  return { ...user, role, adminDuty: effectiveDuty({ role, adminDuty: stored.admin_duty }) as AuthUser['adminDuty'] };
}

/** SQL filters precede aggregation and pagination; a read receipt never grants access. */
function events(runtime: ModuleRuntime, user: AuthUser) {
  const finance = dutyAllows(user, 'finance'),
    operations = dutyAllows(user, 'operations');
  const modules = runtime.all().filter((m) => m.manifest.roles.includes(user.role));
  const financialModules = modules.filter((m) => !!m.settlementProvider).map((m) => m.manifest.id);
  const evidenceModules = modules.filter((m) => !!m.dataProvider?.evidenceInTransaction).map((m) => m.manifest.id);
  const walletModules = modules.map((m) => m.manifest.id);
  const params: unknown[] = [];
  // Legacy withdrawals have no origin row. Their explicit (including later zeroed)
  // associations provide an authorized, durable route back to the financial thread.
  const paymentSettlement = (w: string, origin: string) => `COALESCE(
    (SELECT origin_st.id FROM opc_settlements origin_st WHERE origin_st.id=${origin}.settlement_id
      AND origin_st.module_id=${w}.module_id AND origin_st.project_id=${w}.project_id AND origin_st.account_id=${w}.account_id
      AND origin_st.leader_id=${w}.user_id AND origin_st.status='confirmed'),
    (SELECT linked_st.id FROM opc_settlement_payment_allocations pa JOIN opc_settlements linked_st ON linked_st.id=pa.settlement_id
      WHERE pa.withdrawal_id=${w}.id AND pa.user_id=${w}.user_id
      AND linked_st.module_id=${w}.module_id AND linked_st.project_id=${w}.project_id AND linked_st.account_id=${w}.account_id
      AND linked_st.leader_id=${w}.user_id AND linked_st.status='confirmed' ORDER BY pa.linked_at DESC,pa.id DESC LIMIT 1))`;
  const scopes = (alias: string) => `EXISTS(SELECT 1 FROM integration_accounts a
    JOIN project_integrations pi ON pi.account_id=a.id JOIN projects p ON p.id=pi.project_id
    JOIN module_installations mi ON mi.module_id=a.module_id
    WHERE a.id=${alias}.account_id AND a.module_id=${alias}.module_id AND pi.project_id=${alias}.project_id
      AND a.status='active' AND p.is_enabled=1)`;
  const commentConditions: string[] = [];
  if ((finance || operations) && evidenceModules.length) {
    commentConditions.push(`(cm.context_kind='evidence' AND cm.module_id IN (?) AND cm.leader_id IS NULL
      AND cm.channel_ref IS NOT NULL AND cm.business_date IS NOT NULL AND cm.metric_type IS NOT NULL)`);
    params.push(evidenceModules);
  }
  if (finance && financialModules.length) {
    commentConditions.push(`(cm.module_id IN (?) AND (
      (cm.context_kind='settlement' AND st.id IS NOT NULL)
      OR (cm.context_kind='earning_source' AND es.id IS NOT NULL AND (
        EXISTS(SELECT 1 FROM opc_earning_lines l WHERE l.source_id=es.id AND l.source_version=es.current_version AND l.payee_id=cm.leader_id AND l.is_internal=0)
        OR EXISTS(SELECT 1 FROM opc_income_sources src JOIN opc_income_entries ie ON ie.source_id=src.id
          WHERE src.module_id=cm.module_id AND src.project_id=cm.project_id AND src.account_id=cm.account_id AND src.source_key=es.source_key AND ie.user_id=cm.leader_id)))
      OR (cm.context_kind='withdrawal' AND cw.id IS NOT NULL)))`);
    params.push(financialModules);
  }
  // Deliberately omit message body from the badge/read model. The authorized destination loads it.
  const comments = `SELECT CONCAT('comment:',cm.id) event_key,'comment' kind,cm.context_kind,CAST(cm.context_id AS CHAR) context_id,
    cm.module_id,CAST(cm.project_id AS CHAR) project_id,CAST(cm.account_id AS CHAR) account_id,
    CAST(cm.leader_id AS CHAR) leader_id,cm.channel_ref,DATE_FORMAT(cm.business_date,'%Y-%m-%d') business_date,cm.metric_type,
    DATE_FORMAT(COALESCE(st.business_from,es.business_date),'%Y-%m-%d') business_from,
    DATE_FORMAT(COALESCE(st.business_to,es.business_date),'%Y-%m-%d') business_to,
    CAST(COALESCE(st.id,${paymentSettlement('cw', 'po')}) AS CHAR) settlement_id,
    cm.created_at event_at,NULL payment_status,NULL failure_reason,
    CASE WHEN cm.context_kind='withdrawal' THEN cw.status IN ('paid','cancelled','rejected')
      WHEN cm.context_kind='settlement' THEN st.status='confirmed'
      WHEN cm.context_kind='earning_source' THEN NOT EXISTS(SELECT 1 FROM opc_earning_lines pending_line WHERE pending_line.source_id=es.id AND pending_line.source_version=es.current_version AND pending_line.is_internal=0 AND (pending_line.is_ready=0 OR pending_line.confirmed_at IS NULL))
      ELSE 0 END handled,
    CASE WHEN cm.context_kind='earning_source' THEN es.task_name ELSE recipient.display_name END context_name,
    (SELECT p.name FROM projects p WHERE p.id=cm.project_id) project_name
    FROM opc_record_comments cm
    LEFT JOIN opc_settlements st ON cm.context_kind='settlement' AND st.id=cm.context_id AND st.module_id=cm.module_id AND st.project_id=cm.project_id AND st.account_id=cm.account_id AND st.leader_id=cm.leader_id
    LEFT JOIN opc_earning_sources es ON cm.context_kind='earning_source' AND es.id=cm.context_id AND es.module_id=cm.module_id AND es.project_id=cm.project_id AND es.account_id=cm.account_id
    LEFT JOIN opc_withdrawals cw ON cm.context_kind='withdrawal' AND cw.id=cm.context_id AND cw.module_id=cm.module_id AND cw.project_id=cm.project_id AND cw.account_id=cm.account_id AND cw.user_id=cm.leader_id
    LEFT JOIN opc_settlement_payment_origins po ON po.withdrawal_id=cw.id
    LEFT JOIN users recipient ON recipient.id=cm.leader_id
    WHERE (${commentConditions.join(' OR ') || '0=1'}) AND cm.author_id<>? AND ${scopes('cm')}`;
  params.push(user.sub);
  const member = ['leader', 'creator'].includes(user.role);
  let paymentCondition = '0=1';
  if ((finance || member) && walletModules.length) {
    paymentCondition = 'w.module_id IN (?)';
    params.push(walletModules);
    if (member) {
      paymentCondition +=
        ' AND w.user_id=? AND EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=w.project_id AND pm.user_id=? AND pm.left_at IS NULL)';
      params.push(user.sub, user.sub);
    } else paymentCondition += " AND w.status IN ('pending','approved')";
  }
  const payments = `SELECT CONCAT('payment:',w.id,':',LEFT(SHA2(CONCAT_WS('|',w.status,w.payment_version,
      COALESCE(w.reviewed_at,''),COALESCE(w.paid_at,''),COALESCE(po.attempt_version,0)),256),24)) event_key,
    'payment' kind,'withdrawal' context_kind,CAST(w.id AS CHAR) context_id,w.module_id,CAST(w.project_id AS CHAR) project_id,
    CAST(w.account_id AS CHAR) account_id,CAST(w.user_id AS CHAR) leader_id,NULL channel_ref,NULL business_date,NULL metric_type,
    NULL business_from,NULL business_to,CAST(${paymentSettlement('w', 'po')} AS CHAR) settlement_id,
    GREATEST(w.created_at,COALESCE(w.reviewed_at,w.created_at),COALESCE(w.paid_at,w.created_at),
      COALESCE((SELECT MAX(pe.created_at) FROM opc_settlement_payment_events pe WHERE pe.withdrawal_id=w.id),w.created_at)) event_at,
    w.status payment_status,po.failure_reason,w.status IN ('paid','cancelled','rejected') handled,
    recipient.display_name context_name,(SELECT p.name FROM projects p WHERE p.id=w.project_id) project_name
    FROM opc_withdrawals w LEFT JOIN opc_settlement_payment_origins po ON po.withdrawal_id=w.id
    JOIN users recipient ON recipient.id=w.user_id
    WHERE ${paymentCondition} AND ${scopes('w')}`;
  return { sql: `${comments} UNION ALL ${payments}`, params, finance };
}

function view(row: RowDataPacket, finance: boolean): ReminderItem {
  const query = new URLSearchParams({
    moduleId: String(row.module_id),
    projectId: String(row.project_id),
    accountId: String(row.account_id),
  });
  let path = finance ? '/finance' : '/income',
    title = '付款进度已更新',
    body = '',
    next = '查看付款记录';
  if (row.kind === 'comment') {
    const name = String(row.context_name ?? '');
    title =
      row.context_kind === 'evidence'
        ? `${name || '资料'} · ${String(row.business_date)}核对有新留言`
        : row.context_kind === 'withdrawal'
          ? `${name || '收款人'}的付款有新留言`
          : row.context_kind === 'settlement'
            ? `${name || '收款人'}的结算有新留言`
            : `${name || '收益记录'}有新留言`;
    body = `${String(row.project_name ?? '当前项目')} · 打开记录查看留言并继续处理。`;
    next = '查看留言';
    if (row.context_kind === 'evidence') {
      path = '/dashboard';
      query.set('reminderContext', 'evidence');
      query.set('channelRef', String(row.channel_ref));
      query.set('taskRef', String(row.context_id));
      query.set('businessDate', String(row.business_date));
      query.set('metricType', String(row.metric_type));
    }
  } else {
    const labels: Record<string, string> = {
      pending: '待审核',
      approved: '待登记付款',
      paid: '已登记付款',
      cancelled: '已取消',
      rejected: '未通过审核',
    };
    body = row.failure_reason
      ? '上次付款办理未完成，记录与款项仍保留。'
      : `当前状态：${labels[String(row.payment_status)] ?? '待核对'}。`;
    if (finance) {
      title = row.failure_reason
        ? `${String(row.context_name || '收款人')}的付款需要继续处理`
        : `${String(row.context_name || '收款人')}有付款等待办理`;
      next = row.payment_status === 'pending' ? '财务：审核申请' : '财务：继续付款办理';
    }
    body = `${String(row.project_name ?? '当前项目')} · ${body}`;
  }
  if (row.context_kind !== 'evidence') {
    if (row.leader_id && finance) query.set('leaderId', String(row.leader_id));
    if (row.settlement_id && finance) query.set('settlementId', String(row.settlement_id));
    if (row.context_kind === 'withdrawal') query.set('withdrawalId', String(row.context_id));
    if (row.context_kind === 'earning_source') {
      query.set('sourceId', String(row.context_id));
      query.set('from', String(row.business_from));
      query.set('to', String(row.business_to));
    }
  }
  return {
    id: String(row.event_key),
    kind: row.kind,
    title,
    body,
    next,
    path: `${path}?${query.toString()}`,
    createdAt: String(row.created_text),
    readAt: row.read_text ? String(row.read_text) : null,
    handled: !!Number(row.handled),
  };
}

export async function listReminders(runtime: ModuleRuntime, user: AuthUser, query: ReminderQuery) {
  return withTransaction(async (c) => {
    const current = await actor(c, user),
      event = events(runtime, current);
    const join = `FROM (${event.sql}) e LEFT JOIN opc_reminder_reads rr ON rr.event_key=e.event_key AND rr.user_id=?`;
    const params = [...event.params, current.sub];
    const [[count]] = await c.query<RowDataPacket[]>(
      `SELECT COUNT(*) total,COALESCE(SUM(rr.read_at IS NULL),0) unread ${join}`,
      params,
    );
    const [rows] = await c.query<RowDataPacket[]>(
      `SELECT e.*,DATE_FORMAT(e.event_at,'%Y-%m-%d %H:%i:%s') created_text,
      DATE_FORMAT(rr.read_at,'%Y-%m-%d %H:%i:%s') read_text ${join} ${query.state === 'unread' ? 'WHERE rr.read_at IS NULL' : ''}
      ORDER BY e.event_at DESC,e.event_key DESC LIMIT ? OFFSET ?`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    // Copy only the authorized record's title and completion state, never message bodies or financial fields.
    const states = new Map<string, { handled: boolean; title: string | null }>();
    for (const row of rows) {
      if (row.context_kind !== 'evidence') continue;
      const key = JSON.stringify([
        row.module_id,
        row.project_id,
        row.account_id,
        row.channel_ref,
        row.context_id,
        row.business_date,
        row.metric_type,
      ]);
      if (!states.has(key)) {
        const provider = runtime.get(String(row.module_id))?.dataProvider?.evidenceInTransaction;
        let handled = false,
          title: string | null = null;
        if (provider) {
          const evidence = await provider(
            c,
            {
              projectId: String(row.project_id),
              accountId: String(row.account_id),
              from: String(row.business_date),
              to: String(row.business_date),
            },
            current,
            {
              channelRef: String(row.channel_ref),
              taskRef: String(row.context_id),
              metricType: String(row.metric_type),
              page: 1,
              pageSize: 1,
            },
          );
          const result = evidence.list[0];
          const matches =
            !!result &&
            evidence.list.length === 1 &&
            result.key.projectId === String(row.project_id) &&
            result.key.accountId === String(row.account_id) &&
            result.key.channelRef === String(row.channel_ref) &&
            result.key.taskRef === String(row.context_id) &&
            result.key.businessDate === String(row.business_date) &&
            result.key.metricType === String(row.metric_type);
          handled = matches && result.result.status === 'ready';
          if (matches) title = result.title.slice(0, 255);
        }
        states.set(key, { handled, title });
      }
      row.handled = states.get(key)?.handled ? 1 : 0;
      row.context_name = states.get(key)?.title ?? null;
    }
    return {
      list: rows.map((r) => view(r, event.finance)),
      total: Number(query.state === 'unread' ? count.unread : count.total),
      unread: Number(count.unread),
      page: query.page,
      pageSize: query.pageSize,
    };
  });
}
export async function readReminder(runtime: ModuleRuntime, user: AuthUser, key: string, read: boolean) {
  return withTransaction(async (c) => {
    const current = await actor(c, user),
      event = events(runtime, current);
    const [[found]] = await c.query<RowDataPacket[]>(`SELECT e.event_key FROM (${event.sql}) e WHERE e.event_key=?`, [
      ...event.params,
      key,
    ]);
    if (!found) throw new AppError(404, 40400, '这条提醒已更新或不在当前权限范围，请重新读取提醒');
    await c.query(
      `INSERT INTO opc_reminder_reads(user_id,event_key,read_at) VALUES(?,?,IF(?,NOW(3),NULL))
      ON DUPLICATE KEY UPDATE read_at=IF(?,COALESCE(read_at,NOW(3)),NULL)`,
      [current.sub, key, read, read],
    );
    const [[row]] = await c.query<RowDataPacket[]>(
      "SELECT DATE_FORMAT(read_at,'%Y-%m-%d %H:%i:%s') read_text FROM opc_reminder_reads WHERE user_id=? AND event_key=?",
      [current.sub, key],
    );
    return { id: key, readAt: row.read_text ? String(row.read_text) : null };
  });
}
