<script setup lang="ts">
import { ref, computed } from 'vue'

interface AuditLog {
  id: number
  timestamp: string
  operator: string
  action: string
  target: string
  details: string
  ip: string
  status: 'success' | 'failed'
}

const dateRange = ref({ start: '', end: '' })
const selectedAction = ref('')
const selectedOperator = ref('')
const searchQuery = ref('')

const logs = ref<AuditLog[]>([
  {
    id: 1,
    timestamp: '2024-02-20 14:32:15',
    operator: '张三',
    action: '创建子账号',
    target: 'operator003',
    details: '创建运营专员账号，权限：订单管理、数据查看',
    ip: '192.168.1.100',
    status: 'success',
  },
  {
    id: 2,
    timestamp: '2024-02-20 14:28:03',
    operator: '李四',
    action: '修改权限',
    target: 'analyst001',
    details: '添加财务报表查看权限',
    ip: '192.168.1.101',
    status: 'success',
  },
  {
    id: 3,
    timestamp: '2024-02-20 14:15:47',
    operator: '王五',
    action: '禁用账号',
    target: 'operator002',
    details: '员工离职，禁用账号',
    ip: '192.168.1.102',
    status: 'success',
  },
  {
    id: 4,
    timestamp: '2024-02-20 13:58:22',
    operator: '赵六',
    action: '重置密码',
    target: 'support001',
    details: '用户申请重置密码',
    ip: '192.168.1.103',
    status: 'success',
  },
  {
    id: 5,
    timestamp: '2024-02-20 13:45:11',
    operator: '系统',
    action: '导出数据',
    target: '订单明细',
    details: '导出 2024-01 月度订单数据（2,341 条）',
    ip: '192.168.1.100',
    status: 'success',
  },
  {
    id: 6,
    timestamp: '2024-02-20 11:23:05',
    operator: '张三',
    action: '删除用户',
    target: 'test_user_001',
    details: '删除测试账号',
    ip: '192.168.1.100',
    status: 'failed',
  },
])

const actionTypes = ['创建子账号', '修改权限', '禁用账号', '重置密码', '导出数据', '删除用户']
const operators = ['张三', '李四', '王五', '赵六', '系统']

const filteredLogs = computed(() => {
  return logs.value.filter((log) => {
    if (selectedAction.value && log.action !== selectedAction.value) return false
    if (selectedOperator.value && log.operator !== selectedOperator.value) return false
    if (searchQuery.value) {
      const q = searchQuery.value.toLowerCase()
      return (
        log.target.toLowerCase().includes(q) ||
        log.details.toLowerCase().includes(q) ||
        log.operator.toLowerCase().includes(q)
      )
    }
    return true
  })
})

function exportLogs() {
  alert('审计日志导出功能：将导出当前筛选的 ' + filteredLogs.value.length + ' 条记录')
}
</script>

<template>
  <div class="page-stack">
    <header class="page-header">
      <div>
        <p class="eyebrow">SYSTEM / AUDIT</p>
        <h1>审计日志</h1>
      </div>
      <button class="secondary-action" @click="exportLogs">导出日志</button>
    </header>

    <article class="panel" style="padding: 20px;">
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
        <div class="form-field">
          <label style="font-size: 11px; color: var(--ink-soft); margin-bottom: 6px;">操作类型</label>
          <select v-model="selectedAction" style="width: 100%; padding: 8px; border: 1px solid var(--line); border-radius: var(--radius); font-size: 12px;">
            <option value="">全部操作</option>
            <option v-for="action in actionTypes" :key="action" :value="action">{{ action }}</option>
          </select>
        </div>
        <div class="form-field">
          <label style="font-size: 11px; color: var(--ink-soft); margin-bottom: 6px;">操作人</label>
          <select v-model="selectedOperator" style="width: 100%; padding: 8px; border: 1px solid var(--line); border-radius: var(--radius); font-size: 12px;">
            <option value="">全部人员</option>
            <option v-for="op in operators" :key="op" :value="op">{{ op }}</option>
          </select>
        </div>
        <div class="form-field">
          <label style="font-size: 11px; color: var(--ink-soft); margin-bottom: 6px;">搜索</label>
          <input
            v-model="searchQuery"
            placeholder="搜索目标、详情..."
            style="width: 100%; padding: 8px 12px; border: 1px solid var(--line); border-radius: var(--radius); font-size: 12px;"
          />
        </div>
      </div>
    </article>

    <article class="panel">
      <div class="list-toolbar">
        <span class="toolbar-title">操作记录（{{ filteredLogs.length }}）</span>
      </div>
      <div class="responsive-table">
        <table>
          <thead>
            <tr>
              <th style="width: 140px;">时间</th>
              <th style="width: 80px;">操作人</th>
              <th style="width: 100px;">操作</th>
              <th style="width: 120px;">目标</th>
              <th>详情</th>
              <th style="width: 120px;">IP 地址</th>
              <th style="width: 60px;">状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="log in filteredLogs" :key="log.id">
              <td>{{ log.timestamp }}</td>
              <td><strong>{{ log.operator }}</strong></td>
              <td>{{ log.action }}</td>
              <td><strong>{{ log.target }}</strong></td>
              <td>{{ log.details }}</td>
              <td style="font-family: monospace;">{{ log.ip }}</td>
              <td>
                <span :class="log.status === 'success' ? 'status-badge-success' : 'status-badge-error'">
                  {{ log.status === 'success' ? '成功' : '失败' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </div>
</template>
