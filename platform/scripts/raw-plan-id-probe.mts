#!/usr/bin/env node

/**
 * 真实知乎 OpenAPI 诊断：保留推广计划创建接口的原始 JSON 文本，
 * 用于确认 16 位以上 Snowflake ID 是否被 JavaScript JSON.parse 截断。
 *
 * 脚本只打印请求结果与 ID 对比，不打印 access_token、secret_key 或 signature。
 */

import process from 'node:process';
import { config } from '../../server/src/config.ts';
import { injectSignParams } from '../../server/src/sign/zhihu.ts';

const API_PATH = '/alliance/api/popularize_plan';

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (!value || value.startsWith('--')) throw new Error(`缺少 --${name}`);
  return value;
}

function extractRawId(raw: string): string | null {
  const match = raw.match(/"(?:plan_id|planId|id)"\s*:\s*(?:"(\d+)"|(\d+))/u);
  return match?.[1] ?? match?.[2] ?? null;
}

function parsedId(raw: string): string | null {
  const value = JSON.parse(raw) as Record<string, unknown>;
  const data = (value.data ?? value) as Record<string, unknown>;
  const id = data.plan_id ?? data.planId ?? data.id;
  return id == null ? null : String(id);
}

async function main() {
  const body = {
    task_id: arg('task-id'),
    channel_id: arg('channel-id'),
    content_url: arg('content-url'),
    popularize_type: Number(arg('popularize-type', '0')),
    keyword: arg('keyword'),
  };
  const signed = injectSignParams(body, config.zhihu.accessToken, config.zhihu.secretKey);
  const response = await fetch(`${config.zhihu.apiBase.replace(/\/$/u, '')}${API_PATH}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(signed),
  });
  const raw = await response.text();
  const exactId = extractRawId(raw);
  let normalId: string | null = null;
  try { normalId = parsedId(raw); } catch { /* 原始响应不是 JSON */ }

  console.log(JSON.stringify({
    httpStatus: response.status,
    ok: response.ok,
    exactPlanId: exactId,
    parsedPlanId: normalId,
    precisionLost: exactId != null && normalId != null && exactId !== normalId,
    rawResponse: raw,
  }, null, 2));
  if (!response.ok || !exactId) process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
