import { isStaffRole, type AuthUser } from '@zhihu-koc/shared-contracts/core'
import type { NavGroup, NavItem } from '@zhihu-koc/shared-components'
import { canAccessPath } from './access'
export function workspaceNavigation(user: AuthUser | null, hasBusiness: boolean): NavGroup[] {
  if (!user) return []
  const staff = isStaffRole(user.role), duty = user.role === 'operator' ? 'operations' : user.role === 'developer' ? 'all' : user.adminDuty ?? 'all'
  const items: NavItem[] = [{ key: 'home', label: '首页', path: '/dashboard' }]
  if (hasBusiness) {
    if (!staff) items.push({ key: 'hall', label: '任务大厅', path: '/task-hall' })
    if (!staff || duty !== 'finance') items.push({ key: 'tasks', label: staff ? '任务管理' : user.role === 'leader' ? '团队任务' : '我的任务', path: '/tasks' })
    if (user.role === 'leader' || staff && duty !== 'finance') items.push({ key: 'works', label: staff ? '作品管理' : '作品跟进', path: '/works' })
  }
  if (user.role === 'leader' || staff && duty !== 'finance') items.push({ key: 'team', label: staff ? '成员与团队' : '我的团队', path: '/team' })
  if (hasBusiness && (!staff || duty !== 'operations')) items.push({ key: 'finance', label: staff ? '财务' : '我的收益', path: staff ? '/finance' : '/income' })
  if (staff && duty !== 'operations') items.push({ key: 'rates', label: '计费规则', path: '/rates' })
  if (staff && duty !== 'finance') items.push({ key: 'projects', label: '项目设置', path: '/projects' })
  if (!staff) items.push({ key: 'academy', label: '学院', path: '/academy' })
  items.push({ key: 'me', label: '我的', path: '/me' })
  const groups: NavGroup[] = [{ label: '日常工作', items }]
  if (staff && duty === 'all') groups.push({ label: '系统', collapsed: true, items: [
    { key: 'roles', label: '账号与岗位', path: '/system/roles' },
    { key: 'announcements', label: '公告', path: '/system/announcements' },
    { key: 'audit', label: '审计日志', path: '/audit-log' },
    { key: 'monitor', label: '运维监控', path: '/system/monitor' },
    { key: 'database', label: '数据库状态', path: '/system/db' },
  ] })
  return groups.map(group => ({ ...group, items: group.items.filter(item => canAccessPath(user, item.path)) })).filter(group => group.items.length)
}

/** 手机底部标签栏：只给达人和团长，最多 5 个，标签用短名 */
export function mobileTabs(user: AuthUser | null, groups: NavGroup[]): NavItem[] {
  if (!user || isStaffRole(user.role)) return []
  const items = groups.flatMap(group => group.items)
  const order = user.role === 'leader' ? ['home', 'hall', 'team', 'finance', 'me'] : ['home', 'hall', 'tasks', 'finance', 'me']
  const short: Record<string, string> = { home: '首页', hall: '大厅', tasks: '任务', team: '团队', finance: '收益', me: '我的' }
  return order.flatMap(key => {
    const item = items.find(entry => entry.key === key)
    return item ? [{ ...item, label: short[key] ?? item.label }] : []
  })
}
