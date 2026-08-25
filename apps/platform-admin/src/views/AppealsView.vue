<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Appeal, AppealKind, AppealStatus } from '@zhihu-koc/shared-contracts'
import { APP_ROLE } from '../app-config'
import { useAuthStore, apis } from '../stores/auth'

const auth = useAuthStore()
const appeals = ref<Appeal[]>([])
const loading = ref(true)
const error = ref('')

/* 提交申诉 */
const showForm = ref(false)
const submitting = ref(false)
const form = ref({ kind: '补款' as AppealKind, title: '', content: '', evidence: '' })

/* 审批 */
const remark = ref('')
const adjustAmount = ref('')
const acting = ref(false)

const canApply = APP_ROLE !== 'admin'
const isLeader = APP_ROLE === 'leader'
const isAdmin = APP_ROLE === 'admin'

const statusLabels: Record<AppealStatus, string> = {
  pending: '待初审',
  leader_approved: '待终审',
  approved: '已通过',
  rejected: '已驳回',
  cancelled: '已撤销',
}
const statusClass: Record<AppealStatus, string> = {
  pending: 'paused',
  leader_approved: 'paused',
  approved: 'active',
  rejected: 'rejected',
  cancelled: 'ended',
}

const leaderQueue = computed(() => appeals.value.filter((a) => a.status === 'pending' && a.applicantUsername !== auth.user?.username))
const adminQueue = computed(() => appeals.value.filter((a) => a.status === 'leader_approved'))
const myList = computed(() => appeals.value.filter((a) => a.applicantUsername === auth.user?.username))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await apis.appeals.list({ page: 1, pageSize: 100 })
    appeals.value = data.list
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}

async function submit() {
  error.value = ''
  if (!form.value.title.trim() || !form.value.content.trim()) { error.value = '请填写标题和详细说明'; return }
  submitting.value = true
  try {
    await apis.appeals.submit({
      kind: form.value.kind,
      title: form.value.title.trim(),
      content: form.value.content.trim(),
      evidence: form.value.evidence.trim() || null,
    })
    showForm.value = false
    form.value = { kind: '补款', title: '', content: '', evidence: '' }
    await load()
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { submitting.value = false }
}

async function cancel(id: string) {
  if (!confirm('确定撤销这条申诉？')) return
  try { await apis.appeals.cancel(id); await load() }
  catch (e: any) { error.value = e?.message ?? String(e) }
}

async function review(id: string, action: 'approve' | 'reject') {
  if (action === 'reject' && !remark.value.trim()) { error.value = '驳回请填写原因'; return }
  acting.value = true
  try {
    await apis.appeals.review(id, action, remark.value.trim() || undefined)
    remark.value = ''
    await load()
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { acting.value = false }
}

async function decide(id: string, action: 'approve' | 'reject') {
  if (action === 'reject' && !remark.value.trim()) { error.value = '驳回请填写原因'; return }
  const amount = adjustAmount.value.trim() ? Math.round(Number(adjustAmount.value) * 100) : null
  if (action === 'approve' && adjustAmount.value.trim() && !Number.isFinite(Number(adjustAmount.value))) {
    error.value = '调账金额不是有效数字'
    return
  }
  acting.value = true
  try {
    await apis.appeals.decide(id, action, remark.value.trim() || undefined, amount)
    remark.value = ''
    adjustAmount.value = ''
    await load()
  } catch (e: any) { error.value = e?.message ?? String(e) }
  finally { acting.value = false }
}

onMounted(load)
</script>

<template>
  <div class="page-stack">
    <header class="page-header">
      <div>
        <p class="section-index">01 / 财务申诉</p>
        <h1>{{ isAdmin ? '申诉终审与调账' : isLeader ? '申诉初审' : '财务申诉' }}</h1>
        <p>{{ isAdmin ? '复核初审通过的申诉，终审时可执行补发/扣款调账。' : isLeader ? '核实本团队成员的财务申诉，确认属实后提交管理员。' : '收益结算错误、漏算佣金、误扣等异常，可在此提交申诉，团长初审后由管理员终审。' }}</p>
      </div>
      <div class="page-actions">
        <button class="row-action" @click="load">刷新</button>
        <button v-if="canApply" class="primary-action" @click="showForm = true">提交申诉</button>
      </div>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 11px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

    <!-- 团长：初审队列 -->
    <article v-if="isLeader" class="panel data-panel">
      <div class="list-toolbar">
        <span class="toolbar-title">待我初审（本团队）</span>
        <span class="toolbar-count">{{ leaderQueue.length }}</span>
      </div>
      <div v-if="!leaderQueue.length" class="empty-panel"><span>本团队暂无待初审的申诉。</span></div>
      <div v-else class="queue-list">
        <div v-for="a in leaderQueue" :key="a.id" class="campaign-row" style="align-items: flex-start;">
          <div>
            <strong><span class="event-tag">{{ a.kind }}</span> {{ a.title }}</strong>
            <small style="white-space: normal;">{{ a.content }}</small>
            <small v-if="a.evidence" style="color: var(--ink-soft);">证据：{{ a.evidence }}</small>
            <small style="color: #9a9d9e;">{{ a.applicantName }} · {{ new Date(a.createdAt).toLocaleString('zh-CN') }}</small>
          </div>
          <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0;">
            <input v-model="remark" placeholder="驳回原因（驳回时必填）" style="width: 150px; font-size: 11px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 2px;" />
            <button class="row-action" :disabled="acting" @click="review(a.id, 'approve')">属实提交</button>
            <button class="row-action danger" :disabled="acting" @click="review(a.id, 'reject')">驳回</button>
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
      <div v-if="!adminQueue.length" class="empty-panel"><span>暂无待终审的申诉。</span></div>
      <div v-else class="queue-list">
        <div v-for="a in adminQueue" :key="a.id" class="campaign-row" style="align-items: flex-start;">
          <div>
            <strong><span class="event-tag">{{ a.kind }}</span> {{ a.title }}</strong>
            <small style="white-space: normal;">{{ a.content }}</small>
            <small v-if="a.evidence" style="color: var(--ink-soft);">证据：{{ a.evidence }}</small>
            <small style="color: #9a9d9e;">{{ a.applicantName }} · 初审：{{ a.leaderName ?? '—' }}</small>
          </div>
          <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0; flex-wrap: wrap;">
            <input v-model="adjustAmount" type="number" step="0.01" placeholder="调账（元，正补负扣，可空）" style="width: 160px; font-size: 11px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 2px;" />
            <input v-model="remark" placeholder="终审备注" style="width: 120px; font-size: 11px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 2px;" />
            <button class="row-action" :disabled="acting" @click="decide(a.id, 'approve')">终审通过</button>
            <button class="row-action danger" :disabled="acting" @click="decide(a.id, 'reject')">驳回</button>
          </div>
        </div>
      </div>
    </article>

    <!-- 我的申诉记录 -->
    <article class="panel data-panel">
      <div class="list-toolbar">
        <span class="toolbar-title">{{ canApply ? '我的申诉记录' : '全部申诉记录' }}</span>
        <span class="toolbar-count">{{ (canApply ? myList : appeals).length }}</span>
      </div>
      <div v-if="loading" class="skeleton-row" aria-label="加载中"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
      <div v-else-if="!(canApply ? myList : appeals).length" class="empty-panel"><span>暂无申诉记录。</span></div>
      <div v-else class="queue-list">
        <div v-for="a in (canApply ? myList : appeals)" :key="a.id" class="campaign-row" style="align-items: flex-start;">
          <div>
            <strong><span class="event-tag">{{ a.kind }}</span> {{ a.title }}</strong>
            <small style="white-space: normal;">{{ a.content }}</small>
            <small style="color: #9a9d9e;">
              {{ new Date(a.createdAt).toLocaleString('zh-CN') }}
              <template v-if="a.adjustAmount"> · 调账 {{ (a.adjustAmount / 100).toFixed(2) }} 元</template>
              <template v-if="a.remark"> · 终审备注：{{ a.remark }}</template>
            </small>
          </div>
          <span :class="['status-badge', statusClass[a.status]]">{{ statusLabels[a.status] }}</span>
          <button v-if="a.status === 'pending' && canApply" class="row-action" @click="cancel(a.id)">撤销</button>
        </div>
      </div>
    </article>

    <!-- 提交申诉对话框 -->
    <Teleport to="body">
      <div v-if="showForm" class="dialog-overlay" @click.self="showForm = false">
        <div class="dialog-card" style="width: min(520px, 92vw);">
          <div class="dialog-header">
            <h3>提交财务申诉</h3>
            <button type="button" class="dialog-close" @click="showForm = false">×</button>
          </div>
          <div class="dialog-body">
            <div class="form-field">
              <label>申诉类型</label>
              <select v-model="form.kind">
                <option value="补款">补款（漏算/少算收益）</option>
                <option value="扣款">扣款（申请退回误扣）</option>
                <option value="结算异议">结算异议</option>
                <option value="其他">其他</option>
              </select>
            </div>
            <div class="form-field">
              <label>标题</label>
              <input v-model="form.title" maxlength="128" placeholder="一句话说明问题" />
            </div>
            <div class="form-field">
              <label>详细说明</label>
              <textarea v-model="form.content" rows="4" maxlength="2000" placeholder="涉及的时间、关键词/订单、金额、问题描述"></textarea>
            </div>
            <div class="form-field">
              <label>证据（可选）</label>
              <textarea v-model="form.evidence" rows="2" maxlength="2000" placeholder="截图链接、数据截图说明等"></textarea>
            </div>
          </div>
          <div class="dialog-footer">
            <button class="ghost-aurora" @click="showForm = false">取消</button>
            <button class="primary-action" :disabled="submitting" @click="submit">{{ submitting ? '提交中...' : '提交申诉' }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
