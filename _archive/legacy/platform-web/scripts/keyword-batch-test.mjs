#!/usr/bin/env node

/**
 * 通过本地知乎 BFF 串行测试候选关键词。
 *
 * 默认只做 dry-run；真实创建必须显式传入 --real。
 * 脚本不读取、打印或直连知乎 access_token / secret_key。
 *
 * 示例：
 *   node scripts/keyword-batch-test.mjs --channel-id 123 --task-id 456 \
 *     --landing-url https://story.zhihu.com/manuscript/paid_column/xxx \
 *     --keywords "候选词一,候选词二,候选词三"
 *   node scripts/keyword-batch-test.mjs --real --stop-on-success ...
 */

import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'

const DEFAULT_BASE_URL = 'http://localhost:3000/api/v1'
const DEFAULT_POLL_INTERVAL_MS = 2_000
const DEFAULT_POLL_TIMEOUT_MS = 90_000
const DEFAULT_DELAY_MS = 500

function usage() {
  console.log(`
批量测试知乎推广关键词（默认 dry-run）

必填参数：
  --channel-id <id>       本地 BFF 中的渠道 ID
  --task-id <id>          本地 BFF 中的推广任务 ID
  --landing-url <url>     推广内容落地页
  --keywords <a,b,c>      候选关键词，逗号分隔

认证参数（也可使用环境变量）：
  --username <name>       BFF 用户名，默认 BFF_USERNAME
  --password <password>   BFF 密码，默认 BFF_PASSWORD
  --base-url <url>        BFF 地址，默认 BFF_BASE_URL 或 ${DEFAULT_BASE_URL}

执行参数：
  --real                  真实创建计划；不传则只检查参数与现有占用情况
  --stop-on-success       第一个知乎同步成功后停止
  --delay-ms <ms>         每次提交之间的间隔，默认 ${DEFAULT_DELAY_MS}
  --poll-ms <ms>          轮询同步间隔，默认 ${DEFAULT_POLL_INTERVAL_MS}
  --timeout-ms <ms>       单个计划等待同步的超时，默认 ${DEFAULT_POLL_TIMEOUT_MS}
  --help                  显示帮助

注意：--real 可能在知乎后台留下真实推广计划并消耗配额；脚本不会自动删除成功计划。
`)
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (item === '--help' || item === '-h') args.help = true
    else if (item === '--real' || item === '--stop-on-success') args[item.slice(2).replaceAll('-', '_')] = true
    else if (item.startsWith('--')) {
      const key = item.slice(2).replaceAll('-', '_')
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) throw new Error(`参数 ${item} 缺少值`)
      args[key] = value
      i += 1
    } else {
      throw new Error(`未知参数：${item}`)
    }
  }
  return args
}

function required(args, key, envKey) {
  const value = args[key] ?? process.env[envKey]
  if (!value) throw new Error(`缺少 ${key ? `--${key.replaceAll('_', '-')}` : envKey}`)
  return value
}

function numberArg(args, key, fallback) {
  const raw = args[key]
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) throw new Error(`参数 --${key.replaceAll('_', '-')} 必须是非负数字`)
  return Math.round(value)
}

function normalizeKeywords(raw) {
  const values = String(raw)
    .split(/[\n,，、]+/u)
    .map((value) => value.trim())
    .filter(Boolean)
  const unique = [...new Set(values)]
  if (!unique.length) throw new Error('至少提供一个候选关键词')
  if (unique.length > 100) throw new Error('单次最多测试 100 个候选关键词')
  return unique
}

function envelopeData(payload) {
  if (payload && typeof payload === 'object' && 'code' in payload) {
    if (payload.code !== 0) {
      const error = new Error(payload.message || 'BFF 请求失败')
      error.code = payload.code
      throw error
    }
    return payload.data
  }
  return payload
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl.replace(/\/$/u, '')}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  })
  let payload = null
  try { payload = await response.json() } catch { /* 非 JSON 错误由状态码描述 */ }
  if (!response.ok) {
    const error = new Error(payload?.message || `HTTP ${response.status}`)
    error.status = response.status
    error.code = payload?.code
    throw error
  }
  return envelopeData(payload)
}

function asList(data) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.list)) return data.list
  if (Array.isArray(data?.items)) return data.items
  if (Array.isArray(data?.data)) return data.data
  return []
}

function field(item, ...names) {
  for (const name of names) if (item?.[name] !== undefined && item?.[name] !== null) return item[name]
  return undefined
}

function formatError(error) {
  const parts = []
  if (error?.status) parts.push(`HTTP ${error.status}`)
  if (error?.code !== undefined) parts.push(`code ${error.code}`)
  if (error?.message) parts.push(error.message)
  return parts.join(' / ') || String(error)
}

async function login(baseUrl, username, password) {
  const data = await request(baseUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  const token = field(data, 'token', 'accessToken')
  if (!token) throw new Error('登录响应中没有 token')
  return token
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { usage(); return }

  const baseUrl = args.base_url || process.env.BFF_BASE_URL || DEFAULT_BASE_URL
  const username = required(args, 'username', 'BFF_USERNAME')
  const password = required(args, 'password', 'BFF_PASSWORD')
  const channelId = required(args, 'channel_id', 'ZHIHU_CHANNEL_ID')
  const taskId = required(args, 'task_id', 'ZHIHU_TASK_ID')
  const landingUrl = required(args, 'landing_url', 'ZHIHU_LANDING_URL')
  const keywords = normalizeKeywords(required(args, 'keywords', 'ZHIHU_TEST_KEYWORDS'))
  const delayMs = numberArg(args, 'delay_ms', DEFAULT_DELAY_MS)
  const pollMs = numberArg(args, 'poll_ms', DEFAULT_POLL_INTERVAL_MS)
  const timeoutMs = numberArg(args, 'timeout_ms', DEFAULT_POLL_TIMEOUT_MS)

  console.log(`[config] base=${baseUrl}; channel=${channelId}; task=${taskId}; candidates=${keywords.length}; mode=${args.real ? 'REAL' : 'DRY-RUN'}`)
  if (args.real) console.log('[warning] 将创建真实推广计划；成功计划不会自动删除。')

  const token = await login(baseUrl, username, password)
  const authHeaders = { Authorization: `Bearer ${token}` }
  const results = []

  for (const keyword of keywords) {
    const item = { keyword, status: 'pending' }
    try {
      const availability = await request(baseUrl, '/plans/check-keyword', {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ channelId, keyword }),
      })
      if (availability?.available === false) {
        item.status = 'occupied'
        item.detail = availability.occupiedBy ? `已被 ${availability.occupiedBy} 占用` : '本地已占用'
        results.push(item)
        console.log(`[skip] ${keyword}：${item.detail}`)
        continue
      }
      if (!args.real) {
        item.status = 'ready'
        results.push(item)
        console.log(`[ready] ${keyword}：本地未占用，可提交`)
        continue
      }

      const created = await request(baseUrl, '/plans', {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ taskId, channelId, keyword, landingUrl, popularizeType: 0 }),
      })
      item.id = String(created.id)
      item.status = 'local'
      console.log(`[submit] ${keyword}：计划 ${item.id} 已提交，等待知乎同步`)

      const startedAt = Date.now()
      while (Date.now() - startedAt < timeoutMs) {
        await delay(pollMs)
        const plan = await request(baseUrl, `/plans/${encodeURIComponent(item.id)}`, { headers: authHeaders })
        item.syncStatus = plan.syncStatus
        item.zhihuPlanId = plan.zhihuPlanId ?? null
        item.syncError = plan.syncError ?? null
        if (plan.syncStatus === 'synced' || plan.syncStatus === 'failed') break
      }
      if (item.syncStatus === 'synced') {
        item.status = 'success'
        console.log(`[success] ${keyword}：知乎计划 ${item.zhihuPlanId || '(已同步)'} `)
        results.push(item)
        if (args.stop_on_success) break
      } else if (item.syncStatus === 'failed') {
        item.status = 'rejected'
        console.log(`[rejected] ${keyword}：${item.syncError || '知乎拒绝或同步失败'}`)
        results.push(item)
      } else {
        item.status = 'timeout'
        console.log(`[timeout] ${keyword}：${timeoutMs} ms 内未完成同步`)
        results.push(item)
      }
    } catch (error) {
      item.status = 'error'
      item.detail = formatError(error)
      results.push(item)
      console.log(`[error] ${keyword}：${item.detail}`)
    }
    if (delayMs) await delay(delayMs)
  }

  console.log('\n结果汇总：')
  console.table(results)
  const success = results.filter((item) => item.status === 'success')
  console.log(`成功 ${success.length} / 测试 ${results.length}；${args.real ? '真实模式已完成。' : '当前为 dry-run，未创建真实计划。'}`)
  if (!success.length && args.real) process.exitCode = 2
}

main().catch((error) => {
  console.error(`[fatal] ${formatError(error)}`)
  usage()
  process.exitCode = 1
})
