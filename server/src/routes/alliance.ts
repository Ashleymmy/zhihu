/**
 * 知乎联盟 API 透传路由
 * 挂载路径：/api/alliance/api
 *
 * 将前端的 /alliance/api/... 请求带签名转发到真实知乎 OpenAPI。
 * - GET：带签名透传查询参数
 * - POST JSON：带签名透传 JSON body
 * - POST multipart/form-data：重建 FormData + Blob，添加 X-Requested-With 头
 * - PUT JSON：带签名透传 JSON body
 * - 二进制下载：白名单路径使用 arraybuffer responseType
 */
import axios, { type AxiosError } from 'axios';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { requireAuth } from '../auth/middleware';
import { requirePermission } from '../auth/permissions';
import { asyncHandler } from '../middleware/errors';
import { config } from '../config';
import { injectSignParams, buildSignature } from '../sign/zhihu';
import { parseZhihuJson } from '../zhihu/json';

export const allianceRouter = Router();
allianceRouter.use(requireAuth);
allianceRouter.use(requirePermission('project.manage'));

const ZHIHU_BASE = config.zhihu.apiBase.replace(/\/$/, ''); // e.g. https://open.zhihu.com
const zhihuProxyClient = axios.create({ timeout: 15_000, transformResponse: [parseZhihuJson] });

const upload = multer({ storage: multer.memoryStorage() });

// 允许返回二进制数据的路径白名单
const BINARY_DOWNLOAD_PATHS = ['/get_batch_task_result'];

function signParams(params: Record<string, unknown>): Record<string, unknown> {
  return injectSignParams(params, config.zhihu.accessToken, config.zhihu.secretKey);
}

/** 从上游响应中提取 JSON，失败时返回原始文本 */
async function proxyRequest(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  params: Record<string, unknown>,
  body?: Record<string, unknown>,
  files?: Express.Multer.File[],
  res?: Response,
): Promise<void> {
  const url = `${ZHIHU_BASE}/alliance/api${path}`;
  const isBinaryDownload = BINARY_DOWNLOAD_PATHS.some((p) => path.startsWith(p));

  try {
    let data: unknown;
    if (method === 'GET') {
      const signed = signParams(params);
      if (isBinaryDownload) {
        const resp = await axios.get(url, {
          params: signed,
          responseType: 'arraybuffer',
          transformResponse: [],
          timeout: 15_000,
        });
        data = resp.data;
      } else {
        const resp = await zhihuProxyClient.get(url, { params: signed });
        data = resp.data;
      }
    } else if (method === 'POST') {
      if (files && files.length > 0) {
        // multipart/form-data 透传
        const timestamp = Math.floor(Date.now() / 1000);
        const formParams: Record<string, unknown> = {
          ...body,
          access_token: config.zhihu.accessToken,
          timestamp,
        };
        const signature = buildSignature(formParams, config.zhihu.secretKey);

        const formData = new FormData();
        for (const [key, value] of Object.entries(formParams)) {
          formData.append(key, String(value));
        }
        formData.append('signature', signature);

        for (const file of files) {
          const blob = new Blob([new Uint8Array(file.buffer)], { type: file.mimetype });
          formData.append(file.fieldname, blob, file.originalname);
        }

        const resp = await axios.post(url, formData, {
          headers: { 'X-Requested-With': 'openApi' },
          timeout: 30_000,
          transformResponse: [parseZhihuJson],
        });
        data = resp.data;
      } else {
        // JSON 透传
        const signed = signParams(body ?? {});
        const resp = await zhihuProxyClient.post(url, signed);
        data = resp.data;
      }
    } else {
      const signed = signParams(body ?? {});
      const resp = await zhihuProxyClient.put(url, signed);
      data = resp.data;
    }

    if (isBinaryDownload && Buffer.isBuffer(data)) {
      res!.setHeader('Content-Type', 'application/octet-stream');
      res!.send(data);
    } else {
      res!.json(data);
    }
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
allianceRouter.get(
  '/*',
  asyncHandler(async (req: Request, res: Response) => {
    await proxyRequest('GET', req.path, req.query as Record<string, unknown>, undefined, undefined, res);
  }),
);

// ── POST ───────────────────────────────────────────────────────
allianceRouter.post(
  '/*',
  upload.any(),
  asyncHandler(async (req: Request, res: Response) => {
    const files = req.files as Express.Multer.File[] | undefined;
    await proxyRequest('POST', req.path, {}, req.body as Record<string, unknown>, files, res);
  }),
);

// ── PUT (JSON only) ────────────────────────────────────────────
allianceRouter.put(
  '/*',
  asyncHandler(async (req: Request, res: Response) => {
    await proxyRequest('PUT', req.path, {}, req.body as Record<string, unknown>, undefined, res);
  }),
);
