<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Withdrawal, WithdrawalStatus } from '@zhihu-koc/shared-contracts'
import { APP_ROLE } from '../app-config'
import { useAuthStore, apis } from '../stores/auth'

const auth = useAuthStore()
const withdrawals = ref<Withdrawal[]>([])
const loading = ref(true)
const error = ref('')
const statusFilter = ref('')

/* 申请表单 */
const applyAmountYuan = ref('')
const applyMethod = ref<'alipay' | 'wechat'>('alipay')
const applyAccount = ref('')
const applying = ref(false)

/* 审批 */
const remark = ref('')
const acting = ref(false)

const canApply = APP_ROLE !== 'admin'
const isLeader = APP_ROLE === 'leader'
const isAdmin = APP_ROLE === 'admin'

const statusLabels: Record<WithdrawalStatus, string> = {
  pending: '待初审',
  leader_approved: '待终审',
  approved: '已放款',
  rejected: '已驳回',
  cancelled: '已撤销',
}
const statusClass: Record<WithdrawalStatus, string> = {
  pending: 'paused',
  leader_approved: 'paused',
  approved: 'active',
  rejected: 'rejected',
  cancelled: 'ended',
}
const riskLabels: Record<string, string> = {
  high_freq: '高频提现',
  new_account_large: '新账号大额',
  zero_data_large: '零数据大额',
}

/** 各角色看到的待办 */
const leaderQueue = computed(() => withdrawals.value.filter((w) => w.status === 'pending' && w.applicantUsername !== auth.user?.username))
const adminQueue = computed(() => withdrawals.value.filter((w) => w.status === 'leader_approved'))
const myList = computed(() => withdrawals.value.filter((w) => w.applicantUsername === auth.user?.username))

const filteredList = computed(() =>
  statusFilter.value ? withdrawals.value.filter((w) => w.status === statusFilter.value) : withdrawals.value,
)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await apis.withdrawals.list({ page: 1, pageSize: 100 })
    withdrawals.value = data.list
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}

async function apply() {
  error.value = ''
  const yuan = Number(applyAmountYuan.value)
  if (!Number.isFinite(yuan) || yuan <= 0) { error.value = '请输入正确的提现金额'; return }
  if (!applyAccount.value.trim()) { error.value = '请填写收款账户'; return }
  applying.value = true
  try {
    await apis.withdrawals.apply({
      amount: Math.round(yuan * 100),
      payMethod: applyMethod.value,
      payAccount: applyAccount.value.trim(),
    })
    applyAmountYuan.value = ''
    applyAccount.value = ''
    await load()
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { applying.value = false }
}

async function cancel(id: string) {
  if (!confirm('确定撤销这笔提现申请？')) return
  try { await apis.withdrawals.cancel(id); await load() }
  catch (e: any) { error.value = e?.message ?? String(e) }
}

async function review(id: string, action: 'approve' | 'reject') {
  if (action === 'reject' && !remark.value.trim()) { error.value = '驳回请填写原因'; return }
  acting.value = true
  try {
    await apis.withdrawals.review(id, action, remark.value.trim() || undefined)
    remark.value = ''
    await load()
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { acting.value = false }
}

async function decide(id: string, action: 'approve' | 'reject') {
  if (action === 'reject' && !remark.value.trim()) { error.value = '驳回请填写原因'; return }
  acting.value = true
  try {
    await apis.withdrawals.decide(id, action, remark.value.trim() || undefined)
    remark.value = ''
    await load()
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { acting.value = false }
}

const fen2yuan = (v: number) => `¥${(v / 100).toFixed(2)}`

onMounted(load)
</script>

<template>
  <div class="page-stack">
    <header class="page-header">
      <div>
        <p class="section-index">01 / {{ isAdmin ? '提现终审' : isLeader ? '提现审批' : '提现中心' }}</p>
        <h1>{{ isAdmin ? '提现终审与放款' : isLeader ? '提现审批' : '提现申请' }}</h1>
        <p>{{ isAdmin ? '复核初审通过的提现清单，人工逐单终审放款。' : isLeader ? '审核本团队成员的提现申请（48 小时内）。' : '选择金额与收款账户提交提现申请，团长初审后由管理员终审放款。' }}</p>
      </div>
      <button class="row-action" @click="load">刷新</button>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 11px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

    <!-- 成员：申请提现 -->
    <article v-if="canApply" class="panel" style="padding: 22px;">
      <p class="section-index quiet">02 / 新申请</p>
      <form class="apply-form" @submit.prevent="apply">
        <div class="form-field" style="margin-bottom: 0;">
          <label>提现金额（元）</label>
          <input v-model="applyAmountYuan" type="number" min="0.01" step="0.01" placeholder="100.00" />
        </div>
        <div class="form-field" style="margin-bottom: 0;">
          <label>收款方式</label>
          <select v-model="applyMethod">
            <option value="alipay">支付宝</option>
            <option value="wechat">微信</option>
          </select>
        </div>
        <div class="form-field" style="margin-bottom: 0;">
          <label>收款账户</label>
          <input v-model="applyAccount" placeholder="支付宝账号 / 微信号" />
        </div>
        <button type="submit" class="primary-action" :disabled="applying" style="align-self: end;">{{ applying ? '提交中...' : '提交申请' }}</button>
      </form>
    </article>

    <!-- 团长：初审队列 -->
    <article v-if="isLeader" class="panel data-panel">
      <div class="list-toolbar">
        <span class="toolbar-title">待我初审（本团队）</span>
        <span class="toolbar-count">{{ leaderQueue.length }}</span>
      </div>
      <div v-if="!leaderQueue.length" class="empty-panel"><span>本团队暂无待初审的提现申请。</span></div>
      <div v-else class="queue-list">
        <div v-for="w in leaderQueue" :key="w.id" class="campaign-row">
          <div>
            <strong>{{ w.applicantName }} <span class="status-badge paused" style="margin-left: 4px;">{{ fen2yuan(w.amount) }}</span></strong>
            <small>{{ w.payMethod === 'alipay' ? '支付宝' : '微信' }} · {{ w.payAccount }} · {{ new Date(w.createdAt).toLocaleString('zh-CN') }}</small>
            <small v-if="w.riskFlags?.length" style="color: var(--clay-deep);">⚠ {{ w.riskFlags.map(f => riskLabels[f] ?? f).join('、') }}</small>
          </div>
          <div style="display: flex; gap: 6px; align-items: center;">
            <input v-model="remark" placeholder="驳回原因（驳回时必填）" style="width: 160px; font-size: 11px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 2px;" />
            <button class="row-action" :disabled="acting" @click="review(w.id, 'approve')">通过</button>
            <button class="row-action danger" :disabled="acting" @click="review(w.id, 'reject')">驳回</button>
          </div>
        </div>
      </div>
    </article>

    <!-- 管理员：终审队列 -->
    <article v-if="isAdmin" class="panel data-panel">
      <div class="list-toolbar">
        <span class="toolbar-title">待我终审（初审已通过）</span>
        <span class="toolbar-count">{{ adminQueue.length }}</span>
      </div>
      <div v-if="!adminQueue.length" class="empty-panel"><span>暂无待终审的提现申请。</span></div>
      <div v-else class="queue-list">
        <div v-for="w in adminQueue" :key="w.id" class="campaign-row">
          <div>
            <strong>{{ w.applicantName }} <span class="status-badge paused" style="margin-left: 4px;">{{ fen2yuan(w.amount) }}</span></strong>
            <small>{{ w.payMethod === 'alipay' ? '支付宝' : '微信' }} · {{ w.payAccount }} · 初审：{{ w.leaderName ?? '—' }}</small>
            <small v-if="w.riskFlags?.length" style="color: var(--clay-deep);">⚠ {{ w.riskFlags.map(f => riskLabels[f] ?? f).join('、') }}</small>
          </div>
          <div style="display: flex; gap: 6px; align-items: center;">
            <input v-model="remark" placeholder="驳回原因（驳回时必填）" style="width: 160px; font-size: 11px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 2px;" />
            <button class="row-action" :disabled="acting" @click="decide(w.id, 'approve')">终审放款</button>
            <button class="row-action danger" :disabled="acting" @click="decide(w.id, 'reject')">驳回</button>
          </div>
        </div>
      </div>
    </article>

    <!-- 全部记录（可按状态筛选） -->
    <article class="panel data-panel">
      <div class="list-toolbar">
        <span class="toolbar-title">{{ canApply ? '我的申请记录' : '全部提现记录' }}</span>
        <div style="display: flex; gap: 8px; align-items: center;">
          <select v-model="statusFilter" style="font-size: 11px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 2px;">
            <option value="">全部状态</option>
            <option v-for="(label, key) in statusLabels" :key="key" :value="key">{{ label }}</option>
          </select>
          <span class="toolbar-count">{{ filteredList.length }}</span>
        </div>
      </div>
      <div v-if="loading" class="skeleton-row" aria-label="加载中"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
      <div v-else-if="!filteredList.length" class="empty-panel"><span>暂无提现记录。</span></div>
      <div v-else class="responsive-table">
        <table>
          <thead><tr><th>申请人</th><th>金额</th><th>收款</th><th>状态</th><th>初审</th><th>时间</th><th v-if="canApply">操作</th></tr></thead>
          <tbody>
            <tr v-for="w in filteredList" :key="w.id">
              <td><strong>{{ w.applicantName }}</strong><br /><small style="color: var(--ink-soft); font-family: var(--font-mono); font-size: 9px;">{{ w.applicantUsername }}</small></td>
              <td style="font-family: var(--font-mono); font-size: 11px;">{{ fen2yuan(w.amount) }}<small v-if="w.riskFlags?.length" style="display: block; color: var(--clay-deep); font-size: 9px;">⚠ 风控</small></td>
              <td style="font-size: 10px;">{{ w.payMethod === 'alipay' ? '支付宝' : '微信' }}<br /><small style="color: var(--ink-soft);">{{ w.payAccount }}</small></td>
              <td><span :class="['status-badge', statusClass[w.status]]">{{ statusLabels[w.status] }}</span></td>
              <td style="font-size: 10px; color: var(--ink-soft);">{{ w.leaderName ?? '—' }}{{ w.leaderRemark ? `（${w.leaderRemark}）` : '' }}</td>
              <td style="font-size: 10px; color: var(--ink-soft); font-family: var(--font-mono);">{{ new Date(w.createdAt).toLocaleDateString('zh-CN') }}</td>
              <td v-if="canApply">
                <button v-if="w.status === 'pending' && w.applicantUsername === auth.user?.username" class="row-action" @click="cancel(w.id)">撤销</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </div>
</template>

<style scoped>
.apply-form { display: grid; grid-template-columns: 1fr 1fr 2fr auto; gap: 12px; margin-top: 12px; align-items: end; }
@media (max-width: 900px) { .apply-form { grid-template-columns: 1fr; } }
</style>
