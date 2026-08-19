import { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: number,
    message: string,
    /** 附加到错误响应体的额外字段（如 50310 的 failedGates/requestId）。 */
    public readonly extras?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const asyncHandler =
  (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    void Promise.resolve(handler(req, res, next)).catch(next);

export const notFound: RequestHandler = (_req, _res, next) => next(new AppError(404, 40400, '接口不存在'));

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const bodyParserError = error as { status?: number; type?: string };
  if (
    error instanceof SyntaxError &&
    bodyParserError.status === 400 &&
    bodyParserError.type === 'entity.parse.failed'
  ) {
    res.status(400).json({ code: 40000, data: null, message: '请求体不是有效 JSON' });
    return;
  }
  if (error instanceof ZodError) {
    res.status(422).json({ code: 42200, data: null, message: '请求参数不正确' });
    return;
  }
  if (error instanceof AppError) {
    res.status(error.httpStatus).json({ code: error.code, data: null, message: error.message, ...error.extras });
    return;
  }
  if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
    res.status(409).json({ code: 40900, data: null, message: '记录已存在' });
    return;
  }
  if (process.env.NODE_ENV !== 'test') console.error('unhandled_error', error);
  else console.error('test_error', error);
  res.status(500).json({ code: 50000, data: null, message: '服务器内部错误' });
};
