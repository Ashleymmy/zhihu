<script setup lang="ts">
import { inject, ref, watch } from 'vue'
import type { CoreWorkspace } from './core-workspace'
const props = defineProps<{ projectId: string }>()
const w = inject<CoreWorkspace>('opc')!
type Account = { id: string; name: string; moduleId: string }
const linked = ref<Account[]>([]),
  accounts = ref<Account[]>([]),
  selected = ref(''),
  error = ref('')
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
    <h2>业务接入</h2>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="!linked.length">此项目尚未关联接入账号。</p>
    <div v-for="a in linked" :key="a.id" style="display: flex; gap: 16px; margin: 12px 0">
      <span>{{ a.name }} · {{ a.moduleId }}</span
      ><button v-if="w.role.value === 'admin'" class="row-action" @click="unlink(a.id)">解除关联</button>
    </div>
    <form v-if="w.role.value === 'admin'" @submit.prevent="link">
      <select v-model="selected" required>
        <option value="">选择接入账号</option>
        <option
          v-for="a in accounts.filter((x) => !linked.some((y) => y.id === x.id))"
          :key="a.id"
          :value="a.id"
        >
          {{ a.name }}
        </option></select
      ><button class="row-action">关联账号</button>
    </form>
  </article>
</template>
