import { rows } from '../db';
import { effectiveDuty, isStaffRole } from '../auth/roles';
import { AppError } from '../middleware/errors';
import { AuthUser } from '../types';
import { config } from '../config';
import { listManagedMembers } from './member-access.service';
import { observationWriterState } from '../wechat/observability';

export function canReadMiniTechnical(actor: AuthUser) {
  return (actor.role === 'developer' || actor.role === 'admin') && effectiveDuty(actor) === 'all';
}
export async function miniMonitor(actor: AuthUser) {
  if (!isStaffRole(actor.role) || effectiveDuty(actor) === 'finance')
    throw new AppError(403, 40301, '无权查看小程序监控');
  const members = await listManagedMembers(actor);
  const bound = members.filter((m) => m.miniProgram?.bindingStatus === 'bound');
  const noProject = bound.filter((m) => m.is_active && m.role === 'creator' && !m.projects.some((p) => p.isEnabled));
  const conflict = members.filter((m) => m.miniProgram?.recentBindingConflict);
  const [courses] = await rows('SELECT COUNT(*) total,SUM(published=1) published FROM college_courses');
  const [projects] = await rows('SELECT COUNT(*) total FROM projects WHERE is_enabled=1');
  const business = {
    boundAccounts: bound.length,
    unboundAccounts: members.filter((m) => m.miniProgram?.bindingStatus === 'unbound').length,
    validMiniSessions: bound.filter(
      (m) => m.is_active && m.miniProgram?.sessions.some((s) => s.type === 'mini' && s.activeCount > 0),
    ).length,
    boundNoProject: noProject.length,
    bindingConflicts: conflict.length,
    publishedCourses: Number(courses?.published ?? 0),
    totalCourses: Number(courses?.total ?? 0),
    enabledProjects: Number(projects?.total ?? 0),
    zhihuEnabled: config.enabledModules.includes('zhihu'),
  };
  if (!canReadMiniTechnical(actor)) return { readAt: new Date().toISOString(), business, technical: null };
  const [summary] = await rows(`SELECT COUNT(*) requests,
    SUM(http_status>=500) server_errors,SUM(http_status>=400 AND http_status<500) rejected,
    AVG(duration_ms) average_ms,MAX(occurred_at) last_request_at,
    MAX(CASE WHEN http_status<400 AND result_code=0 THEN occurred_at END) last_success_at
    FROM mini_request_events WHERE occurred_at>=DATE_SUB(NOW(3),INTERVAL 24 HOUR)`);
  const [deployment] = await rows(`SELECT cloud_env,bridge_version,occurred_at FROM mini_request_events
    WHERE cloud_env IS NOT NULL AND cloud_env<>'' AND occurred_at>=DATE_SUB(NOW(3),INTERVAL 7 DAY) ORDER BY id DESC LIMIT 1`);
  const clientVersions =
    await rows(`SELECT client_env,client_version,COUNT(*) requests,MAX(occurred_at) last_seen_at FROM mini_request_events
    WHERE client_version IS NOT NULL AND client_version<>'' AND occurred_at>=DATE_SUB(NOW(3),INTERVAL 24 HOUR)
    GROUP BY client_env,client_version ORDER BY last_seen_at DESC LIMIT 10`);
  const failures =
    await rows(`SELECT e.id,e.occurred_at,e.route_key,e.method,e.http_status,e.result_code,e.duration_ms,e.user_id,u.display_name
    FROM mini_request_events e LEFT JOIN users u ON u.id=e.user_id
    WHERE (e.http_status>=400 OR e.result_code<>0) AND e.occurred_at>=DATE_SUB(NOW(3),INTERVAL 24 HOUR) ORDER BY e.id DESC LIMIT 20`);
  return {
    readAt: new Date().toISOString(),
    business,
    technical: {
      configured: !!process.env.WECHAT_APP_ID && (process.env.WECHAT_BRIDGE_SECRET?.length ?? 0) >= 32,
      appId: process.env.WECHAT_APP_ID || null,
      database: 'readable',
      requests: Number(summary.requests),
      serverErrors: Number(summary.server_errors ?? 0),
      rejected: Number(summary.rejected ?? 0),
      failureRate: Number(summary.requests) ? Number(summary.server_errors ?? 0) / Number(summary.requests) : null,
      averageMs: summary.average_ms == null ? null : Math.round(Number(summary.average_ms)),
      lastRequestAt: summary.last_request_at,
      lastSuccessAt: summary.last_success_at,
      deployment: deployment ?? null,
      clientVersions,
      failures,
      writer: observationWriterState(),
    },
  };
}
