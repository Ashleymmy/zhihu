import { RowDataPacket } from 'mysql2/promise';
import { rows } from '../db';
import { AppError } from '../middleware/errors';
import { enqueue } from '../queue';
import { AuthUser } from '../types';
import { pageOffset } from '../utils/pagination';
import { acquireRateLimit } from '../utils/rateLimit';
import { scopeFilter } from '../utils/scopeFilter';

interface CountRow extends RowDataPacket { total: number }
const range = (query: Record<string, unknown>) => ({ from: String(query.from ?? '1970-01-01'), to: String(query.to ?? '2999-12-31') });

export async function overview(user: AuthUser) {
  const scope = scopeFilter(user, 'm.owner_id');
  const [row] = await rows<RowDataPacket & Record<string, number>>(
    `SELECT
       SUM(CASE WHEN m.stat_date = CURDATE() THEN m.impressions ELSE 0 END) today_impressions,
       SUM(CASE WHEN m.stat_date = CURDATE() THEN m.clicks ELSE 0 END) today_clicks,
       SUM(CASE WHEN m.stat_date = CURDATE() THEN m.conversions ELSE 0 END) today_conversions,
       SUM(CASE WHEN m.stat_date = CURDATE() THEN m.earning ELSE 0 END) today_earning,
       SUM(m.impressions) total_impressions, SUM(m.clicks) total_clicks,
       SUM(m.conversions) total_conversions, SUM(m.earning) total_earning
     FROM daily_metrics m WHERE ${scope.clause}`, scope.bindings,
  );
  return {
    today: { impressions: Number(row?.today_impressions ?? 0), clicks: Number(row?.today_clicks ?? 0), conversions: Number(row?.today_conversions ?? 0), earning: Number(row?.today_earning ?? 0) },
    total: { impressions: Number(row?.total_impressions ?? 0), clicks: Number(row?.total_clicks ?? 0), conversions: Number(row?.total_conversions ?? 0), earning: Number(row?.total_earning ?? 0) },
  };
}

export async function trend(user: AuthUser, query: Record<string, unknown>) {
  const scope = scopeFilter(user, 'm.owner_id'); const dates = range(query);
  const data = await rows<RowDataPacket & { stat_date: string; impressions: number; clicks: number; conversions: number; earning: number }>(
    `SELECT DATE_FORMAT(m.stat_date, '%Y-%m-%d') stat_date, SUM(m.impressions) impressions, SUM(m.clicks) clicks,
      SUM(m.conversions) conversions, SUM(m.earning) earning
     FROM daily_metrics m WHERE ${scope.clause} AND m.stat_date BETWEEN ? AND ? GROUP BY m.stat_date ORDER BY m.stat_date`,
    [...scope.bindings, dates.from, dates.to],
  );
  return { dates: data.map((item) => item.stat_date), series: [
    { name: '曝光', key: 'impressions', values: data.map((item) => Number(item.impressions)) },
    { name: '点击', key: 'clicks', values: data.map((item) => Number(item.clicks)) },
    { name: '转化', key: 'conversions', values: data.map((item) => Number(item.conversions)) },
    { name: '收益', key: 'earning', values: data.map((item) => Number(item.earning)) },
  ] };
}

export async function byKeyword(user: AuthUser, query: Record<string, unknown>) {
  const page = Number(query.page ?? 1); const pageSize = Number(query.pageSize ?? 20); const dates = range(query);
  const scope = scopeFilter(user, 'm.owner_id'); const allowedSort = ['earning', 'impressions', 'clicks', 'conversions'];
  const sort = allowedSort.includes(String(query.sort)) ? String(query.sort) : 'earning'; const order = query.order === 'asc' ? 'ASC' : 'DESC';
  const [count] = await rows<CountRow>(`SELECT COUNT(DISTINCT m.channel_id, m.keyword) total FROM daily_metrics m WHERE ${scope.clause} AND m.stat_date BETWEEN ? AND ?`, [...scope.bindings, dates.from, dates.to]);
  const list = await rows(
    `SELECT m.channel_id, m.keyword, SUM(m.impressions) impressions, SUM(m.clicks) clicks, SUM(m.conversions) conversions, SUM(m.earning) earning
     FROM daily_metrics m WHERE ${scope.clause} AND m.stat_date BETWEEN ? AND ? GROUP BY m.channel_id, m.keyword
     ORDER BY ${sort} ${order} LIMIT ? OFFSET ?`, [...scope.bindings, dates.from, dates.to, pageSize, pageOffset(page, pageSize)],
  );
  return { list, total: Number(count?.total ?? 0), page, pageSize };
}

export async function byMember(user: AuthUser, query: Record<string, unknown>) {
  const dates = range(query); const scope = scopeFilter(user, 'm.owner_id');
  return rows(
    `SELECT u.id owner_id, u.display_name, SUM(m.impressions) impressions, SUM(m.clicks) clicks, SUM(m.conversions) conversions, SUM(m.earning) earning
     FROM daily_metrics m JOIN users u ON u.id = m.owner_id WHERE ${scope.clause} AND m.stat_date BETWEEN ? AND ?
     GROUP BY u.id, u.display_name ORDER BY earning DESC`, [...scope.bindings, dates.from, dates.to],
  );
}

export async function requestSync(user: AuthUser) {
  if (!(await acquireRateLimit(`metrics-sync:${user.sub}`, 600))) throw new AppError(429, 42902, '同步过于频繁，请 10 分钟后重试');
  const job = await enqueue('sync-metrics', { requestedBy: user.sub }, { jobId: `metrics-${user.sub}-${Math.floor(Date.now() / 600_000)}` });
  return { jobId: String(job.id), status: 'queued' };
}
