import { AppError } from '../../../middleware/errors';

export const TRUNCATED_SHARE_URL_MESSAGE = '分享链接不完整，请重新复制并粘贴完整链接后重试';

// Older native inputs cut pasted links at 140 characters. Match that observed
// failure only; do not rewrite opaque share tokens or infer a story from source.
export function isTruncatedShareUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.length !== 140) return false;
  try {
    const url = new URL(value);
    return ['soia.zhihu.com', 'oia.zhihu.com'].includes(url.hostname)
      && url.pathname === '/km_paid_content/share'
      && !url.searchParams.get('mst')?.trim();
  } catch {
    return false;
  }
}

export function assertCompleteShareUrl(value: string): void {
  if (isTruncatedShareUrl(value)) throw new AppError(422, 42201, TRUNCATED_SHARE_URL_MESSAGE);
}
