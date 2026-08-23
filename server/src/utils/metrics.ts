import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';
import type { RequestHandler } from 'express';

/** Prometheus 指标注册表（全局单例） */
export const register = new Registry();
collectDefaultMetrics({ register });

/** HTTP 请求计数 */
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [register],
});

/** HTTP 请求耗时 */
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

/** 队列任务计数 */
export const jobsTotal = new Counter({
  name: 'queue_jobs_total',
  help: 'Queue jobs processed',
  labelNames: ['job', 'result'] as const,
  registers: [register],
});

/** 规范化路由模板，避免高基数（/plans/123 → /plans/:id） */
function normalizeRoute(url: string): string {
  return url
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/\?.*$/, '');
}

/** Express 中间件：记录请求计数与耗时 */
export const metricsMiddleware: RequestHandler = (req, res, next) => {
  if (req.path === '/metrics') return next();
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const route = normalizeRoute(req.path);
    httpRequestsTotal.inc({ method: req.method, route, status: res.statusCode });
    end({ method: req.method, route, status: res.statusCode });
  });
  next();
};

/** /metrics 处理器 */
export const metricsHandler: RequestHandler = async (_req, res) => {
  res.setHeader('Content-Type', register.contentType);
  res.end(await register.metrics());
};
