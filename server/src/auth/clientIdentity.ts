import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { AppError } from '../middleware/errors';

export interface ClientIdentity {
  type: 'web' | 'mobile';
  id: string;
}
export const clientIdHash = (id: string) => createHash('sha256').update(id).digest('hex');

/** A browser installation ID, not an IP address or an invasive hardware fingerprint. */
export function clientIdentity(req: Request): ClientIdentity {
  const id = req.get('X-Client-Id');
  if (!id || !/^[a-zA-Z0-9_-]{16,128}$/.test(id))
    throw new AppError(401, 40106, '客户端标识缺失，请刷新页面后重新登录');
  // Classify on the server: changing a body field must not open another slot.
  const mobile = /Android|iPhone|iPad|iPod|Mobile|MiniProgram/i.test(req.get('User-Agent') ?? '');
  return { id, type: mobile ? 'mobile' : 'web' };
}
