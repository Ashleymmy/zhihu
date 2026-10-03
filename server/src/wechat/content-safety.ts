import { createHash } from 'node:crypto';
import { AppError } from '../middleware/errors';
// Keep the cloud and server contract aligned; cross-runtime contract tests use
// both implementations. Cloud-generated proof is covered by the bridge HMAC.
const publicFields = new Set([
  'displayName',
  'name',
  'title',
  'keyword',
  'label',
  'intro',
  'description',
  'content',
  'message',
  'remark',
  'reason',
  'note',
  'courseName',
  'mediaAccount',
  'accountName',
]);
export function textsFor(path: string, method: string, data: Record<string, unknown>): string[] {
  if (!['POST', 'PUT', 'PATCH'].includes(method)) return [];
  if (path.startsWith('/core/auth/') && !['/core/auth/register', '/core/auth/profile'].includes(path)) return [];
  if (path.startsWith('/core/account-privacy/') || path.startsWith('/core/files/') || path.startsWith('/core/finance'))
    return [];
  const texts: string[] = [];
  function visit(value: unknown, depth: number) {
    if (depth > 8 || value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((v) => visit(v, depth + 1));
      return;
    }
    for (const [key, v] of Object.entries(value)) {
      if (publicFields.has(key) && typeof v === 'string' && v.trim()) texts.push(v.trim());
      else if (v && typeof v === 'object') visit(v, depth + 1);
    }
  }
  visit(data, 0);
  if (path === '/core/auth/register' && typeof data.username === 'string') texts.push(data.username.trim());
  return texts;
}
export function contentDigest(path: string, method: string, data: Record<string, unknown>) {
  return createHash('sha256')
    .update(JSON.stringify([path, method, textsFor(path, method, data)]))
    .digest('hex');
}
export function requireContentProof(body: {
  path: string;
  method: string;
  data: Record<string, unknown>;
  contentSafety?: { version: number; digest: string };
}) {
  if (!textsFor(body.path, body.method, body.data).length) return;
  if (
    body.contentSafety?.version !== 1 ||
    body.contentSafety.digest !== contentDigest(body.path, body.method, body.data)
  )
    throw new AppError(503, 50332, '内容安全服务尚未就绪，请稍后重试');
}
