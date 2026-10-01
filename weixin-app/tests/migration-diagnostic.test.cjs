const test = require('node:test')
const assert = require('node:assert/strict')
const { diagnostic } = require('../cloudfunctions/opc-api/lib/migration-diagnostic')

/**
 * 诊断里的 sdkMessage 只在隔离验收阶段出现（合成的、已脱敏）。
 * 这里锁定阶段匹配规则，因为写错正则是**静默失效**：
 * 2026-09-18 曾写成 /^acceptance\.(?:transaction|api)\./，但 api.js 用的是
 * 'acceptance.api:<path>'（冒号）而非点号，导致 API 失败的 sdkMessage 一直缺失，
 * 验收只能报一个裸的 50000，查了很久才定位。
 */
function errorWith(message, extras = {}) {
  return Object.assign(new Error(message), extras)
}

test('api phases carry the sdk message, colon separator included', () => {
  const info = diagnostic(errorWith('document.get:fail something broke', { errCode: -501001 }), 'acceptance.api:/modules/zhihu/keywords/50/claim')
  assert.equal(info.phase, 'acceptance.api:/modules/zhihu/keywords/50/claim')
  assert.equal(info.sdkCode, -501001)
  assert.equal(info.sdkMessage, 'document.get:fail something broke')
})

test('transaction phases carry the sdk message, dot separator', () => {
  const info = diagnostic(errorWith('database transaction conflict', { errCode: -501001 }), 'acceptance.transaction.single-update')
  assert.equal(info.sdkMessage, 'database transaction conflict')
  assert.equal(info.category, 'transaction-conflict', '冲突文案必须被识别为可重试的冲突')
})

test('ordinary phases never attach a message', () => {
  for (const phase of ['business.operations', 'acceptance.function:opc-api', 'migration.seal']) {
    const info = diagnostic(errorWith('secret bearer token leaked here'), phase)
    assert.equal('sdkMessage' in info, false, phase + ' 不应携带消息')
  }
})

test('probe messages are redacted before they leave the function', () => {
  const previous = process.env.OPC_MIGRATION_SECRET
  process.env.OPC_MIGRATION_SECRET = 'a'.repeat(64)
  try {
    const info = diagnostic(
      errorWith('failed for secret ' + 'a'.repeat(64) + ' at https://example.com/x?token=1 id 550e8400-e29b-41d4-a716-446655440000'),
      'acceptance.api:/core/finance/funding',
    )
    assert.equal(info.sdkMessage.includes('a'.repeat(64)), false, '环境密钥必须被替换')
    assert.equal(info.sdkMessage.includes('https://example.com'), false, 'URL 必须被替换')
    assert.equal(info.sdkMessage.includes('550e8400-e29b-41d4-a716-446655440000'), false, 'UUID 必须被替换')
  } finally {
    if (previous === undefined) delete process.env.OPC_MIGRATION_SECRET
    else process.env.OPC_MIGRATION_SECRET = previous
  }
})

test('probe messages are bounded so one failure cannot bloat the record', () => {
  // 用短词拼长文本：连续 24 位以上的字母数字会被脱敏成 [id]，那样就测不到截断了。
  const info = diagnostic(errorWith('ab '.repeat(2000)), 'acceptance.api:/core/finance/funding')
  assert.equal(info.sdkMessage.length, 800)
})

test('a generic SYS_ERR is not mistaken for a retryable conflict', () => {
  // -501001 是通用的 TCB_RESOURCE_SYSTEM_ERROR，不必然是事务冲突。
  // 只有消息明确表示冲突时才允许重试，否则会掩盖真实故障。
  const info = diagnostic(errorWith('document.get:fail resource system error', { errCode: -501001 }), 'acceptance.api:/modules/zhihu/keywords/50/claim')
  assert.equal(info.sdkCode, -501001)
  assert.notEqual(info.category, 'transaction-conflict')
})
