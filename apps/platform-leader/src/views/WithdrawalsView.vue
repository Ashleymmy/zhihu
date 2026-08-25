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
const settleType = ref<'personal' | 'corporate'>('personal')
const applyMethod = ref<'alipay' | 'wechat' | 'bank_transfer'>('alipay')
const applyAccount = ref('')
const companyName = ref('')
const bankName = ref('')
const bankAccount = ref('')
const taxId = ref('')
const applying = ref(false)

/* 发票与结算单 */
const invoiceFiles = ref<Record<string, File | null>>({})
const uploadingInvoice = ref('')
const statement = ref<import('@zhihu-koc/shared-contracts').WithdrawalStatement | null>(null)
const statementLoading = ref(false)

function onSettleTypeChange() {
  if (settleType.value === 'corporate') applyMethod.value = 'bank_transfer'
  else applyMethod.value = 'alipay'
}

async function uploadInvoice(id: string) {
  const file = invoiceFiles.value[id]
  if (!file) { error.value = '请先选择发票文件'; return }
  uploadingInvoice.value = id
  error.value = ''
  try {
    await apis.withdrawals.uploadInvoice(id, file)
    invoiceFiles.value[id] = null
    await load()
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { uploadingInvoice.value = '' }
}

async function downloadInvoice(id: string, name: string) {
  try {
    const blob = await apis.withdrawals.downloadInvoice(id)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
  } catch (e: any) { error.value = e?.message ?? String(e) }
}

async function openStatement(id: string) {
  statementLoading.value = true
  try { statement.value = await apis.withdrawals.statement(id) }
  catch (e: any) { error.value = e?.message ?? String(e) }
  finally { statementLoading.value = false }
}

function printStatement() { window.print() }

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
  if (settleType.value === 'corporate') {
    if (!companyName.value.trim() || !bankName.value.trim() || !bankAccount.value.trim() || !taxId.value.trim()) {
      error.value = '对公结算必须完整填写公司名称、开户行、银行账号和纳税人识别号'
      return
    }
  } else if (!applyAccount.value.trim()) {
    error.value = '请填写收款账户'
    return
  }
  applying.value = true
  try {
    await apis.withdrawals.apply({
      amount: Math.round(yuan * 100),
      settleType: settleType.value,
      payMethod: settleType.value === 'corporate' ? 'bank_transfer' : applyMethod.value,
      payAccount: settleType.value === 'corporate' ? bankAccount.value.trim() : applyAccount.value.trim(),
      companyName: settleType.value === 'corporate' ? companyName.value.trim() : undefined,
      bankName: settleType.value === 'corporate' ? bankName.value.trim() : undefined,
      bankAccount: settleType.value === 'corporate' ? bankAccount.value.trim() : undefined,
      taxId: settleType.value === 'corporate' ? taxId.value.trim() : undefined,
    })
    applyAmountYuan.value = ''
    applyAccount.value = ''
    companyName.value = ''
    bankName.value = ''
    bankAccount.value = ''
    taxId.value = ''
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
          <label>结算方式</label>
          <div style="display: flex; gap: 8px;">
            <button type="button" :class="settleType === 'personal' ? 'primary-action' : 'row-action'" @click="settleType = 'personal'; onSettleTypeChange()">个人</button>
            <button type="button" :class="settleType === 'corporate' ? 'primary-action' : 'row-action'" @click="settleType = 'corporate'; onSettleTypeChange()">对公</button>
          </div>
        </div>
        <div class="form-field" style="margin-bottom: 0;">
          <label>提现金额（元）</label>
          <input v-model="applyAmountYuan" type="number" min="0.01" step="0.01" placeholder="100.00" />
        </div>
        <template v-if="settleType === 'personal'">
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
        </template>
        <template v-else>
          <div class="form-field" style="margin-bottom: 0;">
            <label>公司名称</label>
            <input v-model="companyName" placeholder="与发票抬头一致" />
          </div>
          <div class="form-field" style="margin-bottom: 0;">
            <label>开户行</label>
            <input v-model="bankName" placeholder="如：招商银行杭州分行" />
          </div>
          <div class="form-field" style="margin-bottom: 0;">
            <label>银行账号</label>
            <input v-model="bankAccount" placeholder="对公账户" />
          </div>
          <div class="form-field" style="margin-bottom: 0;">
            <label>纳税人识别号</label>
            <input v-model="taxId" placeholder="统一社会信用代码" />
          </div>
          <p style="grid-column: 1 / -1; margin: 0; color: var(--ink-soft); font-size: 10px;">对公转账（bank_transfer），提交后请在记录中上传发票，管理员核对后放款。</p>
        </template>
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
          <thead><tr><th>申请人</th><th>金额</th><th>收款</th><th>状态</th><th>初审</th><th>发票</th><th>时间</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="w in filteredList" :key="w.id">
              <td><strong>{{ w.applicantName }}</strong><br /><small style="color: var(--ink-soft); font-family: var(--font-mono); font-size: 9px;">{{ w.applicantUsername }}</small></td>
              <td style="font-family: var(--font-mono); font-size: 11px;">{{ fen2yuan(w.amount) }}<small v-if="w.riskFlags?.length" style="display: block; color: var(--clay-deep); font-size: 9px;">⚠ 风控</small></td>
              <td style="font-size: 10px;">{{ w.payMethod === 'alipay' ? '支付宝' : '微信' }}<br /><small style="color: var(--ink-soft);">{{ w.payAccount }}</small></td>
              <td><span :class="['status-badge', statusClass[w.status]]">{{ statusLabels[w.status] }}</span></td>
              <td style="font-size: 10px; color: var(--ink-soft);">{{ w.leaderName ?? '—' }}{{ w.leaderRemark ? `（${w.leaderRemark}）` : '' }}</td>
              <td>
                <template v-if="w.settleType === 'corporate'">
                  <div v-if="w.invoiceName" style="display: flex; gap: 6px; align-items: center;">
                    <span class="status-badge active" style="font-size: 9px;">已上传</span>
                    <button class="row-action" style="font-size: 10px;" @click="downloadInvoice(w.id, w.invoiceName!)">下载</button>
                  </div>
                  <div v-else-if="w.applicantUsername === auth.user?.username && w.status !== 'approved' && w.status !== 'cancelled'" style="display: flex; gap: 6px; align-items: center;">
                    <input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" style="font-size: 10px; width: 130px;" @change="invoiceFiles[w.id] = ($event.target as HTMLInputElement).files?.[0] ?? null" />
                    <button class="row-action" :disabled="uploadingInvoice === w.id" @click="uploadInvoice(w.id)">{{ uploadingInvoice === w.id ? '...' : '上传' }}</button>
                  </div>
                  <span v-else class="status-badge paused" style="font-size: 9px;">未上传</span>
                </template>
                <span v-else style="color: var(--ink-soft); font-size: 10px;">—</span>
              </td>
              <td style="font-size: 10px; color: var(--ink-soft); font-family: var(--font-mono);">{{ new Date(w.createdAt).toLocaleDateString('zh-CN') }}</td>
              <td>
                <div style="display: flex; gap: 6px;">
                  <button class="row-action" @click="openStatement(w.id)">结算单</button>
                  <button v-if="w.status === 'pending' && w.applicantUsername === auth.user?.username" class="row-action" @click="cancel(w.id)">撤销</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <!-- 结算单弹窗（可打印存档） -->
    <Teleport to="body">
      <div v-if="statement" class="dialog-overlay" @click.self="statement = null">
        <div class="dialog-card statement-card">
          <div class="dialog-header no-print">
            <h3>结算单</h3>
            <div style="display: flex; gap: 8px;">
              <button class="row-action" @click="printStatement">打印 / 存 PDF</button>
              <button type="button" class="dialog-close" @click="statement = null">×</button>
            </div>
          </div>
          <div class="statement-body" id="statement-print">
            <div class="st-head">
              <div>
                <p class="st-brand">OPC · 知乎推广运营平台</p>
                <h2>提现结算单</h2>
              </div>
              <p class="st-no">{{ statement.statementNo }}</p>
            </div>
            <div class="st-grid">
              <div class="st-item"><span>申请人</span><strong>{{ statement.applicant.name }}（{{ statement.applicant.username }}）</strong></div>
              <div class="st-item"><span>结算金额</span><strong class="st-amount">¥{{ (statement.amount / 100).toFixed(2) }}</strong></div>
              <div class="st-item"><span>结算方式</span><strong>{{ statement.settleType === 'corporate' ? '对公转账' : '个人（' + statement.payMethod + '）' }}</strong></div>
              <div class="st-item"><span>状态</span><strong>{{ { pending: '待初审', leader_approved: '待终审', approved: '已放款', rejected: '已驳回', cancelled: '已撤销' }[statement.status] }}</strong></div>
            </div>
            <div v-if="statement.corporate" class="st-section">
              <p class="st-sec-title">对公收款信息</p>
              <div class="st-grid">
                <div class="st-item"><span>公司名称</span><strong>{{ statement.corporate.companyName }}</strong></div>
                <div class="st-item"><span>开户行</span><strong>{{ statement.corporate.bankName }}</strong></div>
                <div class="st-item"><span>银行账号</span><strong>{{ statement.corporate.bankAccount }}</strong></div>
                <div class="st-item"><span>纳税人识别号</span><strong>{{ statement.corporate.taxId }}</strong></div>
              </div>
            </div>
            <div v-else class="st-section">
              <p class="st-sec-title">收款账户</p>
              <p class="st-line">{{ statement.payMethod === 'alipay' ? '支付宝' : statement.payMethod === 'wechat' ? '微信' : '银行转账' }} · {{ statement.payAccount }}</p>
            </div>
            <div class="st-section">
              <p class="st-sec-title">审批链</p>
              <div class="st-timeline">
                <div class="st-step"><i />提交申请 <b>{{ new Date(statement.createdAt).toLocaleString('zh-CN') }}</b></div>
                <div v-if="statement.leader" class="st-step"><i />团长初审：{{ statement.leader.name }}{{ statement.leader.remark ? `（${statement.leader.remark}）` : '' }} <b>{{ new Date(statement.leader.at).toLocaleString('zh-CN') }}</b></div>
                <div v-if="statement.final" class="st-step"><i />管理员终审：{{ statement.final.name }}{{ statement.final.remark ? `（${statement.final.remark}）` : '' }} <b>{{ new Date(statement.final.at).toLocaleString('zh-CN') }}</b></div>
              </div>
            </div>
            <div v-if="statement.invoice" class="st-section">
              <p class="st-sec-title">发票</p>
              <p class="st-line">{{ statement.invoice.name }}（上传于 {{ new Date(statement.invoice.uploadedAt).toLocaleString('zh-CN') }}）</p>
            </div>
            <p class="st-foot">本单由系统自动生成 · 签发时间 {{ new Date(statement.issuedAt).toLocaleString('zh-CN') }} · 单号唯一，仅供财务对账存档</p>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.apply-form { display: grid; grid-template-columns: 1fr 1fr 2fr auto; gap: 12px; margin-top: 12px; align-items: end; }
@media (max-width: 900px) { .apply-form { grid-template-columns: 1fr; } }
.statement-card { width: min(640px, 94vw); }
.statement-body { padding: 28px; color: var(--ink); }
.st-head { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 14px; border-bottom: 2px solid var(--ink); }
.st-brand { margin: 0 0 4px; font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.2em; color: var(--ink-soft); }
.st-head h2 { margin: 0; font-family: var(--font-display); font-size: 26px; letter-spacing: -0.03em; }
.st-no { margin: 0; font-family: var(--font-mono); font-size: 11px; color: var(--clay); }
.st-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px; padding: 14px 0; }
.st-item { display: grid; gap: 3px; }
.st-item span { font-size: 10px; color: var(--ink-soft); font-family: var(--font-mono); }
.st-item strong { font-size: 13px; font-weight: 600; }
.st-amount { font-family: var(--font-display); font-size: 20px; color: var(--clay-deep); }
.st-section { padding: 12px 0; border-top: 1px solid var(--line); }
.st-sec-title { margin: 0 0 8px; font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; color: var(--clay); }
.st-line { margin: 0; font-size: 12px; }
.st-timeline { display: grid; gap: 8px; }
.st-step { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.st-step i { width: 6px; height: 6px; background: var(--clay); flex-shrink: 0; }
.st-step b { margin-left: auto; font-family: var(--font-mono); font-size: 10px; font-weight: 400; color: var(--ink-soft); }
.st-foot { margin: 16px 0 0; padding-top: 10px; border-top: 1px solid var(--line); font-size: 10px; color: var(--ink-soft); }
@media print {
  body * { visibility: hidden; }
  #statement-print, #statement-print * { visibility: visible; }
  #statement-print { position: absolute; inset: 0; padding: 24px; }
  .no-print { display: none !important; }
}
</style>
