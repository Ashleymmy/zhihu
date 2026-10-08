<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import type { CoreWorkspace } from './core-workspace'
const props = defineProps<{ projectId: string }>()
const w = inject<CoreWorkspace>('opc')!
type Account = { id: string; name: string; moduleId: string; accountKey: string; status: 'active' | 'disabled' }
const linked = ref<Account[]>([]),
  accounts = ref<Account[]>([]),
  selected = ref(''),
  error = ref('')
const available = computed(() =>
  accounts.value.filter((account) => account.status === 'active' && !linked.value.some((item) => item.id === account.id)),
)
async function load() {
  try {
    linked.value = await w.http.get('/projects/' + props.projectId + '/integrations')
    accounts.value = await w.http.get('/integrations')
  } catch (e: any) {
    error.value = e.message
  }
}
async function link() {
  try {
    await w.http.post('/projects/' + props.projectId + '/integrations', { accountId: selected.value })
    selected.value = ''
    await load()
  } catch (e: any) {
    error.value = e.message
  }
}
async function unlink(id: string) {
  if (!confirm('停止此项目的数据接入后，新任务和报表处理会暂停，已有记录保留。确定停止接入？')) return
  try {
    await w.http.del('/projects/' + props.projectId + '/integrations/' + id)
    await load()
  } catch (e: any) {
    error.value = e.message
  }
}
watch(() => props.projectId, load, { immediate: true })
</script>
<template>
  <article class="panel" style="padding: 24px">
    <h2>接入状态</h2>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="!linked.length">此项目还没有接通业务服务。</p>
    <div v-for="a in linked" :key="a.id" style="display: flex; gap: 16px; margin: 12px 0; align-items: center">
      <span>{{ w.modules.value.find(m=>m.id===a.moduleId)?.name ?? '业务服务' }} <small style="color: var(--ink-soft)">{{ a.status === 'active' ? '已接通' : '已停用' }}</small></span>
    </div>
    <form v-if="['developer','admin'].includes(w.role.value) && available.length" @submit.prevent="link">
      <select v-model="selected" required>
        <option value="">选择业务服务</option>
        <option v-for="a in available" :key="a.id" :value="a.id">
          {{ w.modules.value.find(m=>m.id===a.moduleId)?.name ?? a.name }}
        </option></select
      ><button class="row-action" :disabled="!selected">接通服务</button>
    </form>
    <details v-if="['developer','admin'].includes(w.role.value) && linked.length"><summary>管理连接</summary><p>停止接入会暂停该项目的新任务和报表处理。</p><button v-for="a in linked" :key="a.id" class="row-action" @click="unlink(a.id)">停止{{ w.modules.value.find(m=>m.id===a.moduleId)?.name ?? '业务服务' }}接入</button></details>
  </article>
</template>
