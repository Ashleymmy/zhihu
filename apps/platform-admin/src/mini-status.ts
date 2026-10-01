import type { TeamMember, MemberMiniProgram } from '@zhihu-koc/shared-contracts/core'
export const bindingLabel = (mini?: MemberMiniProgram) => !mini ? '暂无绑定信息' : ({bound:'已绑定微信',unbound:'未绑定微信',not_configured:'接入未配置'})[mini.bindingStatus]
export const clientLabel = {web:'电脑浏览器',mobile:'移动浏览器',mini:'微信小程序'}
export const sessionLabel = {none:'未登录过',valid:'会话有效',expired:'会话已过期',revoked:'会话已撤销'}
export const miniFilters = [
  {value:'bound',label:'已绑定微信'}, {value:'unbound',label:'未绑定微信'},
  {value:'no-project',label:'已绑定 · 待分配项目'}, {value:'conflict',label:'近期绑定冲突'},
  {value:'login-inactive',label:'已绑定 · 需重新登录'},
]
export function matchesMiniFilter(member: TeamMember, filter: string) {
  const mini=member.miniProgram
  if (!filter) return true
  if (!mini) return false
  if (filter==='bound'||filter==='unbound') return mini.bindingStatus===filter
  if (filter==='conflict') return mini.recentBindingConflict
  if (filter==='no-project') return mini.bindingStatus==='bound' && member.isActive && member.role==='creator' && !member.projects?.some(p=>p.isEnabled)
  if (filter==='login-inactive') return mini.bindingStatus==='bound' && member.isActive && !mini.sessions.some(s=>s.type==='mini'&&s.state==='valid')
  return false
}
export function miniFailureLabel(code: number, status: number) {
  if (code===40908) return '微信与账号绑定冲突'
  if (status>=500) return '服务处理失败'
  if (status===401) return '登录校验未通过'
  if (status===403) return '权限或账号状态限制'
  if (status===404) return '记录或接口不存在'
  if (status===409) return '状态冲突，请核对操作'
  if (status===422) return '提交信息未通过校验'
  if (status===429) return '请求过于频繁'
  return '请求未完成'
}
