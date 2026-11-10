import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { AuthUser } from '../types';
import { withTransaction } from '../db';
import { dutyAllows, assertDuty } from './duties';
import { cash, cashText } from './money';
import type { ModuleRuntime } from './module-runtime';
import { assertInsightStaff, eachDay, insightContext, insightFilter, insightScopes, queryRows, scopedSql, sourceDetail, type InsightFilter, type InsightScope } from './insights-scope';

const unavailableUpstream = { available: false, reason: '当前项目尚未提供可追溯的上游收入，不能计算平台留存' };
const currentLines = 'JOIN opc_earning_lines l ON l.source_id=s.id AND l.source_version=s.current_version';
const integer = (value: unknown) => String(value ?? '0');
const money = (value: unknown) => cashText(cash(String(value ?? '0'), true));
function memberScope(scopes: InsightScope[]) {
  const ids = [...new Set(scopes.map(s => s.projectId))];
  return { sql: 'EXISTS(SELECT 1 FROM project_members pm WHERE pm.user_id=u.id AND pm.left_at IS NULL AND pm.project_id IN (?))', args: [ids.length ? ids : ['0']] };
}
async function composition(c: PoolConnection, filter: InsightFilter, scopes: InsightScope[]) {
  const m = memberScope(scopes);
  const [counts] = await queryRows(c, `SELECT COUNT(*) members,COALESCE(SUM(u.role='leader'),0) team_count,
    COALESCE(SUM(u.role='creator' AND (u.parent_id IS NULL OR NOT EXISTS(SELECT 1 FROM users leader WHERE leader.id=u.parent_id AND leader.role='leader'))),0) solo_creators,
    COALESCE(SUM(DATE(u.created_at) BETWEEN ? AND ?),0) new_members
    FROM users u WHERE u.role IN ('leader','creator') AND u.is_active=1 AND u.closed_at IS NULL AND ${m.sql}`, [filter.from, filter.to, ...m.args]);
  const [newTeams] = await queryRows(c, `SELECT COUNT(DISTINCT u.id) total FROM users u JOIN member_role_history h ON h.user_id=u.id
    WHERE h.to_role='leader' AND h.reason<>'migration' AND DATE(h.effective_at) BETWEEN ? AND ? AND ${m.sql}`, [filter.from, filter.to, ...m.args]);
  return { memberCount: Number(counts.members), teamCount: Number(counts.team_count), soloCreators: Number(counts.solo_creators), newMembers: Number(counts.new_members), newTeams: Number(newTeams.total) };
}
async function summary(c: PoolConnection, user: AuthUser, filter: InsightFilter, scopes: InsightScope[]) {
  const scope = scopedSql('s', scopes), compositionData = await composition(c, filter, scopes);
  const [counts] = await queryRows(c, `SELECT COUNT(DISTINCT l.performer_id) active_members,
    COUNT(DISTINCT s.module_id,s.project_id,s.account_id,s.task_id) task_count,
    COUNT(DISTINCT IF(l.performer_id<>l.payee_id,l.payee_id,NULL)) active_teams
    FROM opc_earning_sources s ${currentLines} WHERE ${scope.sql} AND s.business_date BETWEEN ? AND ?`, [...scope.args, filter.from, filter.to]);
  const base = { ...insightContext(filter, scopes), status: scopes.length ? 'ready' : 'empty', ...compositionData,
    activeMembers: Number(counts.active_members), taskCount: Number(counts.task_count), activeTeams: Number(counts.active_teams),
    activeMemberBasis: 'performers_with_recorded_earnings_in_period', coverage: 'recorded_sources_only',
    details: { tasks: { path: '/tasks', query: { projectId: filter.projectId, accountId: filter.accountId, moduleId: filter.moduleId, from: filter.from, to: filter.to } }, members: { path: '/team', query: { projectId: filter.projectId } } } };
  if (!dutyAllows(user, 'finance')) return base;
  const [confirmed] = await queryRows(c, `SELECT CAST(COALESCE(SUM(e.amount),0) AS CHAR) amount
    FROM opc_income_sources s JOIN opc_income_entries e ON e.source_id=s.id WHERE ${scope.sql} AND s.business_date BETWEEN ? AND ?`, [...scope.args, filter.from, filter.to]);
  const [projection] = await queryRows(c, `SELECT CAST(COALESCE(SUM(l.amount),0) AS CHAR) amount,SUM(l.amount IS NULL) missing
    FROM opc_earning_sources s ${currentLines} WHERE ${scope.sql} AND s.business_date BETWEEN ? AND ? AND l.is_internal=0`, [...scope.args, filter.from, filter.to]);
  return { ...base, memberPayout: money(confirmed.amount), memberPayoutBasis: 'net_confirmed_income_by_business_date',
    expectedAmount: Number(projection.missing ?? 0) ? null : money(projection.amount), knownExpectedAmount: money(projection.amount), pendingCalculations: Number(projection.missing ?? 0),
    upstream: null, retention: null, payoutRatio: null, retentionRate: null, availability: { upstream: unavailableUpstream, retention: unavailableUpstream } };
}
async function daily(c: PoolConnection, user: AuthUser, filter: InsightFilter, scopes: InsightScope[]) {
  const scope = scopedSql('s', scopes), labels = eachDay(filter.from, filter.to);
  if (dutyAllows(user, 'finance')) {
    const rows = await queryRows(c, `SELECT DATE_FORMAT(s.business_date,'%Y-%m-%d') date,CAST(SUM(e.amount) AS CHAR) amount
      FROM opc_income_sources s JOIN opc_income_entries e ON e.source_id=s.id WHERE ${scope.sql} AND s.business_date BETWEEN ? AND ? GROUP BY s.business_date`, [...scope.args, filter.from, filter.to]);
    const amounts = new Map(rows.map(r => [String(r.date), money(r.amount)]));
    return { ...insightContext(filter, scopes), status: rows.length ? 'ready' : 'empty', labels, series: [{ key: 'confirmed_income', label: '已确认成员收益', unit: '元', values: labels.map(d => amounts.get(d) ?? '0.0000') }], coverage: 'confirmed_ledger_only', availability: { upstream: unavailableUpstream } };
  }
  const rows = await queryRows(c, `SELECT DATE_FORMAT(s.business_date,'%Y-%m-%d') date,s.module_id,s.metric_type,s.metric_label,s.quantity_unit,CAST(SUM(v.quantity) AS CHAR) quantity,SUM(v.quantity IS NULL) missing
    FROM opc_earning_sources s JOIN (SELECT l.source_id,MAX(l.quantity) quantity FROM opc_earning_lines l JOIN opc_earning_sources cur ON cur.id=l.source_id AND cur.current_version=l.source_version GROUP BY l.source_id) v ON v.source_id=s.id
    WHERE ${scope.sql} AND s.business_date BETWEEN ? AND ? GROUP BY s.business_date,s.module_id,s.metric_type,s.metric_label,s.quantity_unit ORDER BY s.business_date`, [...scope.args, filter.from, filter.to]);
  const series = [...new Set(rows.map(r => JSON.stringify([r.module_id, r.metric_type, r.metric_label, r.quantity_unit])))].map(key => {
    const [moduleId, metricType, label, unit] = JSON.parse(key) as string[];
    const matching = rows.filter(r => r.module_id === moduleId && r.metric_type === metricType && r.quantity_unit === unit);
    return { key: moduleId + ':' + metricType, moduleId, metricType, label, unit, values: labels.map(d => { const r = matching.find(r => r.date === d); return r && Number(r.missing) ? null : integer(r?.quantity); }) };
  });
  return { ...insightContext(filter, scopes), status: rows.length ? 'ready' : 'empty', labels, series, coverage: 'recorded_sources_only' };
}
async function teamTop(c: PoolConnection, user: AuthUser, filter: InsightFilter, scopes: InsightScope[]) {
  const scope = scopedSql('s', scopes), finance = dutyAllows(user, 'finance');
  const rows = await queryRows(c, `SELECT CAST(l.payee_id AS CHAR) member_id,MAX(u.display_name) name,s.metric_type,s.metric_label,s.quantity_unit,
    CAST(SUM(l.quantity) AS CHAR) quantity,SUM(l.quantity IS NULL) quantity_missing,COUNT(*) records${finance ? ',CAST(SUM(l.amount) AS CHAR) amount,SUM(l.amount IS NULL) missing' : ''}
    FROM opc_earning_sources s ${currentLines} JOIN users u ON u.id=l.payee_id
    WHERE ${scope.sql} AND s.business_date BETWEEN ? AND ? AND l.performer_id<>l.payee_id AND l.is_internal=0
    GROUP BY l.payee_id,s.metric_type,s.metric_label,s.quantity_unit ORDER BY l.payee_id,s.metric_type`, [...scope.args, filter.from, filter.to]);
  const groups = new Map<string, { memberId: string; name: string; quantities: { metricType: string; label: string; unit: string; quantity: string | null; records: number }[]; amount?: string; pendingCalculations?: number }>();
  for (const r of rows) {
    const item = groups.get(r.member_id) ?? { memberId: String(r.member_id), name: String(r.name), quantities: [], ...(finance ? { amount: '0.0000', pendingCalculations: 0 } : {}) };
    item.quantities.push({ metricType: String(r.metric_type), label: String(r.metric_label), unit: String(r.quantity_unit), quantity: Number(r.quantity_missing) ? null : integer(r.quantity), records: Number(r.records) });
    if (finance) { item.amount = cashText(cash(item.amount!, true) + cash(money(r.amount), true)); item.pendingCalculations! += Number(r.missing); }
    groups.set(item.memberId, item);
  }
  const list = [...groups.values()].sort((a, b) => {
    if (finance) { const delta = cash(b.amount!, true) - cash(a.amount!, true); if (delta) return delta > 0n ? 1 : -1; }
    return BigInt(a.memberId) < BigInt(b.memberId) ? -1 : 1;
  });
  return { ...insightContext(filter, scopes), status: list.length ? 'ready' : 'empty', list: list.slice((filter.page - 1) * filter.pageSize, filter.page * filter.pageSize).map(r => ({ ...r,
    ...(finance ? { knownAmount: r.amount, amount: r.pendingCalculations ? null : r.amount } : {}),
    quantity: r.quantities.length === 1 ? r.quantities[0].quantity : null,
    detail: { path: finance ? '/finance' : '/team', query: { projectId: filter.projectId, accountId: filter.accountId, moduleId: filter.moduleId, from: filter.from, to: filter.to, payeeId: r.memberId } } })),
    total: list.length, page: filter.page, pageSize: filter.pageSize, amountBasis: finance ? 'saved_team_commission_current_projection' : undefined,
    quantityBasis: 'separate_metric_types', ownershipBasis: 'saved_payee_and_performer' };
}
async function forest(c: PoolConnection, filter: InsightFilter, scopes: InsightScope[]) {
  const m = memberScope(scopes);
  const [count] = await queryRows(c, `SELECT COUNT(*) total FROM users u WHERE u.role='leader' AND u.closed_at IS NULL AND ${m.sql}`, m.args);
  const leaders = await queryRows(c, `SELECT CAST(u.id AS CHAR) id,u.display_name,u.is_active FROM users u WHERE u.role='leader' AND u.closed_at IS NULL AND ${m.sql} ORDER BY u.id LIMIT ? OFFSET ?`, [...m.args, filter.pageSize, (filter.page - 1) * filter.pageSize]);
  const roots = [];
  for (const leader of leaders) {
    const children = await queryRows(c, `SELECT CAST(u.id AS CHAR) id,u.display_name,u.is_active,IF(u.parent_id=?,'team','invite') via
      FROM users u LEFT JOIN member_referrals ref ON ref.user_id=u.id
      WHERE u.id<>? AND u.role IN ('leader','creator') AND u.closed_at IS NULL AND ${m.sql} AND (u.parent_id=? OR ref.inviter_id=?)
      ORDER BY u.id LIMIT 101`, [leader.id, leader.id, ...m.args, leader.id, leader.id]);
    roots.push({ id: String(leader.id), name: String(leader.display_name), active: Boolean(leader.is_active), children: children.slice(0, 100).map(r => ({ id: String(r.id), name: String(r.display_name), active: Boolean(r.is_active), via: r.via })), hasMoreChildren: children.length > 100, detail: { path: '/team/relations', memberId: String(leader.id) } });
  }
  return { ...insightContext(filter, scopes, 'current_relationships'), status: Number(count.total) ? 'ready' : 'empty', roots, total: Number(count.total), page: filter.page, pageSize: filter.pageSize, hasMore: filter.page * filter.pageSize < Number(count.total), relationBasis: 'current_team_and_saved_original_invitation' };
}
async function feed(c: PoolConnection, filter: InsightFilter, scopes: InsightScope[]) {
  const scope = scopedSql('s', scopes);
  const from = `FROM opc_earning_sources s JOIN projects p ON p.id=s.project_id JOIN opc_earning_lines l ON l.id=(SELECT MIN(pick.id) FROM opc_earning_lines pick WHERE pick.source_id=s.id AND pick.source_version=s.current_version) WHERE ${scope.sql} AND s.business_date BETWEEN ? AND ?`;
  const args = [...scope.args, filter.from, filter.to];
  const [count] = await queryRows(c, `SELECT COUNT(*) total ${from}`, args);
  const rows = await queryRows(c, `SELECT CAST(s.id AS CHAR) id,s.module_id,CAST(s.project_id AS CHAR) project_id,CAST(s.account_id AS CHAR) account_id,s.source_key,s.task_id,DATE_FORMAT(s.business_date,'%Y-%m-%d') business_date,s.metric_type,s.metric_label,s.quantity_unit,p.name project_name,CAST(l.performer_id AS CHAR) performer_id,l.performer_name,CAST(l.quantity AS CHAR) quantity,l.created_at ${from} ORDER BY l.created_at DESC,s.id DESC LIMIT ? OFFSET ?`, [...args, filter.pageSize, (filter.page - 1) * filter.pageSize]);
  const masked = (name: unknown) => { const chars = [...String(name || '未命名')]; return chars[0] + '*'.repeat(Math.max(1, Math.min(chars.length - 1, 3))); };
  return { ...insightContext(filter, scopes), status: Number(count.total) ? 'ready' : 'empty', total: Number(count.total), page: filter.page, pageSize: filter.pageSize,
    list: rows.map(r => ({ id: String(r.id), memberId: r.performer_id ? String(r.performer_id) : null, name: masked(r.performer_name), project: String(r.project_name), projectId: String(r.project_id), metricType: String(r.metric_type), quantityValue: r.quantity === null ? null : String(r.quantity), quantity: r.quantity === null ? '待核对' : String(r.quantity) + ' ' + r.quantity_unit, at: new Date(r.created_at).toISOString(), businessDate: r.business_date, detail: sourceDetail(r) })), eventBasis: 'earning_projection_created_at' };
}
export async function readInsights(runtime: ModuleRuntime, user: AuthUser, name: 'summary' | 'daily' | 'team-top' | 'retention' | 'relation-forest' | 'live-feed', query: unknown) {
  assertInsightStaff(user);
  if (name === 'relation-forest') assertDuty(user, 'operations');
  const filter = insightFilter(query), scopes = await insightScopes(runtime, user, filter);
  return withTransaction(async c => {
    if (name === 'summary') return summary(c, user, filter, scopes);
    if (name === 'daily') return daily(c, user, filter, scopes);
    if (name === 'team-top') return teamTop(c, user, filter, scopes);
    if (name === 'relation-forest') return forest(c, filter, scopes);
    if (name === 'live-feed') return feed(c, filter, scopes);
    if (dutyAllows(user, 'finance')) return { ...insightContext(filter, scopes), status: 'unavailable', capability: unavailableUpstream, rate: null, parts: null };
    const counts = await composition(c, filter, scopes);
    return { ...insightContext(filter, scopes, 'current_membership'), status: scopes.length ? 'ready' : 'empty', ...counts, activeRate: null, activeRateReason: '当前记录不能还原所选期间每位成员的活跃情况' };
  });
}
