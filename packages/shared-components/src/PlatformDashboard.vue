<script setup lang="ts">
import { inject, onMounted, ref, watch } from 'vue'
import type { CoreWorkspace } from './core-workspace'
const w = inject<CoreWorkspace>('opc')!
const projects = ref<Array<{ id: string; name: string }>>([]),
  summaries = ref<any[]>([]),
  error = ref(''),
  loading = ref(false)
const from = ref(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)),
  to = ref(new Date().toISOString().slice(0, 10))
let revision = 0
async function loadSummary() {
  const current = ++revision
  error.value = ''
  summaries.value = []
  if (!w.projectId.value) return
  loading.value = true
  try {
    const accounts = await w.http.get<Array<{ id: string; moduleId: string; name: string; status: string }>>(
      '/projects/' + w.projectId.value + '/integrations',
    )
    const result = await Promise.all(
      accounts
        .filter((a) => a.status === 'active')
        .map(async (a) => {
          try {
            return {
              ...(await w.http.get<any>('/modules/' + a.moduleId + '/summary', {
                projectId: w.projectId.value,
                accountId: a.id,
                from: from.value,
                to: to.value,
              })),
              name: a.name,
            }
          } catch {
            return { name: a.name, status: 'unavailable', metrics: [] }
          }
        }),
    )
    if (current === revision) summaries.value = result
  } catch (e: any) {
    if (current === revision) error.value = e.message
  } finally {
    if (current === revision) loading.value = false
  }
}
onMounted(async () => {
  try {
    await w.refreshModules()
    projects.value = await w.http.get('/projects')
    if (!projects.value.some((p) => p.id === w.projectId.value))
      w.projectId.value = projects.value[0]?.id ?? ''
    else await loadSummary()
  } catch (e: any) {
    error.value = e.message
  }
})
watch(w.projectId, loadSummary)
</script>
<template>
  <section class="page-stack">
    <header class="page-header">
      <div>
        <p class="eyebrow">OPC / WORKSPACE</p>
        <h1>工作台</h1>
        <p>按项目查看业务模块与运营数据。</p>
      </div>
      <router-link to="/modules">管理业务模块</router-link>
    </header>
    <p v-if="error" role="alert">{{ error }}</p>
    <article class="panel" style="padding: 24px">
      <div class="form-grid">
        <label
          >业务项目<select v-model="w.projectId.value">
            <option value="">选择项目</option>
            <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select></label
        ><label>开始日期<input type="date" v-model="from" /></label
        ><label>结束日期<input type="date" v-model="to" /></label
        ><button class="primary-action" @click="loadSummary" :disabled="loading || !w.projectId.value">
          查询
        </button>
      </div>
      <p v-if="!projects.length">还没有业务项目，请先在项目管理中创建项目。</p>
    </article>
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px">
      <article
        v-for="m in w.modules.value.filter((x) => x.status === 'enabled')"
        :key="m.id"
        class="panel"
        style="padding: 24px"
      >
        <h2>{{ m.name }}</h2>
        <router-link :to="m.entryPath">进入业务模块</router-link>
      </article>
    </div>
    <p v-if="loading">正在加载项目数据…</p>
    <p v-else-if="w.projectId.value && !summaries.length">此项目尚未关联可用接入账号。</p>
    <article v-for="(s, i) in summaries" :key="i" class="panel" style="padding: 24px">
      <h2>{{ s.name }}</h2>
      <p v-if="s.status === 'unavailable'">此业务尚未提供公共汇总，或当前暂时不可用。可进入业务模块查看。</p>
      <p v-else-if="s.status === 'empty'">该时间范围暂无数据。</p>
      <div v-else v-for="metric in s.metrics" :key="metric.key">
        <span>{{ metric.label }}：</span
        ><strong>{{ metric.value === null ? '暂无数据' : metric.value }}</strong> {{ metric.unit }}
      </div>
    </article>
  </section>
</template>
