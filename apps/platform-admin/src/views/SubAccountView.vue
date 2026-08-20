<script setup lang="ts">
import { ref, computed } from 'vue'

interface SubAccount {
  id: number
  username: string
  displayName: string
  role: string
  email: string
  status: 'active' | 'disabled'
  createdAt: string
  lastLoginAt: string
}

const q = ref('')
const showDialog = ref(false)
const editingAccount = ref<SubAccount | null>(null)

const formData = ref({
  username: '',
  displayName: '',
  email: '',
  role: 'operator',
  password: '',
})

// Mock 数据
const accounts = ref<SubAccount[]>([
  {
    id: 1,
    username: 'operator001',
    displayName: '张三',
    role: '运营专员',
    email: 'zhangsan@example.com',
    status: 'active',
    createdAt: '2024-01-15',
    lastLoginAt: '2024-02-20 14:30',
  },
  {
    id: 2,
    username: 'analyst001',
    displayName: '李四',
    role: '数据分析',
    email: 'lisi@example.com',
    status: 'active',
    createdAt: '2024-02-01',
    lastLoginAt: '2024-02-19 09:15',
  },
])

const filteredAccounts = computed(() => {
  if (!q.value) return accounts.value
  const query = q.value.toLowerCase()
  return accounts.value.filter(
    (a) =>
      a.username.toLowerCase().includes(query) ||
      a.displayName.toLowerCase().includes(query) ||
      a.email.toLowerCase().includes(query)
  )
})

function openCreateDialog() {
  editingAccount.value = null
  formData.value = {
    username: '',
    displayName: '',
    email: '',
    role: 'operator',
    password: '',
  }
  showDialog.value = true
}

function openEditDialog(account: SubAccount) {
  editingAccount.value = account
  formData.value = {
    username: account.username,
    displayName: account.displayName,
    email: account.email,
    role: account.role,
    password: '',
  }
  showDialog.value = true
}

function closeDialog() {
  showDialog.value = false
  editingAccount.value = null
}

function saveAccount() {
  if (editingAccount.value) {
    // 编辑
    const existing = accounts.value.find((a) => a.id === editingAccount.value!.id)
    if (existing) {
      Object.assign(existing, {
        displayName: formData.value.displayName,
        email: formData.value.email,
        role: formData.value.role,
      })
    }
  } else {
    // 创建
    const newAccount: SubAccount = {
      id: Date.now(),
      username: formData.value.username,
      displayName: formData.value.displayName,
      email: formData.value.email,
      role: formData.value.role,
      status: 'active',
      createdAt: new Date().toISOString().slice(0, 10),
      lastLoginAt: '-',
    }
    accounts.value.push(newAccount)
  }
  closeDialog()
}

function toggleStatus(account: SubAccount) {
  account.status = account.status === 'active' ? 'disabled' : 'active'
}

function resetPassword(account: SubAccount) {
  if (confirm(`确认重置 ${account.displayName} 的密码吗？`)) {
    alert('密码已重置为：123456')
  }
}
</script>

<template>
  <div class="page-stack">
    <header class="page-header">
      <div>
        <p class="eyebrow">ACCOUNTS / SUB</p>
        <h1>子账号管理</h1>
      </div>
      <button class="primary-action" @click="openCreateDialog">+ 创建子账号</button>
    </header>

    <article class="panel" style="padding: 20px;">
      <p style="font-size: 12px; color: var(--ink-soft); margin-bottom: 16px;">
        子账号管理用于创建、禁用和监控子账号访问权限。
      </p>
      <div style="display: flex; gap: 10px;">
        <input
          v-model="q"
          placeholder="搜索子账号..."
          style="flex: 1; padding: 8px 12px; border: 1px solid var(--line); border-radius: var(--radius); font-size: 12px;"
        />
        <button class="secondary-action">搜索</button>
      </div>
    </article>

    <article v-if="filteredAccounts.length > 0" class="panel">
      <div class="list-toolbar">
        <span class="toolbar-title">子账号列表（{{ filteredAccounts.length }}）</span>
      </div>
      <div class="responsive-table">
        <table>
          <thead>
            <tr>
              <th>用户名</th>
              <th>姓名</th>
              <th>角色</th>
              <th>邮箱</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>最后登录</th>
              <th style="text-align: right;">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="account in filteredAccounts" :key="account.id">
              <td><strong>{{ account.username }}</strong></td>
              <td><strong>{{ account.displayName }}</strong></td>
              <td>{{ account.role }}</td>
              <td>{{ account.email }}</td>
              <td>
                <span
                  :class="account.status === 'active' ? 'status-badge-success' : 'status-badge-error'"
                >
                  {{ account.status === 'active' ? '正常' : '已禁用' }}
                </span>
              </td>
              <td>{{ account.createdAt }}</td>
              <td>{{ account.lastLoginAt }}</td>
              <td style="text-align: right;">
                <button class="quiet-action" @click="openEditDialog(account)">编辑</button>
                <button class="quiet-action" @click="resetPassword(account)">重置密码</button>
                <button
                  class="quiet-action"
                  :style="account.status === 'disabled' ? 'color: var(--forest)' : 'color: var(--clay)'"
                  @click="toggleStatus(account)"
                >
                  {{ account.status === 'active' ? '禁用' : '启用' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <div v-else class="empty-panel">
      <span>暂无子账号，点击右上角"创建子账号"开始添加。</span>
    </div>

    <!-- 创建/编辑对话框 -->
    <div v-if="showDialog" class="dialog-overlay" @click.self="closeDialog">
      <div class="dialog-card" style="width: 480px;">
        <header class="dialog-header">
          <h3>{{ editingAccount ? '编辑子账号' : '创建子账号' }}</h3>
          <button class="dialog-close" @click="closeDialog">×</button>
        </header>
        <div class="dialog-body">
          <div class="form-field">
            <label>用户名</label>
            <input
              v-model="formData.username"
              :disabled="!!editingAccount"
              placeholder="用户名（登录用）"
            />
            <small v-if="!editingAccount" style="color: var(--ink-soft);">创建后不可修改</small>
          </div>
          <div class="form-field">
            <label>姓名</label>
            <input v-model="formData.displayName" placeholder="真实姓名" />
          </div>
          <div class="form-field">
            <label>邮箱</label>
            <input v-model="formData.email" type="email" placeholder="email@example.com" />
          </div>
          <div class="form-field">
            <label>角色</label>
            <select v-model="formData.role">
              <option value="operator">运营专员</option>
              <option value="analyst">数据分析</option>
              <option value="support">客服支持</option>
              <option value="finance">财务</option>
            </select>
          </div>
          <div v-if="!editingAccount" class="form-field">
            <label>初始密码</label>
            <input v-model="formData.password" type="password" placeholder="至少 6 位" />
            <small style="color: var(--ink-soft);">为空则默认为 123456</small>
          </div>
        </div>
        <footer class="dialog-footer">
          <button class="secondary-action" @click="closeDialog">取消</button>
          <button class="primary-action" @click="saveAccount">
            {{ editingAccount ? '保存' : '创建' }}
          </button>
        </footer>
      </div>
    </div>
  </div>
</template>
