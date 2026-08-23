import { pino } from 'pino';
import { config } from '../config';

/**
 * 结构化日志：生产输出 JSON（Docker stdout → 日志采集），开发输出可读格式。
 * 所有模块共享同一个 logger；用 child({ module }) 区分子系统。
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (config.nodeEnv === 'production' ? 'info' : 'debug'),
  base: { service: 'zhihu-bff', env: config.nodeEnv },
  ...(config.nodeEnv === 'production'
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }),
});

/** HTTP 请求日志中间件用（pino-http） */
export const httpLoggerOptions = {
  logger,
  // 不记录健康检查与静态资源，避免噪音
  autoLogging: { ignore: (req: { url?: string }) => /^\/(healthz|metrics|portal|landing|admin|leader|creator|manus-storage)/.test(req.url ?? '') },
  customLogLevel: (_req: unknown, res: { statusCode: number }, err: unknown) =>
    (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info') as 'error' | 'warn' | 'info',
};
