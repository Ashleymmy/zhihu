import { clientIdHash } from '../../src/auth/clientIdentity';
import type { Role } from '../../src/types';

export const unitClientId = 'isolated-unit-browser-installation';
export const unitSessionId = (userId: string) => 'unit-session-' + userId;

/** Database fixture for the real auth middleware; role and device checks still run. */
export function unitAuthRows(users: Record<string, { role: Role; parent_id?: string | null; admin_duty?: string }>) {
  return async (sql: string, bindings: unknown[] = []) => {
    if (sql === 'SELECT role,is_active,admin_duty,parent_id FROM users WHERE id=?') {
      const user = users[String(bindings[0])];
      return user ? [{ is_active: 1, admin_duty: 'all', parent_id: null, ...user }] : [];
    }
    if (
      sql ===
      'SELECT id FROM login_sessions WHERE id=? AND user_id=? AND client_type=? AND client_id_hash=? AND revoked_at IS NULL AND expires_at>NOW(3)'
    ) {
      const [sessionId, userId, clientType, hash] = bindings;
      return users[String(userId)] &&
        sessionId === unitSessionId(String(userId)) &&
        clientType === 'web' &&
        hash === clientIdHash(unitClientId)
        ? [{ id: sessionId }]
        : [];
    }
    throw new Error('Unexpected query in isolated auth fixture');
  };
}
