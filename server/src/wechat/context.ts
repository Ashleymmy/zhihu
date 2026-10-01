import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { AppError } from '../middleware/errors';

export interface WechatIdentity {
  appId: string;
  openId: string;
}
// Only the signature-verifying middleware can set this object. HTTP headers cannot.
const contexts = new WeakMap<Request, WechatIdentity>();
export const setWechatContext = (req: Request, context: WechatIdentity) => contexts.set(req, context);
export const wechatContext = (req: Request) => contexts.get(req);
export function requireWechatContext(req: Request): WechatIdentity {
  const context = wechatContext(req);
  if (!context) throw new AppError(403, 40300, '请从微信小程序访问');
  return context;
}
export const wechatClientId = (identity: WechatIdentity) =>
  createHash('sha256')
    .update(JSON.stringify([identity.appId, identity.openId]))
    .digest('hex');
