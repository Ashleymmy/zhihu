const test = require('node:test')
const assert = require('node:assert/strict')
const { memory } = require('./cloud-memory.cjs')
const { collections } = require('../cloudfunctions/opc-api/lib/store')

/**
 * storage-acceptance 是产出上线证据的工具（opc-admin 的 check-storage 动作）。
 * 它自己必须被测，尤其是两条性质：
 *   1. 隔离：不触碰真实业务记录
 *   2. 清理：**失败时也要删掉云存储对象与隔离记录** —— 它跑在真实环境上
 * 用内存数据库 + 云存储替身，不访问网络。
 */
function cloudDouble() {
  const objects = new Map()
  let sequence = 0
  return {
    objects,
    async uploadFile({ cloudPath, fileContent }) {
      const fileID = 'cloud://mock/' + cloudPath + '#' + ++sequence
      objects.set(fileID, Buffer.from(fileContent))
      return { fileID }
    },
    async downloadFile({ fileID }) {
      const content = objects.get(fileID)
      if (!content) throw new Error('cloud object not found: ' + fileID)
      return { fileContent: Buffer.from(content) }
    },
    async deleteFile({ fileList }) {
      return {
        fileList: fileList.map(fileID => ({ fileID, status: objects.delete(fileID) ? 0 : -1 }))
      }
    }
  }
}
const leftovers = f => {
  for (const name of collections) {
    const rows = f.dump(name).filter(row => row._qaRun)
    assert.equal(rows.length, 0, name + ' 残留了 ' + rows.length + ' 条隔离记录')
  }
}

test('storage acceptance completes the whole protocol and leaves nothing behind', async () => {
  const f = memory()
  const cloud = cloudDouble()
  const { run } = require('../cloudfunctions/opc-api/lib/storage-acceptance')
  await f.store.put('users', '1', { id: '1', username: 'untouched' })

  const result = await run(f.store, f.db, cloud)

  assert.equal(result.status, 'passed', JSON.stringify(result))
  assert.equal(result.chunks, 3, '应按 512 KiB 切成 3 片，含末片短片')
  assert.equal(result.checks.prepare, true)
  assert.equal(result.checks.chunks, true)
  assert.equal(result.checks.isolation, true, '归属隔离必须被验证')
  assert.equal(result.checks.finish, true)
  assert.equal(result.checks.readback, true, '必须从存储回读并比对哈希')
  assert.equal(result.checks.idempotency, true)
  assert.equal(result.checks.cleanup, true)

  // 真实数据未被触碰
  assert.equal((await f.store.get('users', '1')).username, 'untouched')
  leftovers(f)
  // 云存储对象全部删除
  assert.equal(cloud.objects.size, 0, '云存储对象必须全部删除')
})

test('a readback mismatch fails the run but cleanup still removes every object', async () => {
  const f = memory()
  const cloud = cloudDouble()
  const realDownload = cloud.downloadFile
  // 只破坏最终文件的回读（分片仍可正常读），以便走到 readback 这一步再失败。
  cloud.downloadFile = async arg =>
    String(arg.fileID).includes('server-uploads')
      ? { fileContent: Buffer.from('tampered') }
      : realDownload(arg)
  const { run } = require('../cloudfunctions/opc-api/lib/storage-acceptance')

  const result = await run(f.store, f.db, cloud)

  assert.equal(result.status, 'failed')
  assert.equal(result.checks.finish, true, '合并这一步本身应当是成功的')
  assert.equal(result.checks.readback, undefined, '回读校验不应通过')
  assert.equal(result.checks.cleanup, true, '失败时同样必须清理')
  assert.ok(result.diagnostic, '失败必须带诊断')
  assert.equal(cloud.objects.size, 0, '失败路径也必须删净云存储对象')
  leftovers(f)
})

test('an unwritable cloud storage is reported instead of throwing', async () => {
  const f = memory()
  const cloud = cloudDouble()
  cloud.uploadFile = async () => { throw new Error('storage permission denied') }
  const { run } = require('../cloudfunctions/opc-api/lib/storage-acceptance')

  const result = await run(f.store, f.db, cloud)

  assert.equal(result.status, 'failed')
  assert.equal(result.checks.prepare, true, 'prepare 只写数据库，应当先成功')
  assert.equal(result.checks.chunks, undefined)
  assert.equal(result.checks.cleanup, true)
  leftovers(f)
})

test('a second run is independent: new namespace, no cross-run interference', async () => {
  const f = memory()
  const cloud = cloudDouble()
  const { run } = require('../cloudfunctions/opc-api/lib/storage-acceptance')

  const first = await run(f.store, f.db, cloud)
  const second = await run(f.store, f.db, cloud)

  assert.equal(first.status, 'passed')
  assert.equal(second.status, 'passed')
  assert.notEqual(first.sha256, second.sha256, '每次应使用新的随机内容')
  assert.equal(cloud.objects.size, 0)
  leftovers(f)
})
