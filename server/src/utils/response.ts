import { Response } from 'express';
import { serialize } from './serialize';

export const ok = (res: Response, data: unknown, status = 200) =>
  res.status(status).json({ code: 0, data: serialize(data), message: 'ok' });

export const okList = (res: Response, list: unknown[], total: number, page: number, pageSize: number) =>
  ok(res, { list, total, page, pageSize });
