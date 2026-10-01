const test = require('node:test')
const assert = require('node:assert/strict')
const { harness, deferred } = require('./harness.cjs')

/**
 * pages/team 此前只能新建成员和审核入团申请，不能改资料、重置密码、停用或删除。
 * 后端四个接口都已存在（PATCH / disable / reset-password / DELETE），这里锁定接线。
 */
const MEMBERS = [
  { id: '1', username: 'admin', displayName: '系统管理员', role: 'admin', adminDuty: 'all', phone: null, isActive: true, parentId: null },
  { id: '5', username: 'test2', displayName: '团长乙', role: 'leader', phone: '13800000000', isActive: true, parentId: '1' },
  { id: '4', username: 'pwtest', displayName: '离职成员', role: 'creator', phone: null, isActive: false, parentId: '5' }
]

function setup(options = {}) {
  const user = options.user || { id: '1', role: 'admin', adminDuty: 'all' }
  const state = { calls: [] }
  const h = harness(call => {
    if (call.path === '/core/auth/me') return user
    if (call.path === '/core/team/members') return MEMBERS.map(m=>({...m,canManage:m.id!==user.id,canAssignProjects:m.id!==user.id,projects:[]}))
    if (call.path === '/core/projects') return [{id:'1',name:'共享项目',isEnabled:true}]
    if (call.path === '/core/team/applications') return []
    // 与后端一致：手动指定密码时不返回临时密码，且不强制下次改密。
    if (call.path.endsWith('/reset-password'))
      return call.data.password
        ? { temporaryPassword: null, mustChangePwd: false }
        : { temporaryPassword: 'tmp-abc12345', mustChangePwd: true }
    if (call.path.endsWith('/disable')) return null
    if (call.method === 'DELETE') return { id: '4' }
    if (call.method === 'PATCH') return null
    if (call.method === 'POST') { state.calls.push(call); return { id: 'ok' } }
    state.calls.push(call)
    return { id: 'ok' }
  })
  h.session(user)
  state.h = h
  return state
}
async function open(options) {
  const built = setup(options)
  const page = built.h.page('team')
  await page.onShow()
  return Object.assign(built, { page })
}
const pick = (page, index) => page.manage({ currentTarget: { dataset: { index } } })
const writes = h => h.calls.filter(c => c.method !== 'GET')

test('managing a member prefills the form and marks the current account', async () => {
  const { page } = await open()

  pick(page, 0)
  assert.equal(page.data.selected, null, '当前登录账号不能通过成员编辑管理自己')

  pick(page, 1)
  assert.equal(page.data.selected.username, 'test2')
  assert.equal(page.data.selected.self, false)
  assert.equal(page.data.editPhone, '13800000000')

  page.closeManage()
  assert.equal(page.data.selected, null)
})

test('saveMember patches the exact member with trimmed values', async () => {
  const { h, page } = await open()
  pick(page, 1)
  page.setData({ editName: '  新姓名  ', editPhone: ' 13900000000 ' })

  await page.saveMember()

  const call = writes(h).find(c => c.method === 'PATCH')
  assert.equal(call.path, '/core/team/members/5/access')
  assert.equal(call.data.displayName, '新姓名')
  assert.equal(call.data.phone, '13900000000')
  assert.equal(page.data.selected, null)
})

test('saveMember refuses an empty name without sending a request', async () => {
  const { h, page } = await open()
  pick(page, 1)
  page.setData({ editName: '   ' })

  await page.saveMember()

  assert.equal(writes(h).some(c => c.method === 'PATCH'), false)
  assert.match(page.data.error, /请填写成员姓名/)
})

test('resetMemberPassword rejects a short manual password', async () => {
  const { h, page } = await open()
  pick(page, 1)
  page.setData({ resetPassword: 'short' })

  await page.resetMemberPassword()

  assert.equal(writes(h).some(c => c.path.endsWith('/reset-password')), false)
  assert.match(page.data.error, /密码至少 8 位/)
})

test('resetMemberPassword without a password surfaces the generated temporary one', async () => {
  const { h, page } = await open()
  pick(page, 1)
  page.setData({ resetPassword: '' })

  await page.resetMemberPassword()

  const call = writes(h).find(c => c.path.endsWith('/reset-password'))
  assert.equal(call.path, '/core/team/members/5/reset-password')
  assert.deepEqual({ ...call.data }, {}, '留空时不发送 password 字段，由服务端生成')
  assert.equal(page.data.credentials.username, 'test2')
  assert.equal(page.data.credentials.password, 'tmp-abc12345')
  assert.equal(page.data.selected, null, '关闭弹层让临时密码卡片可见')
})

test('resetMemberPassword sends a manual password when provided', async () => {
  const { h, page } = await open()
  pick(page, 1)
  page.setData({ resetPassword: '  a-longer-password  ' })

  await page.resetMemberPassword()

  const call = writes(h).find(c => c.path.endsWith('/reset-password'))
  assert.equal(call.data.password, 'a-longer-password')
  assert.equal(page.data.credentials, null, '手动指定密码时不产生临时密码')
})

test('disableMember asks for confirmation and does nothing when cancelled', async () => {
  const { h, page } = await open()
  h.wx.showModal = async () => ({ confirm: false })
  pick(page, 1)

  await page.disableMember()

  assert.equal(writes(h).some(c => c.path.endsWith('/disable')), false)
  assert.equal(page.data.selected.username, 'test2', '取消后保持弹层打开')
})

test('disableMember posts to the disable path after confirmation', async () => {
  const { h, page } = await open()
  pick(page, 1)

  await page.disableMember()

  const call = writes(h).find(c => c.path.endsWith('/disable'))
  assert.equal(call.path, '/core/team/members/5/disable')
  assert.equal(page.data.selected, null)
  assert.equal(page.data.notice, '账号已停用')
})

test('deleteMember uses DELETE with a request key because the backend mutates on it', async () => {
  const { h, page } = await open()
  pick(page, 2)

  await page.deleteMember()

  const call = writes(h).find(c => c.method === 'DELETE')
  assert.equal(call.path, '/core/team/members/4')
  assert.ok(call.data.requestKey, 'DELETE 走后端 mutate，必须带请求键')
  assert.equal(page.data.notice, '成员已删除')
})

test('deleteMember does nothing when cancelled', async () => {
  const { h, page } = await open()
  h.wx.showModal = async () => ({ confirm: false })
  pick(page, 2)

  await page.deleteMember()

  assert.equal(writes(h).some(c => c.method === 'DELETE'), false)
})

test('a leader sees only their own team and can manage members', async () => {
  const { h, page } = await open({ user: { id: '5', role: 'leader' } })

  assert.equal(page.data.allowed, true)
  assert.equal(page.data.isAdmin, false)
  assert.equal(page.data.members.length, 3)
  assert.equal(h.calls.some(c => c.path === '/core/team/members'), true)
})

test('a management action reloads the member list after succeeding', async () => {
  const { h, page } = await open()
  const before = h.calls.filter(c => c.path === '/core/team/members').length
  pick(page, 1)

  await page.saveMember()

  const after = h.calls.filter(c => c.path === '/core/team/members').length
  assert.equal(after, before + 1, '成功后必须刷新列表')
})

test('management actions are ignored while another write is in flight', async () => {
  const { h, page } = await open()
  page.setData({ busy: true })

  pick(page, 1)

  assert.equal(page.data.selected, null)
  assert.equal(writes(h).length, 0)
})
