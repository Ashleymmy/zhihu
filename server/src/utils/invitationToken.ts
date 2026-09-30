import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { config } from '../config';

// Domain-separated key; JWT secret rotation requires regenerating copyable links.
function key() {
  return Buffer.from(hkdfSync('sha256', config.jwt.secret, '', 'opc:invitation-link:v1', 32));
}
export function sealInvitationToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const content = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), content]).toString('base64');
}
export function openInvitationToken(value: string) {
  const data = Buffer.from(value, 'base64');
  const cipher = createDecipheriv('aes-256-gcm', key(), data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
}
