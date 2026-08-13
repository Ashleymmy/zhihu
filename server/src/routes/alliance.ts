/**
 * 知乎联盟 API 透传路由
 * 挂载路径：/api/alliance/api
 *
 * 将前端的 /alliance/api/... 请求带签名转发到真实知乎 OpenAPI。
 * - GET / POST JSON / PUT JSON：完整透传，返回知乎原始响应
 * - multipart/form-data（文件上传）：返回 501，暂不支持，降级用 mock-server
 */
import axios, { type AxiosError } from 'axios';
import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware';
import { requirePermission } from '../auth/permissions';
import { asyncHandler } from '../middleware/errors';
import { config } from '../config';
import { injectSignParams } from '../sign/zhihu';
import { parseZhihuJson } from '../zhihu/json';

export const allianceRouter = Router();
allianceRouter.use(requireAuth);
allianceRouter.use(requirePermission('project.manage'));

const ZHIHU_BASE = config.zhihu.apiBase.replace(/\/$/, ''); // e.g. https://open.zhihu.com
const zhihuProxyClient = axios.create({ timeout: 15_000, transformResponse: [parseZhihuJson] });

function signParams(params: Record<string, unknown>): Record<string, unknown> {
  return injectSignParams(params, config.zhihu.accessToken, config.zhihu.secretKey);
}

/** 从上游响应中提取 JSON，失败时返回原始文本 */
async function proxyRequest(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  params: Record<string, unknown>,
  body?: Record<string, unknown>,
  res?: Response,
): Promise<void> {
  const url = `${ZHIHU_BASE}/alliance/api${path}`;
  try {
    let data: unknown;
    if (method === 'GET') {
      const signed = signParams(params);
      const resp = await zhihuProxyClient.get(url, { params: signed });
      data = resp.data;
    } else if (method === 'POST') {
      const signed = signParams(body ?? {});
      const resp = await zhihuProxyClient.post(url, signed);
      data = resp.data;
    } else {
      const signed = signParams(body ?? {});
      const resp = await zhihuProxyClient.put(url, signed);
      data = resp.data;
    }
    res!.json(data);
  } catch (err) {
    const axiosErr = err as AxiosError;
    if (axiosErr.response) {
      res!.status(axiosErr.response.status).json(axiosErr.response.data);
    } else {
      res!.status(502).json({ success: false, msg: '知乎服务暂时不可用', data: null });
    }
  }
}

// ── GET ────────────────────────────────────────────────────────
allianceRouter.get('/*', asyncHandler(async (req: Request, res: Response) => {
  await proxyRequest('GET', req.path, req.query as Record<string, unknown>, undefined, res);
}));

// ── POST (JSON only) ───────────────────────────────────────────
allianceRouter.post('/*', asyncHandler(async (req: Request, res: Response) => {
  if (req.is('multipart/form-data')) {
    // 文件上传暂不支持透传，前端降级使用 mock-server
    res.status(501).json({ success: false, msg: '文件上传透传暂未实现，请使用开发 mock-server', data: null });
    return;
  }
  await proxyRequest('POST', req.path, {}, req.body as Record<string, unknown>, res);
}));

// ── PUT (JSON only) ────────────────────────────────────────────
allianceRouter.put('/*', asyncHandler(async (req: Request, res: Response) => {
  await proxyRequest('PUT', req.path, {}, req.body as Record<string, unknown>, res);
}));
