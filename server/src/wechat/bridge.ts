import express, { type Express } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { db } from '../db';
import { asyncHandler, AppError } from '../middleware/errors';
import { setWechatContext } from './context';
import { observeMiniRequest } from './observability';

const envelopeSchema = z
  .object({
    appId: z.string().regex(/^wx[a-zA-Z0-9]{16}$/),
    openId: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/),
    path: z
      .string()
      .max(256)
      .regex(/^\/(core|modules\/zhihu)\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/),
    method: z.enum(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']),
    data: z.record(z.unknown()).default({}),
    token: z.string().max(4096).optional(),
    observation: z
      .object({
        environment: z
          .string()
          .max(80)
          .regex(/^[\w-]*$/)
          .optional(),
        version: z
          .string()
          .max(32)
          .regex(/^[\w.-]*$/)
          .optional(),
        clientVersion: z
          .string()
          .max(32)
          .regex(/^[\w.-]*$/)
          .optional(),
        clientEnv: z.enum(['develop', 'trial', 'release']).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export function verifyBridgeSignature(
  raw: Buffer,
  timestamp: string,
  nonce: string,
  signature: string,
  secret: string,
) {
  if (
    secret.length < 32 ||
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(Date.now() - Number(timestamp)) > 60000 ||
    !/^[a-f0-9]{32}$/.test(nonce) ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    throw new AppError(401, 40107, '小程序网关认证失败');
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}\n${nonce}\n`).update(raw).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex')))
    throw new AppError(401, 40107, '小程序网关认证失败');
}

/** Restore an authenticated cloud envelope to the ordinary website request pipeline. */
export function mountWechatBridge(app: Express) {
  const endpoint = '/api/v1/mini/bridge';
  app.use(express.raw({ type: (req) => req.url === endpoint, limit: '1mb' }));
  app.use(
    asyncHandler(async (req, res, next) => {
      if (req.path !== endpoint) return next();
      if (req.method !== 'POST' || !Buffer.isBuffer(req.body)) throw new AppError(405, 40500, '请求方式不支持');
      const secret = process.env.WECHAT_BRIDGE_SECRET ?? '';
      const appId = process.env.WECHAT_APP_ID ?? '';
      if (!secret || !appId) throw new AppError(503, 50300, '小程序接入尚未启用');
      const raw: Buffer = req.body;
      const nonce = req.get('X-Bridge-Nonce') ?? '';
      verifyBridgeSignature(raw, req.get('X-Bridge-Time') ?? '', nonce, req.get('X-Bridge-Signature') ?? '', secret);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString('utf8'));
      } catch {
        throw new AppError(400, 40000, '请求体不是有效 JSON');
      }
      const body = envelopeSchema.parse(parsed);
      if (body.appId !== appId || body.path.startsWith('/core/mini-'))
        throw new AppError(403, 40300, '小程序来源或接口不允许');
      try {
        await db.query('INSERT INTO wechat_bridge_nonces(nonce,expires_at) VALUES(?,TIMESTAMPADD(SECOND,120,NOW(3)))', [
          nonce,
        ]);
      } catch (e) {
        if ((e as { code?: string }).code === 'ER_DUP_ENTRY') throw new AppError(409, 40907, '请求已处理，请勿重放');
        throw e;
      }
      await db.query('DELETE FROM wechat_bridge_nonces WHERE expires_at<NOW(3) LIMIT 100');
      setWechatContext(req, { appId: body.appId, openId: body.openId });
      delete req.headers.cookie;
      delete req.headers.authorization;
      delete req.headers['x-client-id'];
      delete req.headers['content-length'];
      delete req.headers['idempotency-key'];
      if (body.token) req.headers.authorization = `Bearer ${body.token}`;
      req.headers['content-type'] = 'application/json';
      const specialAuth =
        /^\/core\/auth\/(login|register|bind|wechat-login|profile|registration-policy|registration-code|sms-policy|login-code|sms-login|phone-code|verify-phone)$/.test(
          body.path,
        );
      const path = specialAuth ? body.path.replace('/auth/', '/mini-auth/') : body.path;
      req.method = body.method;
      observeMiniRequest(req, res, body.path, body.observation);
      req.url = '/api/v1' + path;
      req.query = body.method === 'GET' ? (body.data as RequestQuery) : {};
      if (path === '/modules/zhihu/tasks/sync' && body.method === 'POST' && typeof body.data.channelId === 'string')
        req.query = { channelId: body.data.channelId };
      req.body = body.method === 'GET' ? {} : body.data;
      res.set('Cache-Control', 'no-store');
      const send = res.send.bind(res);
      res.send = (value: unknown) => {
        if (Buffer.isBuffer(value)) {
          const mimeType = String(res.getHeader('Content-Type') || 'application/octet-stream');
          const disposition = String(res.getHeader('Content-Disposition') || '');
          res.removeHeader('Content-Disposition');
          res.removeHeader('Content-Length');
          res.type('application/json');
          return res.json({
            code: 0,
            data: { base64: value.toString('base64'), mimeType, disposition },
            message: 'ok',
          });
        }
        return send(value);
      };
      next();
    }),
  );
}
type RequestQuery = import('express').Request['query'];
