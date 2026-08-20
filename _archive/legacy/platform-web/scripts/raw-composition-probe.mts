#!/usr/bin/env node

/**
 * 真实知乎 OpenAPI 作品链路诊断。
 * 使用字符串形式的精确 plan_id 创建 v2 作品，再查询作品列表；
 * 不打印 access_token、secret_key 或 signature。
 */

import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const CANONICAL_LIST_PATH = '/alliance/api/popularize_compositions';

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (!value || value.startsWith('--')) throw new Error(`缺少 --${name}`);
  return value;
}

function sanitize(raw: string): string {
  return raw
    .replace(/"access_token"\s*:\s*"[^"]*"/gu, '"access_token":"***"')
    .replace(/"signature"\s*:\s*"[^"]*"/gu, '"signature":"***"');
}

export function validateListPath(value: string): string {
  if (value !== CANONICAL_LIST_PATH) {
    throw new Error(`--list-path 只能是 ${CANONICAL_LIST_PATH}`);
  }
  return value;
}

async function loadRuntime() {
  const [{ config }, { injectSignParams }] = await Promise.all([
    import('../../server/src/config.ts'),
    import('../../server/src/sign/zhihu.ts'),
  ]);
  return { config, injectSignParams };
}

async function createComposition(runtime: Awaited<ReturnType<typeof loadRuntime>>) {
  const { config, injectSignParams } = runtime;
  const body = {
    plan_id: arg('plan-id'),
    channel_id: arg('channel-id'),
    media_type: arg('media-type', 'KOC定向'),
    media_account: arg('media-account', '知乎真实链路测试'),
    composition_type: Number(arg('composition-type', '0')),
    composition_sub_type: Number(arg('composition-sub-type', '11')),
    composition_url: arg('composition-url'),
    release_time: Number(arg('release-time', String(Math.floor(Date.now() / 1000) - 60))),
  };
  const signed = injectSignParams(body, config.zhihu.accessToken, config.zhihu.secretKey);
  const response = await fetch(`${config.zhihu.apiBase.replace(/\/$/u, '')}/alliance/api/popularize_composition/v2`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(signed),
  });
  const raw = await response.text();
  console.log(JSON.stringify({ operation: 'create', httpStatus: response.status, ok: response.ok, response: sanitize(raw) }, null, 2));
  return response.ok;
}

async function listCompositions(runtime: Awaited<ReturnType<typeof loadRuntime>>, listPath: string) {
  const { config, injectSignParams } = runtime;
  const params = injectSignParams({
    channel_id: arg('channel-id'),
    keyword: arg('keyword'),
    offset: 0,
    limit: 20,
  }, config.zhihu.accessToken, config.zhihu.secretKey);
  const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
  const response = await fetch(`${config.zhihu.apiBase.replace(/\/$/u, '')}${listPath}?${query}`);
  const raw = await response.text();
  console.log(JSON.stringify({ operation: 'list', httpStatus: response.status, ok: response.ok, response: sanitize(raw) }, null, 2));
  return response.ok;
}

async function main() {
  const listPath = validateListPath(arg('list-path', CANONICAL_LIST_PATH));
  const listOnly = process.argv.includes('--list-only');
  const runtime = await loadRuntime();
  const created = listOnly ? true : await createComposition(runtime);
  if (!listOnly) await delay(Number(arg('wait-ms', '3000')));
  const listed = await listCompositions(runtime, listPath);
  if (!created || !listed) process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
