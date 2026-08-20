#!/usr/bin/env node

/** 通过本地正式 BFF 验证：登录 -> 创建作品 -> 轮询同步 -> 查询作品列表。 */

import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  const value = index >= 0 ? process.argv[index + 1] : fallback
  if (!value || value.startsWith('--')) throw new Error(`缺少 --${name}`)
  return value
}

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  })
  const body = await response.json()
  if (!response.ok || body?.code && body.code !== 0) {
    throw new Error(`HTTP ${response.status} / code ${body?.code ?? '-'} / ${body?.message ?? '请求失败'}`)
  }
  return body?.code === 0 ? body.data : body
}

async function main() {
  const base = arg('base-url', 'http://127.0.0.1:3000')
  const username = arg('username')
  const password = arg('password')
  const planId = arg('plan-id')
  const channelId = arg('channel-id')
  const keyword = arg('keyword')
  const compositionUrl = arg('composition-url')
  const login = await request(base, '/api/v1/auth/login', {
    method: 'POST', body: JSON.stringify({ username, password }),
  })
  const headers = { Authorization: `Bearer ${login.token}` }
  const created = await request(base, '/api/v1/compositions', {
    method: 'POST', headers,
    body: JSON.stringify({
      planId,
      mediaType: 'KOC定向',
      mediaAccount: '知乎正式 BFF 链路测试',
      compositionType: 0,
      compositionSubType: 11,
      promoUrl: compositionUrl,
      releaseTime: new Date(Date.now() - 60_000).toISOString(),
    }),
  })

  let status
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await delay(500)
    status = await request(base, `/api/v1/compositions/${created.id}/audit-status`, { headers })
    if (status.syncStatus === 'synced' || status.syncStatus === 'failed') break
  }
  if (status?.syncStatus !== 'synced') {
    throw new Error(`作品 ${created.id} 同步状态：${status?.syncStatus ?? 'timeout'}`)
  }

  const query = new URLSearchParams({ channel_id: channelId, keyword, offset: '0', limit: '20' })
  const listed = await request(base, `/api/alliance/api/popularize_compositions?${query}`, { headers })
  const items = Array.isArray(listed?.data) ? listed.data : Array.isArray(listed) ? listed : []
  const matching = items.find((item) => item.composition_url === compositionUrl)
  if (!matching) throw new Error('v2 列表未找到刚同步的作品')

  console.log(JSON.stringify({
    localCompositionId: String(created.id),
    syncStatus: status.syncStatus,
    zhihuCompositionId: String(matching.composition_id),
    keyword: matching.keyword,
    compositionType: matching.composition_type,
    compositionSubType: matching.composition_sub_type,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
