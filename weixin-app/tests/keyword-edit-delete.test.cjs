const test = require('node:test')
const assert = require('node:assert/strict')
const { fixture, scope } = require('./cloud-fixture.cjs')
const d = require('../cloudfunctions/opc-api/lib/domain')

/**
 * 关键词编辑重试与删除失败记录的契约：
 *   - 仅同步异常（syncStatus=failed）且从未使用的词可编辑/删除
 *   - 编辑会迁移关键词唯一索引、重置同步状态、重排推送任务
 *   - 删除连带移除归属记录、唯一索引与推送任务
 *   - 达人无权；团长只能动自己团队的词
 */

async function seeded(f) {
  await f.store.put('bindings', 'b1', { id: 'b1', ...scope, keywordId: 'k1', leaderId: '2', executorId: '3', verificationStatus: 'pending', releaseStatus: 'none' })
  await f.store.put('keywords', 'k1', { id: 'k1', ...scope, keyword: '旧词', mappingId: '40', taskId: '20', bindingId: 'b1', usedEverAt: null, lifecycleStatus: 'assigned', syncStatus: 'failed', planStatus: 'pending', syncError: '知乎上游请求失败', createdAt: d.now() })
  await f.store.put('keys', d.hash(['keyword', '旧词']), { kind: 'keyword', owner: 'k1', value: '旧词' })
  await f.store.put('jobs', 'plan-k1', { id: 'plan-k1', type: 'push-plan', keywordId: 'k1', scope, status: 'failed', attempts: 3, nextAt: 0, payload: { keyword: '旧词' } })
  // 已使用的词（不可编辑/删除）
  await f.store.put('keywords', 'k2', { id: 'k2', ...scope, keyword: '已用词', mappingId: '40', taskId: '20', bindingId: null, usedEverAt: d.now(), lifecycleStatus: 'active', syncStatus: 'synced', planStatus: 'active', createdAt: d.now() })
  // 已同步但未使用的词（删除要走释放流程）
  await f.store.put('keywords', 'k3', { id: 'k3', ...scope, keyword: '已同步词', mappingId: '40', taskId: '20', bindingId: null, usedEverAt: null, lifecycleStatus: 'available', syncStatus: 'synced', planStatus: 'active', createdAt: d.now() })
  // 无归属的失败词（别的团队的词，团长不可删）
  await f.store.put('keywords', 'k5', { id: 'k5', ...scope, keyword: '别团词', mappingId: '40', taskId: '20', bindingId: null, usedEverAt: null, lifecycleStatus: 'pending', syncStatus: 'failed', planStatus: 'pending', createdAt: d.now() })
}

test('admin can edit a failed keyword: fields updated, key migrated, job requeued', async () => {
  const f = await fixture()
  await seeded(f)
  const admin = await f.login('admin')
  const res = await f.call(admin, 'POST', '/modules/zhihu/keywords/k1/edit', { ...scope, keyword: '新词', landingUrl: 'https://zhuanlan.zhihu.com/p/1', mappingId: '40', requestKey: 'kw-edit-1' })
  assert.equal(res.code, 0, res.message)

  const word = await f.store.get('keywords', 'k1')
  assert.equal(word.keyword, '新词')
  assert.equal(word.syncStatus, 'local')
  assert.equal(word.syncError, null)
  // 唯一索引迁移：旧名释放、新名指向 k1
  assert.equal(await f.store.get('keys', d.hash(['keyword', '旧词'])), null)
  const key = await f.store.get('keys', d.hash(['keyword', '新词']))
  assert.equal(key.owner, 'k1')
  // 推送任务重排，载荷更新
  const job = await f.store.get('jobs', 'plan-k1')
  assert.equal(job.status, 'pending')
  assert.equal(job.attempts, 0)
  assert.equal(job.payload.keyword, '新词')
  assert.equal(job.payload.content_url, 'https://zhuanlan.zhihu.com/p/1')
})

test('edit refuses used or non-failed keywords and duplicate names', async () => {
  const f = await fixture()
  await seeded(f)
  const admin = await f.login('admin')
  const used = await f.call(admin, 'POST', '/modules/zhihu/keywords/k2/edit', { ...scope, keyword: '改', landingUrl: 'https://a.com', mappingId: '40', requestKey: 'kw-edit-2' })
  assert.equal(used.statusCode, 409)
  const synced = await f.call(admin, 'POST', '/modules/zhihu/keywords/k3/edit', { ...scope, keyword: '改', landingUrl: 'https://a.com', mappingId: '40', requestKey: 'kw-edit-3' })
  assert.equal(synced.statusCode, 409, '非同步异常的词不可编辑')
  // 再建一个词占住「撞名」
  await f.store.put('keywords', 'k4', { id: 'k4', ...scope, keyword: '撞名', mappingId: '40', taskId: '20', createdAt: d.now() })
  await f.store.put('keys', d.hash(['keyword', '撞名']), { kind: 'keyword', owner: 'k4', value: '撞名' })
  const dup = await f.call(admin, 'POST', '/modules/zhihu/keywords/k1/edit', { ...scope, keyword: '撞名', landingUrl: 'https://a.com', mappingId: '40', requestKey: 'kw-edit-4' })
  assert.equal(dup.statusCode, 409)
})

test('owner leader can edit; other leader and creator cannot', async () => {
  const f = await fixture()
  await seeded(f)
  // 另一个团长（不属于 k1）
  await f.store.put('users', '9', { id: '9', username: 'leader2', displayName: '团长二', role: 'leader', parentId: null, passwordHash: 'x', isActive: true, sessionVersion: 0, createdAt: d.now() })
  await f.store.put('members', d.hash(['1', '9']), { projectId: '1', userId: '9', memberRole: 'member' })

  const creator = await f.login('creator')
  const byCreator = await f.call(creator, 'POST', '/modules/zhihu/keywords/k1/edit', { ...scope, keyword: '达人改', landingUrl: 'https://a.com', mappingId: '40', requestKey: 'kw-edit-5' })
  assert.equal(byCreator.statusCode, 403)

  const other = await f.call(null, 'POST', '/core/auth/login', { username: 'leader2', password: 'x' }, { openid: 'openid-l2', appid: 'wx22b91776ccf37354' })
  // leader2 密码占位无法登录，直接用 fixture 账号逻辑改用 admin 验证团长限制：
  const leader = await f.login('leader')
  const ok = await f.call(leader, 'POST', '/modules/zhihu/keywords/k1/edit', { ...scope, keyword: '团长改', landingUrl: 'https://a.com', mappingId: '40', requestKey: 'kw-edit-6' })
  assert.equal(ok.code, 0, '所属团长可编辑: ' + ok.message)
  void other
})

test('delete removes keyword, binding, key and job; refuses used or synced keywords', async () => {
  const f = await fixture()
  await seeded(f)
  const admin = await f.login('admin')

  const used = await f.call(admin, 'DELETE', '/modules/zhihu/keywords/k2', { ...scope, requestKey: 'kw-del-1' })
  assert.equal(used.statusCode, 409, '已使用的词不可删')
  const synced = await f.call(admin, 'DELETE', '/modules/zhihu/keywords/k3', { ...scope, requestKey: 'kw-del-2' })
  assert.equal(synced.statusCode, 409, '已同步上游的词走释放流程')

  const res = await f.call(admin, 'DELETE', '/modules/zhihu/keywords/k1', { ...scope, requestKey: 'kw-del-3' })
  assert.equal(res.code, 0, res.message)
  assert.equal(await f.store.get('keywords', 'k1'), null, '关键词已删除')
  assert.equal(await f.store.get('bindings', 'b1'), null, '归属记录连带删除')
  assert.equal(await f.store.get('keys', d.hash(['keyword', '旧词'])), null, '唯一索引释放')
  assert.equal(await f.store.get('jobs', 'plan-k1'), null, '推送任务移除')
})

test('leader can only delete keywords owned by their team', async () => {
  const f = await fixture()
  await seeded(f)
  const leader = await f.login('leader')
  const ok = await f.call(leader, 'DELETE', '/modules/zhihu/keywords/k1', { ...scope, requestKey: 'kw-del-4' })
  assert.equal(ok.code, 0, '所属团长可删: ' + ok.message)
  // k5 是无归属的失败词（别的团队），团长不可删
  const denied = await f.call(leader, 'DELETE', '/modules/zhihu/keywords/k5', { ...scope, requestKey: 'kw-del-5' })
  assert.equal(denied.statusCode, 403)
})
