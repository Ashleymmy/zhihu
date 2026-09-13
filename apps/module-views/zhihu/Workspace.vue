<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import type { HttpClient } from '@zhihu-koc/shared-services/core'
import Keywords from './Keywords.vue'
import Prices from './Prices.vue'
import Reports from './Reports.vue'
import Statements from './Statements.vue'
import Setup from './Setup.vue'
import { errorText, type EngineOptions, type Option } from './context'
const props = defineProps<{
  http: HttpClient
  coreHttp: HttpClient
  role: string
  userId: string
}>()
const projects = ref<Option[]>([]),
  accounts = ref<Option[]>([]),
  error = ref(''),
  loading = ref(false)
const scope = reactive({ projectId: '', accountId: '' })
const options = ref<EngineOptions>({
  tasks: [],
  channels: [],
  mappings: [],
  users: [],
})
const ready = ref(false)
const tab = ref('keywords')
const context = computed(() => ({
  http: props.http,
  scope: { ...scope },
  role: props.role,
  userId: props.userId,
  options: options.value,
}))
let generation = 0
async function refreshOptions() {
  ready.value = false
  error.value = ''
  const revision = ++generation
  if (!scope.projectId || !scope.accountId) return
  loading.value = true
  try {
    const result = await props.http.get<EngineOptions>(
      '/attribution-options',
      scope,
    )
    if (revision === generation) {
      options.value = result
      ready.value = true
    }
  } catch (e) {
    if (revision === generation) error.value = errorText(e)
  } finally {
    if (revision === generation) loading.value = false
  }
}
watch(
  () => scope.projectId,
  async () => {
    scope.accountId = ''
    accounts.value = []
    ready.value = false
    const id = scope.projectId
    if (!id) return
    try {
      const result = await props.coreHttp.get<
        (Option & { moduleId: string; status: string })[]
      >(`/projects/${id}/integrations`)
      if (scope.projectId === id) {
        accounts.value = result.filter(
          (a) => a.moduleId === 'zhihu' && a.status === 'active',
        )
        scope.accountId = accounts.value[0]?.id ?? ''
      }
    } catch (e) {
      error.value = errorText(e)
    }
  },
)
watch(() => scope.accountId, refreshOptions)
onMounted(async () => {
  try {
    projects.value = await props.coreHttp.get<Option[]>('/projects')
    scope.projectId = projects.value[0]?.id ?? ''
  } catch (e) {
    error.value = errorText(e)
  }
})
</script>
<template>
  <section class="engine page-stack">
    <header>
      <h1>知乎归因与对账</h1>
      <p>按独占关键词确认业绩，按推广任务报价核对各层应付。</p>
    </header>
    <div class="engine-controls">
      <label
        >业务项目<select v-model="scope.projectId">
          <option value="">选择项目</option>
          <option v-for="p in projects" :key="p.id" :value="p.id">
            {{ p.name }}
          </option>
        </select></label
      >
      <label
        >接入账号<select v-model="scope.accountId">
          <option value="">选择账号</option>
          <option v-for="a in accounts" :key="a.id" :value="a.id">
            {{ a.name }}
          </option>
        </select></label
      >
    </div>
    <p v-if="error" role="alert" class="engine-error">{{ error }}</p>
    <p v-if="loading" role="status">正在加载…</p>
    <p v-if="!loading && !ready && !error">
      请先选择已关联知乎接入账号的项目。未配置项目关联时，请由管理员在业务项目中维护。
    </p>
    <nav v-if="ready" class="engine-actions" aria-label="归因功能">
      <button @click="tab = 'keywords'">关键词</button
      ><button @click="tab = 'prices'">任务报价</button
      ><button @click="tab = 'reports'">报告与归因</button
      ><button @click="tab = 'statements'">作品与对账</button
      ><button v-if="role === 'admin'" @click="tab = 'setup'">
        试算与切换
      </button>
    </nav>
    <Keywords
      v-if="ready && tab === 'keywords'"
      :key="scope.projectId + '-' + scope.accountId"
      :context="context"
      @refresh="refreshOptions"
    />
    <Prices
      v-if="ready && tab === 'prices'"
      :key="scope.projectId + '-' + scope.accountId"
      :context="context"
    />
    <Reports
      v-if="ready && tab === 'reports'"
      :key="scope.projectId + '-' + scope.accountId"
      :context="context"
    />
    <Statements
      v-if="ready && tab === 'statements'"
      :key="scope.projectId + '-' + scope.accountId"
      :context="context"
    />
    <Setup
      v-if="ready && tab === 'setup' && role === 'admin'"
      :key="scope.projectId + '-' + scope.accountId"
      :context="context"
    />
  </section>
</template>
<style>
.engine {
  max-width: 1280px;
  margin: auto;
}
.engine header p,
.engine-note {
  color: var(--ink-soft, #52606d);
}
.engine-controls,
.engine form {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  align-items: end;
}
.engine label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 150px;
  flex: 1;
}
.engine input,
.engine select,
.engine textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 38px;
  padding: 8px;
  border: 1px solid var(--line, #ccd3d9);
  border-radius: 6px;
  background: var(--paper, #fff);
  color: inherit;
}
.engine button {
  padding: 8px 12px;
  cursor: pointer;
  border: 1px solid var(--line, #ccd3d9);
  border-radius: 6px;
  background: var(--paper, #fff);
  color: inherit;
}
.engine button:disabled {
  opacity: 0.5;
  cursor: wait;
}
.engine-panel {
  border: 1px solid var(--line, #ccd3d9);
  border-radius: 10px;
  padding: 20px;
  margin-top: 18px;
  background: var(--paper, #fff);
}
.engine h2 {
  font-size: 18px;
  margin: 0 0 16px;
}
.engine-table {
  overflow: auto;
  margin-top: 16px;
}
.engine table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}
.engine th,
.engine td {
  padding: 10px;
  border-bottom: 1px solid var(--line, #ccd3d9);
  white-space: nowrap;
}
.engine-error {
  color: #a51f28;
}
.engine-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.engine [role='status'] {
  color: var(--ink-soft, #52606d);
}
.engine button:focus-visible,
.engine input:focus-visible,
.engine select:focus-visible {
  outline: 2px solid #226899;
  outline-offset: 2px;
}
</style>
