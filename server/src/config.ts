import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().default('zhihu_koc'),
  DB_USER: z.string().default('zhihu'),
  DB_PASS: z.string().default('zhihu_local_password'),
  JWT_SECRET: z.string().min(32).default('test_only_jwt_secret_at_least_32_chars'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  DEFAULT_PROJECT_ID: z.coerce.number().int().positive().default(1),
  ZHIHU_ACCESS_TOKEN: z.string().default('mock_access_token'),
  ZHIHU_SECRET_KEY: z.string().default('mock_secret_key'),
  ZHIHU_API_BASE: z.string().url().default('https://open.zhihu.com'),
  CALLBACK_SECRET_ENCRYPTION_KEY: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .default('0'.repeat(64)),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  QUEUE_DRIVER: z.enum(['bull', 'memory']).default('memory'),
  TZ: z.string().default('Asia/Shanghai'),
});

function validateZhihuApiBase(value: string): string {
  if (value !== 'https://open.zhihu.com' && value !== 'https://open.zhihu.com/') {
    throw new Error('知乎 API 地址必须固定为 https://open.zhihu.com');
  }
  return value.replace(/\/$/u, '');
}

export function parseEnvironment(input: NodeJS.ProcessEnv) {
  const parsed = envSchema.parse(input);
  parsed.ZHIHU_API_BASE = validateZhihuApiBase(parsed.ZHIHU_API_BASE);
  if (parsed.NODE_ENV === 'production') {
    const unsafe = [
      parsed.JWT_SECRET.startsWith('test_only_'),
      parsed.ZHIHU_ACCESS_TOKEN === 'mock_access_token',
      parsed.ZHIHU_SECRET_KEY === 'mock_secret_key',
      /^0+$/.test(parsed.CALLBACK_SECRET_ENCRYPTION_KEY),
    ];
    if (unsafe.some(Boolean)) throw new Error('生产环境缺少安全配置');
  }
  return parsed;
}

const env = parseEnvironment(process.env);

export const config = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  db: { host: env.DB_HOST, port: env.DB_PORT, database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASS },
  jwt: { secret: env.JWT_SECRET, expiresIn: env.JWT_EXPIRES_IN },
  defaultProjectId: env.DEFAULT_PROJECT_ID,
  zhihu: { accessToken: env.ZHIHU_ACCESS_TOKEN, secretKey: env.ZHIHU_SECRET_KEY, apiBase: env.ZHIHU_API_BASE },
  callbackEncryptionKey: Buffer.from(env.CALLBACK_SECRET_ENCRYPTION_KEY, 'hex'),
  redisUrl: env.REDIS_URL,
  queueDriver: env.QUEUE_DRIVER,
  timezone: env.TZ,
} as const;

export type AppConfig = typeof config;
