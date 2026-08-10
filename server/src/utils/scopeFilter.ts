import { AuthUser } from '../types';

export function scopeFilter(user: AuthUser, ownerCol = 'owner_id') {
  if (!/^[A-Za-z0-9_.]+$/.test(ownerCol)) throw new Error('非法 owner 列名');
  switch (user.role) {
    case 'boss':
      return { clause: '1=1', bindings: [] as string[] };
    case 'leader':
      return {
        clause: `${ownerCol} IN (SELECT id FROM users WHERE parent_id = ? OR id = ?)`,
        bindings: [user.sub, user.sub],
      };
    case 'member':
      return { clause: `${ownerCol} = ?`, bindings: [user.sub] };
  }
}
