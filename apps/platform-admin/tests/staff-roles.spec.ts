import {describe,it,expect} from 'vitest'
import {createSSRApp} from 'vue'
import {renderToString} from 'vue/server-renderer'
import StaffManager from '../../../packages/shared-components/src/StaffManager.vue'
describe('创建管理账号的角色选项',()=>{
  it('开发者可以创建三种管理角色，管理员只显示运营管理员',async()=>{
    const http={} as any
    const developer=await renderToString(createSSRApp(StaffManager,{http,actorRole:'developer'}))
    const admin=await renderToString(createSSRApp(StaffManager,{http,actorRole:'admin'}))
    expect(developer).toContain('value="developer"')
    expect(developer).toContain('value="admin"')
    expect(developer).toContain('value="operator"')
    expect(admin).toContain('value="operator"')
    expect(admin).not.toContain('value="developer"')
    expect(admin).not.toContain('value="admin"')
  })
})
