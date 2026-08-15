import crypto from 'node:crypto';

export const SIGN_EXCLUDED_KEYS = [
  'offset',
  'limit',
  'file',
  'image',
  'second_channel_id',
  'X-Requested-With',
  'signature',
] as const;

export interface SignatureTrace {
  kvStr: string;
  md5: string;
  signature: string;
}

export function buildSignatureTrace(params: Record<string, unknown>, secretKey: string): SignatureTrace {
  const kvStr = Object.keys(params)
    .filter((key) => !SIGN_EXCLUDED_KEYS.includes(key as (typeof SIGN_EXCLUDED_KEYS)[number]))
    .sort()
    .map((key) => `${key}=${String(params[key])}`)
    .join('&');
  const md5 = crypto.createHash('md5').update(kvStr, 'utf8').digest('hex');
  const signature = crypto.createHmac('sha256', secretKey).update(md5, 'utf8').digest('hex');
  return { kvStr, md5, signature };
}

export function buildSignature(params: Record<string, unknown>, secretKey: string): string {
  return buildSignatureTrace(params, secretKey).signature;
}

export function injectSignParams(
  params: Record<string, unknown>,
  accessToken: string,
  secretKey: string,
  timestamp = Math.floor(Date.now() / 1000),
) {
  const withMeta = { ...params, access_token: accessToken, timestamp };
  return { ...withMeta, signature: buildSignature(withMeta, secretKey) };
}
