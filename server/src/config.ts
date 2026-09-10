import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().default('opc'),
  DB_USER: z.string().default('opc'),
  DB_PASS: z.string().default(''),
  JWT_SECRET: z.string().min(32).default('test_only_jwt_secret_at_least_32_chars'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(90).default(14),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  QUEUE_DRIVER: z.enum(['bull', 'memory']).default('memory'),
  OPC_MODULES: z.string().default(''),
  TZ: z.string().default('Asia/Shanghai'),
});
export function parseEnvironment(input: NodeJS.ProcessEnv) {
  const parsed = schema.parse(input);
  if (parsed.NODE_ENV === 'production' && parsed.JWT_SECRET.startsWith('test_only_'))
    throw new Error('生产环境缺少安全配置');
  const modules = parsed.OPC_MODULES.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (new Set(modules).size !== modules.length || modules.some((s) => !/^[a-z][a-z0-9-]*$/.test(s)))
    throw new Error('模块标识格式错误或重复');
  return parsed;
}
const env = parseEnvironment(process.env);
export const config = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  db: { host: env.DB_HOST, port: env.DB_PORT, database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASS },
  jwt: { secret: env.JWT_SECRET, expiresIn: env.JWT_EXPIRES_IN },
  auth: { refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS },
  enabledModules: env.OPC_MODULES.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  redisUrl: env.REDIS_URL,
  queueDriver: env.QUEUE_DRIVER,
  timezone: env.TZ,
} as const;
export type AppConfig = typeof config;
