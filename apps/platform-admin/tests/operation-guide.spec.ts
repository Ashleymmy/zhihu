import { describe, expect, it } from 'vitest'
import { zhihuOperationGuide } from '../../module-views/zhihu/operation-guide'

const user = { id: '7', role: 'creator', permissions: [] as string[] }
describe('operation guidance respects current responsibilities', () => {
  it('creators see their workflow without member or project management', () => {
    const guide = zhihuOperationGuide({ ...user, permissions: ['project.manage', 'team.view'] })!
    expect(guide.steps.map(s => s.id)).toEqual(['keyword', 'register', 'return'])
    expect(guide.steps[0]!.title).toBe('创建或领取关键词')
    expect(guide.management).toEqual([])
    expect(JSON.stringify(guide)).toContain('自主创建关键词')
    expect(zhihuOperationGuide({ ...user, parentId: '2' })!.steps[0]!.title).toBe('创建或接收关键词')
  })
  it('leaders and operators can assign member projects without managing project configuration', () => {
    for (const role of ['leader', 'operator']) {
      const guide = zhihuOperationGuide({ ...user, role, permissions: ['team.view', 'team.create_member'] })!
      const project = guide.management.find(c => c.id === 'projects')!
      expect(project.action).toEqual({ label: '分配成员项目', to: '/team' })
      expect(project.secondaryAction).toBeUndefined()
      if (role === 'leader') expect(project.description).toContain('自己已加入')
      expect(guide.management.map(c => c.id)).toEqual(['projects', 'members', 'distribute'])
    }
  })
  it('developers and full admins receive identical guidance', () => {
    const actor = { ...user, permissions: ['team.view', 'project.manage'] }
    const admin = zhihuOperationGuide({ ...actor, role: 'admin' })!
    const developer = zhihuOperationGuide({ ...actor, role: 'developer' })!
    expect(developer).toEqual(admin)
    expect(admin.management[0]!.action).toEqual({ label: '分配成员项目', to: '/team' })
    expect(admin.steps[0]!.title).toBe('创建关键词')
  })
  it('unknown roles and finance-only admins are not shown inaccessible operations', () => {
    expect(zhihuOperationGuide({ ...user, role: '' })).toBeNull()
    expect(zhihuOperationGuide({ ...user, role: 'admin', adminDuty: 'finance' })).toBeNull()
    const guide = zhihuOperationGuide({ ...user, role: 'leader' })!
    expect(guide.management.some(c => c.id === 'members')).toBe(false)
  })
  it('business links retain selected scope without altering core member routes', () => {
    const guide = zhihuOperationGuide({ ...user, role: 'admin', permissions: ['team.view', 'project.manage'] }, { projectId: '42', accountId: '8' })!
    for (const card of guide.steps) {
      const url = new URL(card.action!.to, 'http://example.test')
      expect(url.searchParams.get('projectId')).toBe('42')
      expect(url.searchParams.get('accountId')).toBe('8')
    }
    expect(guide.management[0]!.action!.to).toBe('/team')
    expect(guide.steps[2]!.secondaryAction!.to).toContain('tab=works')
    expect(guide.steps[2]!.instructions.join('')).toContain('不等于审核通过')
    expect(zhihuOperationGuide({ ...user, id: '8' })!.storageKey).not.toBe(zhihuOperationGuide(user)!.storageKey)
  })
})
