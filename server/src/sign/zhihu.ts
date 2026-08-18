import crypto from 'node:crypto';

export interface SignatureProfile {
  readonly excludedKeys: readonly string[];
}

export const DEFAULT_SIGNATURE_PROFILE: SignatureProfile = Object.freeze({
  excludedKeys: Object.freeze([
    'offset',
    'limit',
    'file',
    'image',
    'second_channel_id',
    'X-Requested-With',
    'signature',
  ]),
});

// 保留旧导出，调用方的实际签名行为改由 profile 决定。
export const SIGN_EXCLUDED_KEYS = DEFAULT_SIGNATURE_PROFILE.excludedKeys;

export interface SignatureTrace {
  kvStr: string;
  md5: string;
  signature: string;
}

export function buildSignatureTrace(
  params: Record<string, unknown>,
  secretKey: string,
  profile: SignatureProfile = DEFAULT_SIGNATURE_PROFILE,
): SignatureTrace {
  const kvStr = Object.keys(params)
    .filter((key) => !profile.excludedKeys.includes(key))
    .sort()
    .map((key) => `${key}=${String(params[key])}`)
    .join('&');
  const md5 = crypto.createHash('md5').update(kvStr, 'utf8').digest('hex');
  const signature = crypto.createHmac('sha256', secretKey).update(md5, 'utf8').digest('hex');
  return { kvStr, md5, signature };
}

export function buildSignature(
  params: Record<string, unknown>,
  secretKey: string,
  profile: SignatureProfile = DEFAULT_SIGNATURE_PROFILE,
): string {
  return buildSignatureTrace(params, secretKey, profile).signature;
}

export function injectSignParams(
  params: Record<string, unknown>,
  accessToken: string,
  secretKey: string,
  timestamp = Math.floor(Date.now() / 1000),
  profile: SignatureProfile = DEFAULT_SIGNATURE_PROFILE,
) {
  const withMeta = { ...params, access_token: accessToken, timestamp };
  return { ...withMeta, signature: buildSignature(withMeta, secretKey, profile) };
}
