import {it,expect} from 'vitest'
import {fakeUser} from '@zhihu-koc/test-support'
import type {TeamMember} from '@zhihu-koc/shared-contracts/core'
import {canAccessPath} from '../src/access'
import {bindingLabel,matchesMiniFilter,miniFailureLabel} from '../src/mini-status'
it('monitor admits operations summaries without opening other system tools',()=>{
  for(const role of ['developer','admin','operator'] as const) expect(canAccessPath(fakeUser({role,permissions:['team.view']}),'/system/monitor')).toBe(true)
  for(const role of ['leader','creator'] as const) expect(canAccessPath(fakeUser({role,permissions:['team.view']}),'/system/monitor')).toBe(false)
  expect(canAccessPath(fakeUser({role:'admin',adminDuty:'finance',permissions:['team.view']}),'/system/monitor')).toBe(false)
  expect(canAccessPath(fakeUser({role:'operator',permissions:['team.view']}),'/system/db')).toBe(false)
})
it('member filters distinguish binding, usable projects and actual login sessions',()=>{
  const m={id:'1',role:'creator',isActive:true,projects:[{id:'1',isEnabled:false}],miniProgram:{bindingStatus:'bound',recentBindingConflict:false,sessions:[{type:'mini',state:'expired'}]}} as TeamMember
  expect(matchesMiniFilter(m,'bound')).toBe(true);expect(matchesMiniFilter(m,'no-project')).toBe(true);expect(matchesMiniFilter(m,'login-inactive')).toBe(true)
  expect(matchesMiniFilter({...m,projects:[{id:'1',name:'项目',isEnabled:true,memberRole:'member'}]},'no-project')).toBe(false)
  expect(matchesMiniFilter({...m,isActive:false},'no-project')).toBe(false)
  expect(matchesMiniFilter({...m,role:'operator'},'no-project')).toBe(false)
  expect(matchesMiniFilter({...m,miniProgram:undefined},'unbound')).toBe(false)
  expect(bindingLabel()).toBe('暂无绑定信息')
})
it('error descriptions do not confuse credential rejection with server outage',()=>{
  expect(miniFailureLabel(40908,409)).toBe('微信与账号绑定冲突')
  expect(miniFailureLabel(40101,401)).toBe('登录校验未通过')
  expect(miniFailureLabel(50000,500)).toBe('服务处理失败')
})
