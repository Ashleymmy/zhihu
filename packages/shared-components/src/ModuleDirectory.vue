<script setup lang="ts">
import { inject, onMounted, ref } from 'vue'
import type { CoreWorkspace } from './core-workspace'
const w = inject<CoreWorkspace>('opc')!
type Account = { id: string; moduleId: string; name: string; accountKey: string; status: string }
const accounts = ref<Account[]>([]),
  error = ref(''),
  busy = ref(false)
const form = ref({ moduleId: '', accountKey: '', name: '' })
async function load() {
  error.value = ''
  try {
    await w.refreshModules()
    accounts.value = await w.http.get<Account[]>('/integrations')
  } catch (e: any) {
    error.value = e.message
  }
}
async function create() {
  busy.value = true
  try {
    await w.http.post('/integrations', form.value)
    form.value = { moduleId: '', accountKey: '', name: '' }
    await load()
  } catch (e: any) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
async function toggle(a: Account) {
  try {
    await w.http.patch('/integrations/' + a.id, { status: a.status === 'active' ? 'disabled' : 'active' })
    await load()
  } catch (e: any) {
    error.value = e.message
  }
}
onMounted(load)
</script>
<template>
  <section class="page-stack">
    <header class="page-header">
      <div>
        <p class="eyebrow">OPC / MODULES</p>
        <h1>业务模块</h1>
      </div>
      <button class="row-action" @click="load">刷新状态</button>
    </header>
    <p v-if="error" role="alert">{{ error }}</p>
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px">
      <article v-for="m in w.modules.value" :key="m.id" class="panel" style="padding: 24px">
        <h2>{{ m.name }}</h2>
        <p>{{ m.status === 'enabled' ? '已启用' : m.status === 'disabled' ? '未启用' : '暂时不可用' }}</p>
        <p v-if="m.accountMessage">{{ m.accountMessage }}</p>
        <p v-if="m.message">{{ m.message }}</p>
        <router-link v-if="m.status === 'enabled'" :to="m.entryPath">进入业务</router-link>
      </article>
    </div>
    <p v-if="!w.modules.value.length">暂无可用业务模块。</p>
    <article class="panel" style="padding: 24px">
      <h2>接入账号</h2>
      <p v-if="!accounts.length">暂无接入账号。</p>
      <div
        v-for="a in accounts"
        :key="a.id"
        style="display: flex; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--line)"
      >
        <span>{{ a.name }}</span
        ><span>{{ a.moduleId }} · {{ a.status === 'active' ? '启用' : '停用' }}</span
        ><button v-if="w.role.value === 'admin'" class="row-action" @click="toggle(a)">
          {{ a.status === 'active' ? '停用' : '启用' }}
        </button>
      </div>
      <form
        v-if="
          w.role.value === 'admin' &&
          w.modules.value.some((x) => x.status === 'enabled' && x.accountCreation !== 'managed')
        "
        class="form-grid"
        style="margin-top: 20px"
        @submit.prevent="create"
      >
        <label
          >业务模块<select v-model="form.moduleId" required>
            <option value="">选择模块</option>
            <option
              v-for="m in w.modules.value.filter(
                (x) => x.status === 'enabled' && x.accountCreation !== 'managed',
              )"
              :key="m.id"
              :value="m.id"
            >
              {{ m.name }}
            </option>
          </select></label
        ><label>账号标识<input v-model="form.accountKey" required maxlength="128" /></label
        ><label>显示名称<input v-model="form.name" required maxlength="128" /></label
        ><button class="primary-action" :disabled="busy">添加接入账号</button>
      </form>
    </article>
  </section>
</template>
