import { rows } from '../db';
import type { RowDataPacket } from 'mysql2/promise';

export async function memberClientInfo(ids: string[]) {
  const result = new Map<string, ReturnType<typeof assemble>>();
  if (!ids.length) return result;
  // Batch only IDs already authorized by the member list query.
  for (let offset = 0; offset < ids.length; offset += 200) {
    const batch = ids.slice(offset, offset + 200),
      placeholders = batch.map(() => '?').join(',');
    const [bindings, sessions, activity] = await Promise.all([
      rows(
        `SELECT user_id,created_at,CONCAT('***',RIGHT(open_id,4)) masked_identity FROM wechat_identities WHERE app_id=? AND user_id IN (${placeholders})`,
        [process.env.WECHAT_APP_ID ?? '', ...batch],
      ),
      rows(
        `SELECT user_id,client_type,MAX(created_at) last_login_at,
        SUM(revoked_at IS NULL AND expires_at>NOW(3)) active_count,
        MAX(CASE WHEN revoked_at IS NULL AND expires_at>NOW(3) THEN expires_at END) active_until,
        MAX(CASE WHEN rn=1 THEN revoked_at END) latest_revoked_at,
        MAX(CASE WHEN rn=1 THEN expires_at END) latest_expires_at
        FROM (SELECT s.*,ROW_NUMBER() OVER(PARTITION BY user_id,client_type ORDER BY created_at DESC,id DESC) rn FROM login_sessions s WHERE user_id IN (${placeholders})) ranked GROUP BY user_id,client_type`,
        batch,
      ),
      rows(
        `SELECT user_id,MAX(occurred_at) last_activity_at,MAX(CASE WHEN result_code=40908 THEN occurred_at END) last_conflict_at,
        MAX(CASE WHEN result_code=40908 THEN id ELSE 0 END) conflict_id,
        MAX(CASE WHEN result_code=0 AND http_status<400 AND route_key IN ('/core/auth/login','/core/auth/bind','/core/auth/register','/core/auth/wechat-login') THEN id ELSE 0 END) recovered_id
        FROM mini_request_events WHERE user_id IN (${placeholders}) AND occurred_at>=DATE_SUB(NOW(3),INTERVAL 7 DAY) GROUP BY user_id`,
        batch,
      ),
    ]);
    for (const id of batch)
      result.set(
        id,
        assemble(
          bindings.find((b) => String(b.user_id) === id),
          sessions.filter((s) => String(s.user_id) === id),
          activity.find((a) => String(a.user_id) === id),
        ),
      );
  }
  return result;
}
function assemble(binding: RowDataPacket | undefined, sessions: RowDataPacket[], activity: RowDataPacket | undefined) {
  const clients = (['web', 'mobile', 'mini'] as const).map((type) => {
    const row = sessions.find((s) => s.client_type === type),
      activeCount = Number(row?.active_count ?? 0);
    return {
      type,
      state: !row ? 'none' : activeCount ? 'valid' : row.latest_revoked_at ? 'revoked' : 'expired',
      activeCount,
      lastLoginAt: row?.last_login_at ?? null,
      expiresAt: row?.active_until ?? row?.latest_expires_at ?? null,
    };
  });
  const lastLogin = clients[2].lastLoginAt;
  return {
    bindingStatus: !process.env.WECHAT_APP_ID ? 'not_configured' : binding ? 'bound' : 'unbound',
    boundAt: binding?.created_at ?? null,
    maskedIdentity: binding?.masked_identity ?? null,
    lastLoginAt: lastLogin,
    lastActivityAt: activity?.last_activity_at ?? null,
    lastConflictAt: activity?.last_conflict_at ?? null,
    recentBindingConflict: BigInt(activity?.conflict_id ?? 0) > BigInt(activity?.recovered_id ?? 0),
    sessions: clients,
  };
}
