<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { EarningRecord, PricingRule, SettlementBatch, SettlementBatchDetail, TeamMember } from '@zhihu-koc/shared-contracts'
import { apis } from '../stores/auth'

const loading = ref(true)
const error = ref('')
const earnings = ref<EarningRecord[]>([])
const earningsTotal = ref(0)

/* ===== 定价规则 ===== */
const rules = ref<PricingRule[]>([])
const showRuleForm = ref(false)
const ruleSubmitting = ref(false)
const ruleForm = ref({ targetRole: 'creator' as 'leader' | 'creator', targetUserId: '', method: 'percentage' as 'fixed' | 'percentage', value: '', priority: 0 })
const members = ref<TeamMember[]>([])

const ruleCandidates = computed(() => members.value.filter((m) => m.role === ruleForm.value.targetRole))

async function loadRules() {
  rules.value = await apis.finance.listRules()
}

async function openRuleForm() {
  showRuleForm.value = true
  if (!members.value.length) members.value = await apis.team.listMembers()
}

async function submitRule() {
  error.value = ''
  if (!ruleForm.value.value.trim()) { error.value = '请填写定价数值'; return }
  ruleSubmitting.value = true
  try {
    await apis.finance.createRule({
      targetRole: ruleForm.value.targetRole,
      targetUserId: ruleForm.value.targetUserId || null,
      method: ruleForm.value.method,
      unitPrice: ruleForm.value.method === 'fixed' ? ruleForm.value.value.trim() : null,
      percentage: ruleForm.value.method === 'percentage' ? ruleForm.value.value.trim() : null,
      priority: ruleForm.value.priority,
    })
    showRuleForm.value = false
    ruleForm.value = { targetRole: 'creator', targetUserId: '', method: 'percentage', value: '', priority: 0 }
    await loadRules()
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { ruleSubmitting.value = false }
}

async function disableRule(id: string) {
  try { await apis.finance.disableRule(id); await loadRules() }
  catch (e: any) { error.value = e?.message ?? String(e) }
}

function ruleText(r: PricingRule) {
  return r.method === 'fixed' ? `¥${r.unitPrice} / 条` : `${(Number(r.percentage) * 100).toFixed(2)}%`
}

/* ===== 结算批次 ===== */
const batches = ref<SettlementBatch[]>([])
const showBatchForm = ref(false)
const batchSubmitting = ref(false)
const batchForm = ref({ title: '', periodStart: '', periodEnd: '' })
const batchItems = ref<Array<{ creatorId: string; sourceAmount: string; note: string }>>([{ creatorId: '', sourceAmount: '', note: '' }])
const detail = ref<SettlementBatchDetail | null>(null)
const acting = ref(false)

const creators = computed(() => members.value.filter((m) => m.role === 'creator' && m.isActive))

async function loadBatches() {
  batches.value = await apis.finance.listBatches()
}

async function openBatchForm() {
  showBatchForm.value = true
  if (!members.value.length) members.value = await apis.team.listMembers()
}

function addItem() {
  batchItems.value.push({ creatorId: '', sourceAmount: '', note: '' })
}

async function submitBatch() {
  error.value = ''
  if (!batchForm.value.title.trim() || !batchForm.value.periodStart || !batchForm.value.periodEnd) { error.value = '请完整填写批次信息'; return }
  const items = batchItems.value.filter((i) => i.creatorId && i.sourceAmount.trim())
  if (!items.length) { error.value = '至少添加一条明细'; return }
  batchSubmitting.value = true
  try {
    await apis.finance.createBatch({
      title: batchForm.value.title.trim(),
      periodStart: batchForm.value.periodStart,
      periodEnd: batchForm.value.periodEnd,
      items: items.map((i) => ({ creatorId: i.creatorId, sourceAmount: i.sourceAmount.trim(), note: i.note.trim() || null })),
    })
    showBatchForm.value = false
    batchForm.value = { title: '', periodStart: '', periodEnd: '' }
    batchItems.value = [{ creatorId: '', sourceAmount: '', note: '' }]
    await loadBatches()
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { batchSubmitting.value = false }
}

async function openDetail(id: string) {
  try { detail.value = await apis.finance.getBatch(id) }
  catch (e: any) { error.value = e?.message ?? String(e) }
}

async function approve(id: string) {
  if (!confirm('审批通过将按当前定价规则计算并写入各账号收益，该操作不可撤销。继续？')) return
  acting.value = true
  try {
    await apis.finance.approveBatch(id)
    await Promise.all([loadBatches(), load(), openDetail(id)])
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { acting.value = false }
}

async function cancelBatch(id: string) {
  if (!confirm('确定撤销该批次？仅草稿可撤销。')) return
  acting.value = true
  try { await apis.finance.cancelBatch(id); detail.value = null; await loadBatches() }
  catch (e: any) { error.value = e?.message ?? String(e) }
  finally { acting.value = false }
}

/* ===== 收益记录 ===== */
async function load() {
  loading.value = true
  try {
    const [e] = await Promise.all([apis.earnings.list({ page: 1, pageSize: 50 }), loadRules(), loadBatches()])
    earnings.value = e.list
    earningsTotal.value = e.total
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}

const batchStatus: Record<string, string> = { draft: '草稿', approved: '已审批', cancelled: '已撤销' }
const batchBadge: Record<string, string> = { draft: 'paused', approved: 'active', cancelled: 'ended' }

const fmtDate = (v: string) => { const d = new Date(v); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const yuan = (v: string | number) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(Number(v))

onMounted(load)
</script>

<template>
  <div class="page-stack">
    <header class="page-header">
      <div>
        <p class="section-index">01 / 结算管理</p>
        <h1>结算与定价</h1>
        <p>Admin 对下游账号定价：登记结算批次、按定价规则中继分配、写入各账号收益。</p>
      </div>
      <button class="row-action" @click="load">刷新</button>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 11px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

    <!-- 定价规则 -->
    <article class="panel data-panel">
      <div class="list-toolbar">
        <span class="toolbar-title">定价规则</span>
        <span class="toolbar-count">{{ rules.filter(r => r.status === 'active').length }} 生效中</span>
        <button class="primary-action" @click="openRuleForm">新建规则</button>
      </div>
      <div v-if="!rules.length" class="empty-panel"><span>暂无定价规则。未命中规则的达人按来源金额全额入账，团长不计提。</span></div>
      <div v-else class="responsive-table">
        <table>
          <thead><tr><th>适用对象</th><th>方式</th><th>数值</th><th>优先级</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="r in rules" :key="r.id">
              <td><strong>{{ r.targetName ? `${r.targetName}（${r.targetUsername}）` : (r.targetRole === 'leader' ? '全部团长' : '全部达人') }}</strong></td>
              <td style="font-size: 11px;">{{ r.method === 'fixed' ? '固定单价' : '按比例' }}</td>
              <td style="font-family: var(--font-mono); font-size: 11px;">{{ ruleText(r) }}</td>
              <td style="font-family: var(--font-mono); font-size: 10px;">{{ r.priority }}</td>
              <td><span :class="['status-badge', r.status === 'active' ? 'active' : 'ended']">{{ r.status === 'active' ? '生效中' : '已停用' }}</span></td>
              <td><button v-if="r.status === 'active'" class="row-action" @click="disableRule(r.id)">停用</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <!-- 结算批次 -->
    <article class="panel data-panel">
      <div class="list-toolbar">
        <span class="toolbar-title">结算批次</span>
        <span class="toolbar-count">{{ batches.length }}</span>
        <button class="primary-action" @click="openBatchForm">登记批次</button>
      </div>
      <div v-if="!batches.length" class="empty-panel"><span>暂无结算批次。批次是上游结算金额的唯一入账入口。</span></div>
      <div v-else class="responsive-table">
        <table>
          <thead><tr><th>批次</th><th>周期</th><th>来源金额</th><th>分发金额</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="b in batches" :key="b.id">
              <td><strong>{{ b.title }}</strong></td>
              <td style="font-size: 11px;">{{ fmtDate(b.periodStart) }} ~ {{ fmtDate(b.periodEnd) }}</td>
              <td style="font-family: var(--font-mono); font-size: 11px;">{{ yuan(b.totalSource) }}</td>
              <td style="font-family: var(--font-mono); font-size: 11px;">{{ yuan(b.totalRelay) }}</td>
              <td><span :class="['status-badge', batchBadge[b.status]]">{{ batchStatus[b.status] }}</span></td>
              <td><button class="row-action" @click="openDetail(b.id)">详情</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <!-- 收益记录 -->
    <article class="panel data-panel" style="min-height: 300px;">
      <div class="list-toolbar">
        <div>
          <span class="toolbar-title">收益记录</span>
          <span class="toolbar-count">{{ earningsTotal }}</span>
        </div>
      </div>
      <div v-if="loading" style="display: grid; min-height: 200px; place-content: center; color: var(--ink-soft); font-size: 12px;">加载中...</div>
      <div v-else-if="!earnings.length" class="empty-panel">
        <span>暂无结算记录。</span>
      </div>
      <div v-else class="responsive-table">
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th>关键词</th>
              <th>渠道</th>
              <th>负责人</th>
              <th>金额</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in earnings" :key="item.id">
              <td>{{ item.date }}</td>
              <td>{{ item.keyword }}</td>
              <td>{{ item.channelName }}</td>
              <td>{{ item.ownerName }}</td>
              <td><strong>{{ yuan(item.amount / 100) }}</strong></td>
              <td>
                <span :class="['status-badge', item.status === 'confirmed' ? 'active' : item.status === 'pending' ? 'draft' : 'paid']">
                  {{ { pending: '待确认', confirmed: '已确认', paid: '已打款' }[item.status] }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <!-- 新建规则对话框 -->
    <Teleport to="body">
      <div v-if="showRuleForm" class="dialog-overlay" @click.self="showRuleForm = false">
        <div class="dialog-card" style="width: min(440px, 92vw);">
          <div class="dialog-header">
            <h3>新建定价规则</h3>
            <button type="button" class="dialog-close" @click="showRuleForm = false">×</button>
          </div>
          <div class="dialog-body">
            <div class="form-field">
              <label>适用对象</label>
              <div style="display: flex; gap: 10px;">
                <select v-model="ruleForm.targetRole" style="flex: 1;" @change="ruleForm.targetUserId = ''">
                  <option value="creator">达人</option>
                  <option value="leader">团长</option>
                </select>
                <select v-model="ruleForm.targetUserId" style="flex: 1;">
                  <option value="">角色默认</option>
                  <option v-for="m in ruleCandidates" :key="m.id" :value="m.id">{{ m.displayName }}（{{ m.username }}）</option>
                </select>
              </div>
            </div>
            <div class="form-field">
              <label>定价方式</label>
              <select v-model="ruleForm.method">
                <option value="percentage">按来源金额比例</option>
                <option value="fixed">每条来源记录固定金额</option>
              </select>
            </div>
            <div class="form-field">
              <label>{{ ruleForm.method === 'percentage' ? '比例（0~1，如 0.6 表示 60%）' : '金额（元，如 12.5）' }}</label>
              <input v-model="ruleForm.value" :placeholder="ruleForm.method === 'percentage' ? '0.6' : '12.5'" />
            </div>
            <div class="form-field">
              <label>优先级（数值越大越优先，指定账号恒优先于角色默认）</label>
              <input v-model.number="ruleForm.priority" type="number" min="0" max="9999" />
            </div>
          </div>
          <div class="dialog-footer">
            <button class="ghost-aurora" @click="showRuleForm = false">取消</button>
            <button class="primary-action" :disabled="ruleSubmitting" @click="submitRule">{{ ruleSubmitting ? '提交中...' : '保存规则' }}</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 登记批次对话框 -->
    <Teleport to="body">
      <div v-if="showBatchForm" class="dialog-overlay" @click.self="showBatchForm = false">
        <div class="dialog-card" style="width: min(620px, 94vw);">
          <div class="dialog-header">
            <h3>登记结算批次</h3>
            <button type="button" class="dialog-close" @click="showBatchForm = false">×</button>
          </div>
          <div class="dialog-body">
            <div class="form-field">
              <label>批次名称</label>
              <input v-model="batchForm.title" placeholder="如：2026-08 第三周知乎结算" maxlength="128" />
            </div>
            <div class="form-field">
              <label>结算周期</label>
              <div style="display: flex; gap: 10px; align-items: center;">
                <input v-model="batchForm.periodStart" type="date" style="flex: 1;" />
                <span style="color: var(--ink-soft);">~</span>
                <input v-model="batchForm.periodEnd" type="date" style="flex: 1;" />
              </div>
            </div>
            <div class="form-field">
              <label>明细（来源金额归属到达人）</label>
              <div v-for="(item, i) in batchItems" :key="i" style="display: flex; gap: 8px; margin-bottom: 8px;">
                <select v-model="item.creatorId" style="flex: 2;">
                  <option value="" disabled>选择达人</option>
                  <option v-for="c in creators" :key="c.id" :value="c.id">{{ c.displayName }}（{{ c.username }}）</option>
                </select>
                <input v-model="item.sourceAmount" placeholder="金额（元）" style="flex: 1;" />
                <input v-model="item.note" placeholder="备注（可选）" style="flex: 1;" />
              </div>
              <button type="button" class="row-action" @click="addItem">+ 添加明细</button>
            </div>
          </div>
          <div class="dialog-footer">
            <button class="ghost-aurora" @click="showBatchForm = false">取消</button>
            <button class="primary-action" :disabled="batchSubmitting" @click="submitBatch">{{ batchSubmitting ? '提交中...' : '创建批次' }}</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 批次详情对话框 -->
    <Teleport to="body">
      <div v-if="detail" class="dialog-overlay" @click.self="detail = null">
        <div class="dialog-card" style="width: min(760px, 95vw);">
          <div class="dialog-header">
            <h3>{{ detail.title }}</h3>
            <button type="button" class="dialog-close" @click="detail = null">×</button>
          </div>
          <div class="dialog-body">
            <p style="margin: 0 0 14px; color: var(--ink-soft); font-size: 12px;">
              周期 {{ fmtDate(detail.periodStart) }} ~ {{ fmtDate(detail.periodEnd) }} · 来源 {{ yuan(detail.totalSource) }} · 分发 {{ yuan(detail.totalRelay) }} ·
              <span :class="['status-badge', batchBadge[detail.status]]">{{ batchStatus[detail.status] }}</span>
            </p>
            <p class="section-index quiet" style="margin-bottom: 8px;">明细</p>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
              <thead><tr style="text-align: left;"><th style="padding: 6px 0; font-size: 10px; color: var(--ink-soft);">达人</th><th style="font-size: 10px; color: var(--ink-soft);">来源金额</th><th style="font-size: 10px; color: var(--ink-soft);">备注</th></tr></thead>
              <tbody>
                <tr v-for="i in detail.items" :key="i.id" style="border-top: 1px solid var(--paper-deep);">
                  <td style="padding: 8px 0; font-size: 12px;">{{ i.creatorName }}（{{ i.creatorUsername }}）</td>
                  <td style="font-family: var(--font-mono); font-size: 11px;">{{ yuan(i.sourceAmount) }}</td>
                  <td style="font-size: 11px; color: var(--ink-soft);">{{ i.note || '—' }}</td>
                </tr>
              </tbody>
            </table>
            <template v-if="detail.logs.length">
              <p class="section-index quiet" style="margin-bottom: 8px;">中继计算快照</p>
              <table style="width: 100%; border-collapse: collapse;">
                <thead><tr style="text-align: left;"><th style="padding: 6px 0; font-size: 10px; color: var(--ink-soft);">接收方</th><th style="font-size: 10px; color: var(--ink-soft);">角色</th><th style="font-size: 10px; color: var(--ink-soft);">命中规则</th><th style="font-size: 10px; color: var(--ink-soft);">收益金额</th></tr></thead>
                <tbody>
                  <tr v-for="l in detail.logs" :key="l.id" style="border-top: 1px solid var(--paper-deep);">
                    <td style="padding: 8px 0; font-size: 12px;">{{ l.receiverName }}（{{ l.receiverUsername }}）</td>
                    <td style="font-size: 11px;">{{ l.role === 'leader' ? '团长' : '达人' }}</td>
                    <td style="font-family: var(--font-mono); font-size: 10px;">{{ l.ruleId ? `#${l.ruleId} ${l.method}` : '直通' }}</td>
                    <td style="font-family: var(--font-mono); font-size: 11px;"><strong>{{ yuan(l.relayAmount) }}</strong></td>
                  </tr>
                </tbody>
              </table>
            </template>
          </div>
          <div class="dialog-footer">
            <template v-if="detail.status === 'draft'">
              <button class="row-action danger" :disabled="acting" @click="cancelBatch(detail.id)">撤销批次</button>
              <button class="primary-action" :disabled="acting" @click="approve(detail.id)">{{ acting ? '处理中...' : '审批通过并入账' }}</button>
            </template>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
