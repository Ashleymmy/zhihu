#!/usr/bin/env node
/**
 * 知乎联盟接口联调脚本
 * 用法: node liandiao.mjs
 *
 * ⚠️ 会消耗真实日配额（约 12 次），每天最多跑一次。
 * 凭证自动从 .env.local 读取，无需额外配置。
 */
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join }  from 'node:path'

const __dir = dirname(fileURLToPath(import.meta.url))

// ─── 1. 读取 .env.local ──────────────────────────────────────────────────────
function parseEnv(filePath) {
  try {
    return Object.fromEntries(
      readFileSync(filePath, 'utf-8')
        .replace(/\r\n/g, '\n')        // Windows CRLF
        .split('\n')
        .filter(l => l.includes('=') && !l.startsWith('#'))
        .map(l => {
          const idx = l.indexOf('=')
          return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().replace(/^["']|["']$/g, '')]
        })
    )
  } catch { return {} }
}

const env           = parseEnv(join(__dir, '.env.local'))
const ACCESS_TOKEN  = env.VITE_ACCESS_TOKEN  || ''
const SECRET_KEY    = env.VITE_SECRET_KEY    || ''
const CHANNEL_ID    = env.VITE_CHANNEL_ID    || ''

if (!ACCESS_TOKEN || !SECRET_KEY) {
  console.error('\n❌ .env.local 缺少 VITE_ACCESS_TOKEN 或 VITE_SECRET_KEY，请先配置。\n')
  process.exit(1)
}

const BASE = 'https://open.zhihu.com'
const EXCLUDED = ['offset','limit','file','image','second_channel_id','X-Requested-With','signature']

// ─── 2. 签名函数 ─────────────────────────────────────────────────────────────
function md5hex(str)      { return createHash('md5').update(str, 'utf8').digest('hex') }
function hmac256(str, key){ return createHmac('sha256', key).update(str, 'utf8').digest('hex') }

/** 正常签名（排除 EXCLUDED 字段） */
function sign(params, secretKey = SECRET_KEY) {
  const entries = Object.entries(params).filter(([k]) => !EXCLUDED.includes(k))
  entries.sort(([a], [b]) => a.localeCompare(b, 'en', { sensitivity: 'variant' }))
  const kvStr  = entries.map(([k, v]) => `${k}=${v}`).join('&')
  const md5Str = md5hex(kvStr)
  return hmac256(md5Str, secretKey)
}

/** 故意把某些 key 算进签名（用于边界测试） */
function signWith(params, includeKeys, secretKey = SECRET_KEY) {
  const entries = Object.entries(params).filter(([k]) => !['signature'].includes(k))
  // 把 includeKeys 留在里面（不排除）
  const base = entries.filter(([k]) => !EXCLUDED.includes(k) || includeKeys.includes(k))
  base.sort(([a], [b]) => a.localeCompare(b, 'en', { sensitivity: 'variant' }))
  const kvStr = base.map(([k, v]) => `${k}=${v}`).join('&')
  return hmac256(md5hex(kvStr), secretKey)
}

/** 构建带 access_token + timestamp + signature 的完整参数 */
function authParams(extra = {}) {
  const p = { access_token: ACCESS_TOKEN, timestamp: Math.floor(Date.now() / 1000), ...extra }
  return { ...p, signature: sign(p) }
}

// ─── 3. HTTP ──────────────────────────────────────────────────────────────────
async function get(path, params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, String(v)])
  ).toString()
  const url = BASE + path + (qs ? '?' + qs : '')
  try {
    const res  = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
    const text = await res.text()
    let data; try { data = JSON.parse(text) } catch { data = text }
    return { status: res.status, data }
  } catch (e) {
    return { status: 0, data: null, err: e.message }
  }
}

// ─── 4. 测试框架 ─────────────────────────────────────────────────────────────
const results = []
async function test(id, desc, fn) {
  process.stdout.write(`  ${id.padEnd(4)} ${desc.padEnd(48)}`)
  try {
    const { ok, actual, note } = await fn()
    const icon = ok ? '✅' : '⚠️ '
    console.log(icon + (note ? `  ${note}` : ''))
    results.push({ id, desc, ok, actual: typeof actual === 'object' ? JSON.stringify(actual).slice(0,160) : actual })
  } catch (e) {
    console.log('❌  ' + e.message)
    results.push({ id, desc, ok: false, actual: e.message })
  }
}

function isError(data)   { return !!(data?.error || data?.success === false) }
function getMsg(data)    { return data?.error?.message || data?.msg || '' }
function isArray(data)   { return Array.isArray(data) }

// ─── 5. 联调用例 ─────────────────────────────────────────────────────────────
console.log(`
${'─'.repeat(60)}
  知乎联盟接口联调脚本
  token   : ${ACCESS_TOKEN.slice(0,8)}…
  channel : ${CHANNEL_ID || '（未配置 VITE_CHANNEL_ID）'}
  ⚠️  每次运行消耗约 12 次日配额
${'─'.repeat(60)}

── 第一批：只读接口 ──────────────────────────────────────
`)

let channels = []

// T01 仅 access_token（不带签名）
await test('T01', '渠道列表  仅 access_token', async () => {
  const { data } = await get('/alliance/api/get_agent_channels', { access_token: ACCESS_TOKEN })
  if (isArray(data)) { channels = data; return { ok: true, note: `返回 ${data.length} 个渠道`, actual: data[0] } }
  return { ok: false, note: getMsg(data) || '非数组响应', actual: data }
})

// T02 带签名（应该也能通）
await test('T02', '渠道列表  带 signature', async () => {
  const { data } = await get('/alliance/api/get_agent_channels', authParams())
  if (isArray(data)) return { ok: true, note: '带签名也通过 ✓', actual: null }
  return { ok: false, note: getMsg(data), actual: data }
})

// T03 错误 token
await test('T03', '渠道列表  错误 access_token', async () => {
  const { data } = await get('/alliance/api/get_agent_channels', { access_token: 'INVALID_123' })
  if (isError(data)) return { ok: true, note: `code=${data?.error?.code}  ${getMsg(data)}`, actual: data?.error }
  return { ok: false, note: '期望鉴权错误，但请求成功了', actual: data }
})

// T04 推广任务列表
if (CHANNEL_ID) {
  await test('T04', '推广任务列表', async () => {
    const { data } = await get('/alliance/api/popularize_tasks', authParams({ channel_id: CHANNEL_ID }))
    const arr = data?.data ?? []
    return { ok: !isError(data), note: `${arr.length} 条任务，data 字段名为 'id'（不是 task_id）`, actual: arr[0] }
  })
} else {
  console.log('  T04  ⬜ 跳过（未配置 VITE_CHANNEL_ID）')
}

// T05 不存在的 channel_id
await test('T05', '推广任务  不存在 channel_id', async () => {
  const { data } = await get('/alliance/api/popularize_tasks', authParams({ channel_id: '0000000000000000000' }))
  if (isError(data)) return { ok: true, note: `code=${data?.error?.code}  ${getMsg(data)}`, actual: data?.error }
  return { ok: false, note: '期望错误，但请求成功了', actual: data }
})

// T06 带 offset/limit（不参与签名，应正常）
if (CHANNEL_ID) {
  await test('T06', '推广任务  带 offset/limit（不参与签名）', async () => {
    const p = { ...authParams({ channel_id: CHANNEL_ID }), offset: 0, limit: 5 }
    const { data } = await get('/alliance/api/popularize_tasks', p)
    return { ok: !isError(data), note: '带 offset/limit 仍有效 ✓', actual: null }
  })
}

// T07 把 limit 算进签名（应该失败）
if (CHANNEL_ID) {
  await test('T07', '推广任务  limit 算进签名 → 应失败', async () => {
    const base = { access_token: ACCESS_TOKEN, timestamp: Math.floor(Date.now()/1000), channel_id: CHANNEL_ID, limit: 5 }
    const wrongSig = signWith(base, ['limit'])   // 故意把 limit 纳入签名
    const { data } = await get('/alliance/api/popularize_tasks', { ...base, signature: wrongSig })
    if (isError(data)) return { ok: true, note: `符合预期：签名失败  ${getMsg(data)}`, actual: data?.error }
    return { ok: false, note: '期望签名失败，但请求成功—说明服务端也把 limit 算进去了', actual: data }
  })
}

// T08 榜单列表（裸数组，无外壳）
await test('T08', '榜单列表  响应是裸数组', async () => {
  const { data } = await get('/alliance/api/vip/content/rule/labels', { access_token: ACCESS_TOKEN })
  if (isArray(data)) return { ok: true, note: `裸数组 ✓  ${data.length} 个榜单`, actual: data[0] }
  if (isError(data)) return { ok: false, note: getMsg(data), actual: data?.error }
  return { ok: false, note: '非裸数组', actual: typeof data }
})

// T09 二代渠道
const firstChannel = channels[0]?.channel_id || CHANNEL_ID
if (firstChannel) {
  await test('T09', '二代渠道', async () => {
    const { data } = await get('/alliance/api/second_channels', authParams({ channel_id: firstChannel }))
    if (isError(data)) return { ok: false, note: getMsg(data), actual: data?.error }
    return { ok: true, note: `${data?.data?.length ?? 0} 个二代渠道`, actual: null }
  })
}

// T10 实时数据（time_range 在顶层）
await test('T10', '实时数据  time_range 在顶层而非 data 内', async () => {
  const p = authParams({ type: 1, time_scale: 1, fields: 'search_num,order_num' })
  const { data } = await get('/alliance/api/data_report/real_time_data', p)
  if (isError(data)) return { ok: false, note: getMsg(data), actual: data?.error }
  const hasTopLevel = 'time_range' in data && 'data' in data
  return {
    ok: hasTopLevel,
    note: hasTopLevel ? `time_range="${data.time_range}" ✓` : 'time_range 不在顶层',
    actual: { time_range: data?.time_range, rows: data?.data?.length }
  }
})

console.log('\n── 第二批：签名边界 ──────────────────────────────────────\n')

// S01 毫秒级 timestamp
await test('S01', '毫秒级 timestamp → timestamp 无效', async () => {
  const p = { access_token: ACCESS_TOKEN, timestamp: Date.now(), channel_id: firstChannel || '1' }
  const { data } = await get('/alliance/api/popularize_tasks', { ...p, signature: sign(p) })
  if (isError(data)) return { ok: true, note: `✓ ${getMsg(data)}`, actual: data?.error?.message }
  return { ok: false, note: '期望失败，但成功了', actual: data }
})

// S04 大写 MD5
if (CHANNEL_ID) {
  await test('S04', '大写 MD5 算签名 → 签名无效', async () => {
    const base = { access_token: ACCESS_TOKEN, timestamp: Math.floor(Date.now()/1000), channel_id: CHANNEL_ID }
    const entries = Object.entries(base).sort(([a],[b]) => a.localeCompare(b,'en',{sensitivity:'variant'}))
    const kvStr   = entries.map(([k,v])=>`${k}=${v}`).join('&')
    const wrongSig = hmac256(md5hex(kvStr).toUpperCase(), SECRET_KEY)   // 大写 MD5
    const { data } = await get('/alliance/api/popularize_tasks', { ...base, signature: wrongSig })
    if (isError(data)) return { ok: true, note: `✓ 大写 MD5 被拒  ${getMsg(data)}`, actual: null }
    return { ok: false, note: '期望签名失败，但请求成功了（服务端大小写不敏感？）', actual: data }
  })
}

// S05 second_channel_id 算进签名
if (CHANNEL_ID) {
  await test('S05', 'second_channel_id 算进签名 → 签名无效', async () => {
    const base = { access_token: ACCESS_TOKEN, timestamp: Math.floor(Date.now()/1000), channel_id: CHANNEL_ID, second_channel_id: '999' }
    const wrongSig = signWith(base, ['second_channel_id'])
    const { data } = await get('/alliance/api/popularize_tasks', { ...base, signature: wrongSig })
    if (isError(data)) return { ok: true, note: `✓ 服务端也排除了 second_channel_id  ${getMsg(data)}`, actual: null }
    return { ok: false, note: '请求成功—服务端可能忽略该字段', actual: data }
  })
}

// ─── 6. 汇总 ─────────────────────────────────────────────────────────────────
const ok  = results.filter(r => r.ok).length
const nok = results.filter(r => !r.ok).length

console.log(`
${'─'.repeat(60)}
  结果汇总：${ok} ✅  ${nok} ⚠️/❌  共 ${results.length} 条
${'─'.repeat(60)}

把以上 ✅/⚠️ 结果复制到 docs/05-测试文档.md §七 对应行的「实际」列，
⚠️ 的行需要人工判断后再填状态。

── 还需要你手动测试（UI 操作）──────────────────────────────
  W01-W08  写操作  → 打开 http://localhost:5173 用表单操作
  B01-B07  批量    → 需要先向知乎运营索取 Excel 模板文件
  F01-F09  文件/举报 → 用 InterceptView / RiskView 页面
`)
