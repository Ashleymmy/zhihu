<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AuditLogItem } from '@zhihu-koc/shared-contracts'
import { useAuthStore, apis } from '../stores/auth'

const auth = useAuthStore()
const logs = ref<AuditLogItem[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(true)
const error = ref('')

const actions = ref<string[]>([])
const selectedAction = ref('')
const searchUser = ref('')
const dateRange = ref({ start: '', end: '' })

const ACTION_LABELS: Record<string, string> = {
  'auth.login': '登录',
  'auth.logout': '退出登录',
  'auth.change_password': '修改密码',
  'user.create': '创建成员',
  'user.update': '修改成员',
  'user.reset_pwd': '重置密码',
  'user.disable': '禁用成员',
  'user.delete': '删除成员',
  'team.apply': '申请入团',
  'team.application_approve': '通过入团',
  'team.application_reject': '驳回入团',
  'team.application_cancel': '撤回申请',
  'plan.create': '创建计划',
  'plan.update': '更新计划',
  'plan.delete': '删除计划',
  'composition.create': '登记作品',
  'composition.update': '更新作品',
  'finance.rule_create': '新建定价规则',
  'finance.rule_disable': '停用定价规则',
  'finance.batch_create': '创建结算批次',
  'finance.batch_approve': '审批结算批次',
  'finance.batch_cancel': '撤销结算批次',
  'withdraw.apply': '申请提现',
  'withdraw.approve': '审批提现',
  'announcement.create': '发布公告',
  'announcement.status': '公告上下线',
  'admin.audit_cleanup': '清理操作日志',
}

function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? action
}

function detailText(log: AuditLogItem) {
  if (!log.detailJson) return '—'
  const entries = Object.entries(log.detailJson).filter(([, v]) => v !== null && v !== undefined && v !== '')
  if (!entries.length) return '—'
  return entries.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('，').slice(0, 120)
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await apis.adminTools.auditLogs({
      page: page.value,
      pageSize: 50,
      action: selectedAction.value || undefined,
      username: searchUser.value.trim() || undefined,
      from: dateRange.value.start || undefined,
      to: dateRange.value.end || undefined,
    })
    logs.value = data.list
    total.value = data.total
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}

async function exportLogs() {
  try {
    const data = await apis.adminTools.auditLogs({ page: 1, pageSize: 1000, action: selectedAction.value || undefined })
    const header = '时间,操作人,操作,资源,详情,IP\n'
    const lines = data.list.map((l) =>
      `${new Date(l.createdAt).toLocaleString('zh-CN')},${l.operatorUsername ?? ''},${actionLabel(l.action)},${l.resourceType}:${l.resourceId ?? ''},"${detailText(l).replace(/"/g, '""')}",${l.ip ?? ''}`,
    )
    const blob = new Blob(['﻿' + header + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  } catch (e: any) { error.value = e?.message ?? String(e) }
}

onMounted(async () => {
  try { actions.value = (await apis.adminTools.auditActions()).map((a) => a.action) } catch { /* 不阻塞 */ }
  await load()
})
</script>

<template>
  <div class="page-stack">
    <header class="page-header">
      <div>
        <p class="section-index">06 / 操作日志</p>
        <h1>审计日志</h1>
        <p>全部账号的关键操作与审计记录。</p>
      </div>
      <button class="row-action" @click="exportLogs">导出 CSV</button>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 11px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

    <article class="panel" style="padding: 20px;">
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;">
        <div class="form-field" style="margin-bottom: 0;">
          <label>操作类型</label>
          <select v-model="selectedAction" @change="page = 1; load()">
            <option value="">全部操作</option>
            <option v-for="a in actions" :key="a" :value="a">{{ actionLabel(a) }}</option>
          </select>
        </div>
        <div class="form-field" style="margin-bottom: 0;">
          <label>操作人</label>
          <input v-model="searchUser" placeholder="用户名" @keyup.enter="page = 1; load()" />
        </div>
        <div class="form-field" style="margin-bottom: 0;">
          <label>日期范围</label>
          <div style="display: flex; gap: 6px;">
            <input v-model="dateRange.start" type="date" style="flex: 1;" @change="page = 1; load()" />
            <input v-model="dateRange.end" type="date" style="flex: 1;" @change="page = 1; load()" />
          </div>
        </div>
        <div class="form-field" style="margin-bottom: 0; justify-content: flex-end;">
          <button class="row-action" @click="page = 1; load()">查询</button>
        </div>
      </div>
    </article>

    <article class="panel data-panel">
      <div class="list-toolbar">
        <span class="toolbar-title">操作记录</span>
        <span class="toolbar-count">{{ total }}</span>
      </div>
      <div v-if="loading" class="skeleton-row" aria-label="加载中"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
      <div v-else-if="!logs.length" class="empty-panel"><span>没有符合条件的记录。</span></div>
      <div v-else class="responsive-table">
        <table>
          <thead>
            <tr>
              <th style="width: 130px;">时间</th>
              <th>操作人</th>
              <th>操作</th>
              <th>资源</th>
              <th>详情</th>
              <th style="width: 110px;">IP</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="log in logs" :key="log.id">
              <td style="font-size: 10px; color: var(--ink-soft); font-family: var(--font-mono);">{{ new Date(log.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) }}</td>
              <td><strong>{{ log.operatorName ?? log.operatorUsername ?? '系统' }}</strong></td>
              <td><span class="status-badge draft">{{ actionLabel(log.action) }}</span></td>
              <td style="font-family: var(--font-mono); font-size: 10px;">{{ log.resourceType }}{{ log.resourceId ? ` #${log.resourceId}` : '' }}</td>
              <td style="font-size: 11px; color: var(--ink-soft); max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{ detailText(log) }}</td>
              <td style="font-family: var(--font-mono); font-size: 10px; color: var(--ink-soft);">{{ log.ip ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="total > 50" style="display: flex; justify-content: center; gap: 10px; padding: 14px; border-top: 1px solid var(--line);">
        <button class="row-action" :disabled="page <= 1" @click="page--; load()">上一页</button>
        <span style="font-family: var(--font-mono); font-size: 11px; color: var(--ink-soft); align-self: center;">{{ page }} / {{ Math.ceil(total / 50) }}</span>
        <button class="row-action" :disabled="page * 50 >= total" @click="page++; load()">下一页</button>
      </div>
    </article>
  </div>
</template>
