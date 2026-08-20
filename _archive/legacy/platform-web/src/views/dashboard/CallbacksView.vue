<template>
  <div class="cb-page">
    <div class="pg-header">
      <div><h1 class="pg-title">绑词回传</h1><p class="pg-sub">配置转化回传接口，追踪每个词条的事件归因与转化链路</p></div>
    </div>

    <a-tabs v-model:activeKey="activeTab" class="z-tabs" @change="onTabChange">
      <!-- ── Tab1: 规则管理 ── -->
      <a-tab-pane key="rules" tab="回传规则">
        <div class="tab-toolbar">
          <a-button v-if="canConfig" type="primary" @click="openCreateModal">
            <template #icon><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></template>
            新建规则
          </a-button>
          <button class="btn-ghost" :disabled="rulesLoading" @click="loadRules">刷新</button>
        </div>
        <div class="table-card">
          <a-table :data-source="rules" :loading="rulesLoading" row-key="id" size="middle"
                   :pagination="{ total: rulesTotal, pageSize: rulesPageSize, current: rulesPage, onChange: onRulesPage }"
                   :locale="{ emptyText: '暂无回传规则，点击「新建规则」开始配置' }">
            <a-table-column title="关键词" data-index="keyword" :ellipsis="true" />
            <a-table-column title="回传地址" data-index="callbackUrl" :ellipsis="true" />
            <a-table-column title="事件" :width="220">
              <template #default="{ record }">
                <div class="event-tags">
                  <span v-for="e in record.events" :key="e" class="event-tag">{{ e }}</span>
                </div>
              </template>
            </a-table-column>
            <a-table-column title="成功率" :width="90" align="right">
              <template #default="{ record }">
                <span v-if="record.totalCalls > 0"
                      :class="['rate-val', record.successRate >= 95 ? 'rate-good' : record.successRate >= 80 ? 'rate-warn' : 'rate-bad']">
                  {{ record.successRate.toFixed(1) }}%
                </span>
                <span v-else class="rate-na">—</span>
              </template>
            </a-table-column>
            <a-table-column title="调用次数" data-index="totalCalls" :width="90" align="right" />
            <a-table-column title="状态" :width="80">
              <template #default="{ record }">
                <a-switch :checked="record.status === 'active'" size="small"
                          :loading="togglingId === record.id"
                          :disabled="!canConfig"
                          @change="(value: unknown) => toggleStatus(record, value === true)" />
              </template>
            </a-table-column>
            <a-table-column title="操作" :width="110">
              <template #default="{ record }">
                <button class="act-btn" :disabled="!canConfig" @click="openEditModal(record)">编辑</button>
                <a-popconfirm title="确认删除该回传规则？" ok-text="删除" cancel-text="取消"
                              ok-type="danger" @confirm="deleteRule(record.id)">
                  <button class="act-btn danger" :disabled="!canConfig" style="margin-left:6px">删除</button>
                </a-popconfirm>
              </template>
            </a-table-column>
          </a-table>
        </div>
      </a-tab-pane>

      <!-- ── Tab2: 回传日志 ── -->
      <a-tab-pane key="logs" tab="回传日志">
        <div class="tab-toolbar">
          <a-select v-model:value="logStatusFilter" placeholder="全部状态" style="width:130px" allow-clear @change="() => { logsPage = 1; loadLogs() }">
            <a-select-option value="success">成功</a-select-option>
            <a-select-option value="failed">失败</a-select-option>
            <a-select-option value="retry">重试中</a-select-option>
          </a-select>
          <button class="btn-ghost" :disabled="logsLoading" @click="loadLogs">刷新</button>
        </div>
        <div class="table-card">
          <a-table :data-source="logs" :loading="logsLoading" row-key="id" size="middle"
                   :pagination="{ total: logsTotal, pageSize: logsPageSize, current: logsPage, onChange: onLogsPage }"
                   :locale="{ emptyText: '暂无回传日志' }">
            <a-table-column title="时间" data-index="createdAt" :width="160" />
            <a-table-column title="关键词" data-index="keyword" :ellipsis="true" />
            <a-table-column title="事件" data-index="event" :width="120" />
            <a-table-column title="状态" :width="90">
              <template #default="{ record }">
                <span :class="['badge', record.status==='success'?'badge-success':record.status==='failed'?'badge-error':'badge-warning']">
                  <span class="badge-dot"/>{{ { success:'成功', failed:'失败', retry:'重试' }[record.status as string] ?? record.status }}
                </span>
              </template>
            </a-table-column>
            <a-table-column title="状态码" :width="80" align="right">
              <template #default="{ record }">
                <span :class="record.responseCode && record.responseCode < 300 ? 'code-ok' : 'code-err'">
                  {{ record.responseCode ?? '—' }}
                </span>
              </template>
            </a-table-column>
            <a-table-column title="延迟" :width="80" align="right">
              <template #default="{ record }">{{ record.latency != null ? record.latency + 'ms' : '—' }}</template>
            </a-table-column>
          </a-table>
        </div>
      </a-tab-pane>

      <!-- ── Tab3: 密钥配置 ── -->
      <a-tab-pane key="secret" tab="密钥">
        <div class="secret-card">
          <div class="secret-head">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            回传验签密钥
          </div>
          <p class="secret-desc">用于验证回传请求来源。每次轮换后旧密钥立即失效，请在轮换前完成接收端的验签更新。</p>

          <div v-if="secretLoading" class="secret-row">
            <div class="skeleton" style="height:36px;width:360px;border-radius:6px"></div>
          </div>
          <div v-else-if="secretVal" class="secret-row">
            <code class="secret-val">{{ secretVisible ? secretVal : secretVal.replace(/./g, '•') }}</code>
            <button class="icon-btn" title="显示/隐藏" @click="secretVisible = !secretVisible">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <template v-if="!secretVisible"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></template>
                <template v-else><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22"/></template>
              </svg>
            </button>
            <button class="icon-btn" title="复制" @click="copySecret">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
          </div>
          <a-button v-else @click="fetchSecret">查看密钥</a-button>

          <a-popconfirm v-if="canSecret" title="轮换后旧密钥立即失效，确认继续？" ok-text="确认轮换" cancel-text="取消" @confirm="rotateSecret">
            <a-button danger :loading="rotating" style="margin-top:20px">轮换密钥</a-button>
          </a-popconfirm>
        </div>
      </a-tab-pane>
    </a-tabs>

    <!-- 创建/编辑规则 Modal -->
    <a-modal v-model:open="ruleModalOpen" :title="editingRule ? '编辑回传规则' : '新建回传规则'"
             :confirm-loading="ruleSubmitting" ok-text="保存" cancel-text="取消"
             @ok="submitRule" @cancel="resetRuleForm">
      <a-form ref="ruleFormRef" :model="ruleForm" layout="vertical" style="margin-top:8px">
        <a-form-item label="Plan ID" name="planId" :rules="[{required:true,message:'请填写 Plan ID'}]">
          <a-input v-model:value="ruleForm.planId" placeholder="推广计划 ID" :disabled="!!editingRule" />
        </a-form-item>
        <a-form-item label="回传地址" name="callbackUrl"
                     :rules="[{required:true,message:'请填写回传 URL'},{type:'url',message:'URL 格式不合法'}]">
          <a-input v-model:value="ruleForm.callbackUrl" placeholder="https://your-domain.com/callback" />
        </a-form-item>
        <a-form-item label="回传事件" name="events" :rules="[{required:true,type:'array',min:1,message:'至少选一个事件'}]">
          <a-checkbox-group v-model:value="ruleForm.events" :options="EVENT_OPTIONS" />
        </a-form-item>
        <a-form-item label="状态">
          <a-switch v-model:checked="ruleFormActive" checked-children="启用" un-checked-children="停用" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { callbacksApi } from '@/api/callbacks'
import { usePermission, Perms } from '@/composables/usePermission'
import type { CallbackRule, CallbackLog } from '@/types/api'

const { can } = usePermission()
const canConfig = computed(() => can(Perms.CALLBACK_CONFIG))
const canSecret = computed(() => can(Perms.CALLBACK_SECRET))

/* ── 标签页 ──────────────────────────────── */
const activeTab = ref('rules')
function onTabChange(key: string | number) {
  if (key === 'logs' && !logs.value.length) loadLogs()
}

/* ── 规则管理 ────────────────────────────── */
const rules        = ref<CallbackRule[]>([])
const rulesLoading = ref(false)
const rulesTotal   = ref(0)
const rulesPage    = ref(1)
const rulesPageSize = 10
const togglingId   = ref<string | null>(null)

async function loadRules() {
  rulesLoading.value = true
  try {
    const res = await callbacksApi.listRules({ page: rulesPage.value, pageSize: rulesPageSize })
    rules.value     = res.list
    rulesTotal.value = res.total
  } finally { rulesLoading.value = false }
}
async function onRulesPage(p: number) { rulesPage.value = p; await loadRules() }

async function toggleStatus(rule: CallbackRule, active: boolean) {
  togglingId.value = rule.id
  try {
    const updated = await callbacksApi.updateRule(rule.id, { status: active ? 'active' : 'inactive' })
    const idx = rules.value.findIndex(r => r.id === rule.id)
    if (idx !== -1) rules.value[idx] = updated
  } finally { togglingId.value = null }
}

async function deleteRule(id: string) {
  await callbacksApi.deleteRule(id)
  message.success('已删除')
  await loadRules()
}

/* ── 创建 / 编辑规则 ─────────────────────── */
const ruleModalOpen  = ref(false)
const ruleSubmitting = ref(false)
const editingRule    = ref<CallbackRule | null>(null)
const ruleFormRef    = ref<any>()
const ruleFormActive = ref(true)
const ruleForm       = ref({ planId: '', callbackUrl: '', events: [] as string[] })

const EVENT_OPTIONS = [
  { label: '点击 (click)',       value: 'click' },
  { label: '转化 (conversion)',  value: 'conversion' },
  { label: '注册 (register)',    value: 'register' },
  { label: '付费 (purchase)',    value: 'purchase' },
  { label: '激活 (activate)',    value: 'activate' },
]

function openCreateModal() {
  editingRule.value = null
  ruleForm.value    = { planId: '', callbackUrl: '', events: [] }
  ruleFormActive.value = true
  ruleModalOpen.value  = true
}
function openEditModal(rule: CallbackRule) {
  editingRule.value    = rule
  ruleForm.value       = { planId: rule.planId, callbackUrl: rule.callbackUrl, events: [...rule.events] }
  ruleFormActive.value = rule.status === 'active'
  ruleModalOpen.value  = true
}
function resetRuleForm() { ruleModalOpen.value = false; editingRule.value = null }

async function submitRule() {
  await ruleFormRef.value?.validate()
  ruleSubmitting.value = true
  try {
    const payload = {
      callbackUrl: ruleForm.value.callbackUrl,
      events: ruleForm.value.events,
      status: ruleFormActive.value ? 'active' as const : 'inactive' as const,
    }
    if (editingRule.value) {
      await callbacksApi.updateRule(editingRule.value.id, payload)
      message.success('规则已更新')
    } else {
      await callbacksApi.createRule({ planId: ruleForm.value.planId, ...payload })
      message.success('规则已创建')
    }
    ruleModalOpen.value = false
    await loadRules()
  } finally { ruleSubmitting.value = false }
}

/* ── 日志 ────────────────────────────────── */
const logs            = ref<CallbackLog[]>([])
const logsLoading     = ref(false)
const logsTotal       = ref(0)
const logsPage        = ref(1)
const logsPageSize    = 15
const logStatusFilter = ref<string | undefined>(undefined)

async function loadLogs() {
  logsLoading.value = true
  try {
    const res = await callbacksApi.listLogs({
      page: logsPage.value,
      pageSize: logsPageSize,
      status: logStatusFilter.value as any,
    })
    logs.value      = res.list
    logsTotal.value = res.total
  } finally { logsLoading.value = false }
}
async function onLogsPage(p: number) { logsPage.value = p; await loadLogs() }

/* ── 密钥管理 ────────────────────────────── */
const secretVal     = ref('')
const secretVisible = ref(false)
const secretLoading = ref(false)
const rotating      = ref(false)

async function fetchSecret() {
  secretLoading.value = true
  try {
    const res   = await callbacksApi.getSecret()
    secretVal.value = res.secret
  } finally { secretLoading.value = false }
}
async function rotateSecret() {
  rotating.value = true
  try {
    const res   = await callbacksApi.rotateSecret()
    secretVal.value    = res.secret
    secretVisible.value = true
    message.success('密钥已轮换，请及时更新接收端配置')
  } finally { rotating.value = false }
}
async function copySecret() {
  if (secretVal.value) {
    await navigator.clipboard.writeText(secretVal.value)
    message.success('密钥已复制')
  }
}

onMounted(loadRules)
</script>

<style scoped>
.cb-page { padding-bottom: 16px; }
.pg-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; }
.pg-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 4px; }
.pg-sub { font-size: 12.5px; color: var(--color-text-disabled); }
.z-tabs :deep(.ant-tabs-nav) { margin-bottom: 16px; }
.tab-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.btn-ghost { padding: 6px 14px; background: none; border: 1px solid var(--color-border); border-radius: var(--radius-md); font-size: 12.5px; color: var(--color-text-tertiary); cursor: pointer; transition: all var(--transition-fast); }
.btn-ghost:hover:not(:disabled) { border-color: var(--color-border-hover); color: var(--color-text-secondary); }
.btn-ghost:disabled { opacity: 0.45; cursor: not-allowed; }
.table-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; }
.event-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.event-tag { padding: 2px 7px; background: var(--color-accent-subtle); border: 1px solid var(--color-accent-border); border-radius: var(--radius-full); font-size: 11px; color: var(--color-accent); }
.rate-val { font-family: var(--font-mono); font-size: 12.5px; font-weight: 600; }
.rate-good { color: var(--color-success); }
.rate-warn { color: var(--color-warning); }
.rate-bad  { color: var(--color-error); }
.rate-na { color: var(--color-text-disabled); }
.act-btn { padding: 4px 10px; background: var(--color-bg-active); border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-size: 11.5px; color: var(--color-text-secondary); cursor: pointer; transition: all var(--transition-fast); }
.act-btn:hover:not(:disabled) { border-color: var(--color-accent); color: var(--color-accent); }
.act-btn.danger:hover:not(:disabled) { border-color: var(--color-error); color: var(--color-error); }
.act-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.code-ok  { color: var(--color-success); font-family: var(--font-mono); font-size: 12px; }
.code-err { color: var(--color-error);   font-family: var(--font-mono); font-size: 12px; }
/* Secret */
.secret-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 24px; max-width: 600px; }
.secret-head { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 8px; }
.secret-desc { font-size: 12.5px; color: var(--color-text-disabled); line-height: 1.6; margin-bottom: 20px; }
.secret-row { display: flex; align-items: center; gap: 8px; }
.secret-val { font-family: var(--font-mono); font-size: 13.5px; color: var(--color-text-primary); background: var(--color-bg-active); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 8px 14px; flex: 1; word-break: break-all; }
.icon-btn { width: 30px; height: 30px; background: var(--color-bg-active); border: 1px solid var(--color-border); border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; color: var(--color-text-tertiary); cursor: pointer; transition: all var(--transition-fast); flex-shrink: 0; }
.icon-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }
</style>
