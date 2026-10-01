const test = require('node:test')
const assert = require('node:assert/strict')
const { transactionConflict, transactionRetryable } = require('../cloudfunctions/opc-api/lib/store')

/**
 * -501001 是通用的 TCB_RESOURCE_SYSTEM_ERROR，单看错误码分不出具体故障。
 * 2026-09-18 隔离验收卡在 bindings/:id/assign 50000，诊断实测消息为：
 *   document.get:fail -501001 resource system error.
 *   [ResourceUnavailable.TransactionBusy] Transaction is busy.
 * 当时只把 TransactionConflict 当作可重试，于是这类瞬时失败直接抛出。
 * 这两组测试锁定「哪些能重试、哪些不能」，避免以后再漏。
 */
const busy = () => Object.assign(new Error(
  'document.get:fail -501001 resource system error. [ResourceUnavailable.TransactionBusy] Transaction is busy. Please check your request, but if the problem persists, contact us.'
), { errCode: -501001 })

test('a busy transaction is retryable', () => {
  assert.equal(transactionRetryable(busy()), true)
  assert.equal(transactionConflict(busy()), false, '忙碌不是写冲突，分类不能混')
})

test('a write conflict stays retryable', () => {
  for (const message of [
    'document.get:fail [ResourceUnavailable.TransactionConflict] conflict',
    'database transaction conflict',
    'write conflict detected',
    '事务冲突，请重试'
  ]) {
    const error = Object.assign(new Error(message), { errCode: -501001 })
    assert.equal(transactionRetryable(error), true, message)
    assert.equal(transactionConflict(error), true, message)
  }
})

test('unknown SYS_ERR failures are never retried', () => {
  // 通用系统错误可能意味着真实故障；盲目重试会掩盖问题并放大写入。
  for (const message of [
    'document.get:fail -501001 resource system error.',
    'database request failed',
    'collection not exists'
  ]) {
    assert.equal(transactionRetryable(Object.assign(new Error(message), { errCode: -501001 })), false, message)
  }
})

test('non-SYS_ERR failures are never retried', () => {
  const error = Object.assign(new Error('transaction is busy'), { errCode: -502001 })
  assert.equal(transactionRetryable(error), false, '只有 -501001 才需要靠消息细分')
})

test('a business fault is never retried', () => {
  const error = Object.assign(new Error('关键词不可领取或已被占用'), { status: 409, code: 40900 })
  assert.equal(transactionRetryable(error), false)
})
