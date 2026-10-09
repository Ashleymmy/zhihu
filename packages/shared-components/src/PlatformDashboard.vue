<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import type { CoreWorkspace } from './core-workspace'
import OperationGuide from './OperationGuide.vue'
const w = inject<CoreWorkspace>('opc')!
interface Todo { kind: string; count: number; label: string; actor: string; actionLabel: string; path: string }
interface Metric { key: string; label: string; value: string | null; unit: string; path: string }
interface Service { moduleId: string; accountId: string; status: string; todos: Todo[]; metrics: Metric[] }
interface Overview { period: { from: string; to: string }; projects: { id: string; name: string }[]; groups: { id: string; name: string; services: Service[] }[] }
const data = ref<Overview | null>(null), projectId = ref(''), loading = ref(false), error = ref('')
let revision = 0
async function load() {
  const version = ++revision
  loading.value = true; error.value = ''
  try {
    const result = await w.http.get<Overview>('/dashboard', projectId.value ? { projectId: projectId.value } : {})
    if (version === revision) data.value = result
  } catch { if (version === revision) error.value = '首页数据暂时没加载出来，请重试。' }
  finally { if (version === revision) loading.value = false }
}
onMounted(load)
const todos = computed(() => data.value?.groups.flatMap(project => project.services.flatMap(service =>
  service.todos.map(todo => ({ ...todo, projectName: project.name, key: project.id + ':' + service.accountId + ':' + todo.kind })))) ?? [])
const unavailable = computed(() => data.value?.groups.some(project => project.services.some(service => service.status === 'unavailable')))
const noActivity = computed(() => !!data.value?.groups.length && data.value.groups.every(project => project.services.every(service =>
  service.status === 'ready' && service.metrics.every(metric => /^0(\.0+)?$/.test(metric.value ?? '0')))))
const display = (metric: Metric) => metric.value === null ? '待核对' : metric.unit === '元'
  ? Number(metric.value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : metric.value
</script>
<template>
  <section class="page-stack home-page" :aria-busy="loading">
    <header class="page-header"><div><h1>首页</h1><p>先处理待办，再看看这个月的进展。</p></div>
      <div class="home-controls"><label>项目<select v-model="projectId" @change="load"><option value="">全部项目</option><option v-for="project in data?.projects" :key="project.id" :value="project.id">{{ project.name }}</option></select></label><button @click="load" :disabled="loading">{{ loading ? '刷新中…' : '刷新' }}</button></div>
    </header>
    <div v-if="error || unavailable" class="home-error" role="alert"><p>{{ error || '部分项目暂时没加载出来，已加载的待办仍可处理。' }}</p><button @click="load" :disabled="loading">重新加载</button></div>
    <section aria-labelledby="home-todos"><div class="home-section-title"><h2 id="home-todos">现在要做</h2><span v-if="todos.length">{{ todos.length }} 项待办</span></div>
      <div v-if="todos.length" class="home-todos"><router-link v-for="todo in todos" :key="todo.key" :to="todo.path" class="home-todo"><span class="home-todo-count">{{ todo.count }}</span><div><h3>{{ todo.label }}</h3><p>{{ todo.projectName }} · {{ todo.actor }}</p></div><span class="home-todo-action">{{ todo.actionLabel }} →</span></router-link></div>
      <article v-else-if="!loading && !error && !unavailable && data?.groups.some(group=>group.services.length)" class="panel home-empty"><h3>都处理完了</h3><p>新的任务和需要你处理的事项会显示在这里。</p><router-link v-if="['creator', 'leader'].includes(w.role.value)" to="/task-hall">去任务大厅看看 →</router-link></article>
      <p v-else-if="loading && !data" role="status">正在整理你的待办…</p>
    </section>
    <section v-if="data?.groups.length" aria-labelledby="home-projects"><div class="home-section-title"><h2 id="home-projects">我参与的项目</h2><span>{{ data.period.from }} 至 {{ data.period.to }}</span></div>
      <div class="home-projects"><article v-for="project in data.groups" :key="project.id" class="panel home-project"><h3>{{ project.name }}</h3>
        <div v-for="service in project.services" :key="service.accountId" class="home-metrics"><template v-if="service.status === 'ready'"><router-link v-for="metric in service.metrics" :key="metric.key" :to="metric.path"><span>{{ metric.label }}</span><strong>{{ display(metric) }}<small>{{ metric.unit }}</small></strong><span class="home-metric-link">查看明细 →</span></router-link></template><p v-else-if="service.status === 'unavailable'">数据暂未加载，点击上方“重新加载”。</p><p v-else>项目首页数据暂未开放。</p></div>
        <p v-if="!project.services.length">项目正在准备中。</p>
      </article></div>
    </section>
    <article v-else-if="data && !data.projects.length" class="panel home-empty"><h2>还没有参与的项目</h2><router-link :to="['creator','leader'].includes(w.role.value) ? '/me' : '/projects'">{{ ['creator','leader'].includes(w.role.value) ? '查看我的团队' : '设置项目' }} →</router-link></article>
    <OperationGuide v-if="noActivity && w.operationGuide?.value" :guide="w.operationGuide.value" />
  </section>
</template>
<style scoped>
.home-page{min-width:0}.home-controls{display:flex;align-items:end;gap:12px;flex-wrap:wrap}.home-controls label{display:grid;gap:6px;font-size:13px}.home-controls select{max-width:260px}.home-controls button,.home-error button{padding:10px 14px;border:1px solid var(--line);border-radius:8px;background:var(--paper);cursor:pointer}.home-section-title{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap}.home-section-title h2{font-size:20px;margin:0}.home-section-title>span{color:var(--ink-soft);font-size:13px}.home-todos{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,370px),1fr));gap:12px}.home-todo{display:flex;align-items:center;gap:14px;padding:20px;background:var(--paper);border:1px solid var(--line);border-radius:12px;text-decoration:none;color:inherit;min-width:0}.home-todo:hover{border-color:#195e62}.home-todo-count{font-size:28px;font-weight:700;color:#195e62;min-width:30px}.home-todo h3{font-size:16px;margin:0 0 5px}.home-todo p{font-size:13px;margin:0;color:var(--ink-soft);overflow-wrap:anywhere}.home-todo-action{margin-left:auto;color:#195e62;font-size:13px;white-space:nowrap}.home-empty{padding:26px}.home-empty h3{margin:0 0 8px}.home-empty p{color:var(--ink-soft)}.home-projects{display:grid;gap:16px}.home-project{padding:22px;min-width:0}.home-project h3{margin:0 0 18px;font-size:18px}.home-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:16px}.home-metrics a{display:grid;gap:8px;text-decoration:none;color:inherit;min-width:0;padding:12px;border-radius:8px;background:var(--ground,#f5f5f2)}.home-metrics a>span{font-size:13px;color:var(--ink-soft)}.home-metrics strong{font-size:25px;overflow-wrap:anywhere}.home-metrics small{font-size:12px;margin-left:5px;font-weight:400}.home-metrics .home-metric-link{color:#195e62;font-size:12px}.home-error{padding:16px;border:1px solid #d5a597;border-radius:10px}.home-error p{margin:0 0 10px}@media(max-width:600px){.home-todo{padding:16px;flex-wrap:wrap}.home-todo-action{margin-left:44px;width:100%}.home-controls{width:100%}.home-controls label{flex:1;min-width:0}.home-controls select{width:100%;max-width:100%}.home-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.home-project{padding:16px}.home-metrics strong{font-size:22px}}
</style>
