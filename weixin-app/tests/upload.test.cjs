const test = require('node:test')
const assert = require('node:assert/strict')
const { harness } = require('./harness.cjs')

const CHUNK = 512 * 1024

/**
 * 用真实 harness 加载 miniprogram/utils/upload.js，并模拟云端三个接口。
 * 这些测试执行产品代码，不是对字面量的自我断言。
 */
function setup(options = {}) {
  const state = { chunks: [], finishes: 0, prepares: 0 }
  state.h = harness(call => {
    if (call.path === '/core/files/prepare') {
      state.prepares++
      if (options.onPrepare) return options.onPrepare(call.data, state)
      return {
        id: 'file-1',
        cloudPath: 'private/openid/report/file-1.xlsx',
        upload: {
          transport: 'cloud-function',
          chunkBytes: options.chunkBytes || CHUNK,
          maxBytes: options.maxBytes || 10 * 1024 * 1024
        }
      }
    }
    if (/\/upload-chunk$/.test(call.path)) {
      state.chunks.push(call.data)
      if (options.onChunk) return options.onChunk(call.data, state)
      return { id: 'file-1', index: call.data.index, received: true }
    }
    if (/\/finish-upload$/.test(call.path)) {
      state.finishes++
      if (options.onFinish) return options.onFinish(state)
      return { id: 'file-1', size: 0, sha256: 'sha', complete: true }
    }
    return {}
  })
  state.h.session()
  return state
}

/** 预置本地文件并让选择器返回它。declaredSize 用于模拟超出上限而不真的分配内存。 */
function pick(h, name, content, declaredSize) {
  const path = 'tmp/' + name
  h.files.set(path, content)
  h.wx.chooseMessageFile = async () => ({
    tempFiles: [{
      name,
      size: declaredSize === undefined ? content.length : declaredSize,
      path
    }]
  })
  return path
}

const load = h => h.load('utils/upload')
const scope = { projectId: '1', accountId: '10' }

test('a small file uploads as a single chunk and returns the file id', async () => {
  const s = setup()
  pick(s.h, 'report.xlsx', Buffer.alloc(100 * 1024, 1))

  const id = await load(s.h).upload(scope, 'report')

  assert.equal(id, 'file-1')
  assert.equal(s.prepares, 1)
  assert.equal(s.chunks.length, 1)
  assert.equal(s.chunks[0].index, 0)
  assert.equal(s.chunks[0].totalBytes, 100 * 1024)
  assert.equal(s.finishes, 1)
})

test('a multi-chunk file sends ascending indices with the same totalBytes', async () => {
  const s = setup()
  const size = CHUNK * 2 + 1234
  pick(s.h, 'big.xlsx', Buffer.alloc(size, 9))

  const id = await load(s.h).upload(scope, 'report')

  assert.equal(id, 'file-1')
  assert.deepEqual(s.chunks.map(c => c.index), [0, 1, 2])
  assert.ok(s.chunks.every(c => c.totalBytes === size))
  assert.equal(s.finishes, 1)
})

test('chunks reassemble to the exact original bytes with a short final chunk', async () => {
  const s = setup()
  const size = CHUNK * 2 + 1234
  const content = Buffer.alloc(size)
  for (let i = 0; i < size; i++) content[i] = i % 251
  pick(s.h, 'exact.xlsx', content)

  await load(s.h).upload(scope, 'report')

  const parts = s.chunks.map(c => Buffer.from(c.base64, 'base64'))
  assert.equal(parts[0].length, CHUNK)
  assert.equal(parts[1].length, CHUNK)
  assert.equal(parts[2].length, 1234)
  assert.ok(Buffer.concat(parts).equals(content))
})

test('each chunk stays within the cloud 720 KiB request budget', async () => {
  const s = setup()
  pick(s.h, 'budget.xlsx', Buffer.alloc(CHUNK, 2))

  await load(s.h).upload(scope, 'report')

  // 云端按 JSON.stringify(event.data).length 校验，上限 720 KiB。
  const payload = JSON.stringify(s.chunks[0]).length
  assert.ok(payload <= 720 * 1024, 'chunk payload ' + payload + ' exceeds 720 KiB')
})

test('a transient 5xx chunk failure is retried and then succeeds', async () => {
  let first = true
  const s = setup({
    onChunk: data => {
      if (data.index === 0 && first) {
        first = false
        return { http: 500, body: { code: 50000, message: '云服务暂时不可用' } }
      }
      return { id: 'file-1', index: data.index, received: true }
    }
  })
  pick(s.h, 'retry.xlsx', Buffer.alloc(2048, 3))

  const id = await load(s.h).upload(scope, 'report')

  assert.equal(id, 'file-1')
  assert.equal(s.chunks.length, 2, '同一分片被重发一次')
  assert.equal(s.chunks[0].base64, s.chunks[1].base64, '重发内容必须完全一致')
  assert.equal(s.finishes, 1)
})

test('a deterministic 413 is not retried', async () => {
  const s = setup({
    onChunk: () => ({ http: 413, body: { code: 41300, message: '请求过大，请分片上传文件' } })
  })
  pick(s.h, 'too-big.xlsx', Buffer.alloc(CHUNK, 4))

  await assert.rejects(
    load(s.h).upload(scope, 'report'),
    /第 1 片上传失败：请求过大/
  )
  assert.equal(s.chunks.length, 1, '确定性拒绝只尝试一次')
  assert.equal(s.finishes, 0)
})

test('a context change between chunks stops before the next chunk and skips merging', async () => {
  let active = true
  const s = setup({
    onChunk: (data) => {
      if (data.index === 1) active = false
      return { id: 'file-1', index: data.index, received: true }
    }
  })
  pick(s.h, 'switch.xlsx', Buffer.alloc(CHUNK * 3, 5))

  await assert.rejects(
    load(s.h).upload(scope, 'report', () => active),
    /页面或项目已变化，请重新操作/
  )

  assert.deepEqual(s.chunks.map(c => c.index), [0, 1], '检测到变化后不再发下一片')
  assert.equal(s.finishes, 0, '不得合并到错误项目')
})

test('a session change mid-upload is fatal and never retried', async () => {
  const s = setup({
    onChunk: (data) => {
      s.h.storage.set('zk_access_token', 'rotated-token')
      return { id: 'file-1', index: data.index, received: true }
    }
  })
  pick(s.h, 'session.xlsx', Buffer.alloc(CHUNK * 3, 6))

  await assert.rejects(
    load(s.h).upload(scope, 'report'),
    /会话已更新，请重新加载/
  )

  assert.equal(s.chunks.length, 1, '会话失效后不得重试')
  assert.equal(s.finishes, 0)
})

test('a 409 merge lease conflict is waited out and then succeeds', async () => {
  const s = setup({
    onFinish: state => state.finishes === 1
      ? { http: 409, body: { code: 40900, message: '文件正在合并，请稍后重试' } }
      : { id: 'file-1', size: 10, sha256: 'sha', complete: true }
  })
  pick(s.h, 'lease.xlsx', Buffer.alloc(1024, 7))

  const id = await load(s.h).upload(scope, 'report')

  assert.equal(id, 'file-1')
  assert.equal(s.finishes, 2, '合并冲突后重试一次')
})

test('a finish response without a file id is rejected without retrying', async () => {
  const s = setup({ onFinish: () => ({ complete: true }) })
  pick(s.h, 'malformed.xlsx', Buffer.alloc(1024, 8))

  await assert.rejects(
    load(s.h).upload(scope, 'report'),
    /云服务未返回文件标识/
  )
  assert.equal(s.finishes, 1)
})

test('an oversized report is rejected before any network call', async () => {
  const s = setup()
  pick(s.h, 'huge.xlsx', Buffer.alloc(16), 10 * 1024 * 1024 + 1)

  await assert.rejects(load(s.h).upload(scope, 'report'), /报表最大 10 MB/)

  assert.equal(s.prepares, 0)
  assert.equal(s.h.calls.length, 0)
})

test('alliance-xlsx uses the xlsx picker and the 10 MiB report limit', async () => {
  const s = setup()
  const size = 5 * 1024 * 1024 + 1
  let picked = null
  const path = 'tmp/union.xlsx'
  s.h.files.set(path, Buffer.alloc(size, 9))
  s.h.wx.chooseMessageFile = async options => {
    picked = options.extension
    return { tempFiles: [{ name: 'union.xlsx', size, path }] }
  }

  const id = await load(s.h).upload(scope, 'alliance-xlsx')

  assert.equal(id, 'file-1')
  assert.deepEqual([...picked], ['xlsx'], '联盟报表也是 XLSX，不能弹出图片选择器')
  assert.equal(s.chunks.length, Math.ceil(size / CHUNK), '超过 5 MiB 仍可上传')
})

test('payment-proof uses the image picker and enforces the 5 MiB limit', async () => {
  const s = setup()
  let picked = null
  const path = 'tmp/proof.png'
  s.h.files.set(path, Buffer.alloc(64, 7))
  s.h.wx.chooseMessageFile = async options => {
    picked = options.extension
    return { tempFiles: [{ name: 'proof.png', size: 5 * 1024 * 1024 + 1, path }] }
  }

  await assert.rejects(
    load(s.h).upload(scope, 'payment-proof'),
    /付款凭证最大 5 MB/
  )

  assert.deepEqual([...picked], ['png', 'jpg', 'jpeg', 'pdf'])
  assert.equal(s.prepares, 0)
})

test('a prepare without cloud-function transport falls back to client direct upload', async () => {
  let uploaded = null
  const s = setup({ onPrepare: () => ({ id: 'file-9', cloudPath: 'private/x/report/file-9.xlsx' }) })
  s.h.wx.cloud.uploadFile = async options => {
    uploaded = options
    return { fileID: 'cloud://env/private/x/report/file-9.xlsx' }
  }
  pick(s.h, 'direct.xlsx', Buffer.alloc(1024, 1))

  const id = await load(s.h).upload(scope, 'report')

  assert.equal(id, 'file-9')
  assert.equal(uploaded.cloudPath, 'private/x/report/file-9.xlsx')
  assert.equal(s.chunks.length, 0, '不得走分片接口')
  const complete = s.h.calls.find(c => c.path.endsWith('/complete'))
  assert.equal(complete.data.fileID, 'cloud://env/private/x/report/file-9.xlsx')
})

test('an empty file is rejected before any chunk is sent', async () => {
  const s = setup()
  pick(s.h, 'empty.xlsx', Buffer.alloc(0))

  await assert.rejects(load(s.h).upload(scope, 'report'), /文件内容为空/)

  assert.equal(s.chunks.length, 0)
  assert.equal(s.finishes, 0)
})

test('cancelling the picker aborts before any request', async () => {
  const s = setup()
  s.h.wx.chooseMessageFile = async () => ({ tempFiles: [] })

  await assert.rejects(load(s.h).upload(scope, 'report'), /尚未选择文件/)

  assert.equal(s.h.calls.length, 0)
})
