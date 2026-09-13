<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { errorText, type EngineContext } from './context'
const props = defineProps<{ context: EngineContext }>()
interface Route {
  exclusiveFrom: string
  mode: string
  reason: string
  sampleVerified: boolean
}
interface Legacy {
  planId: string
  keyword: string
  sharedCount: number
  sourceDays: number
  exclusiveKeywordId: string | null
}
const route = ref<Route | null>(null),
  inventory = ref<Legacy[]>([]),
  page = ref(1),
  total = ref(0),
  busy = ref(false),
  error = ref(''),
  notice = ref('')
const form = reactive({
  from: '',
  mode: 'trial',
  reason: '',
  sampleVerified: false,
})
const modes: Record<string, string> = {
  trial: '试算中',
  enabled: '已启用对账确认',
  stopped: '已停止新写入',
}
async function load() {
  route.value = await props.context.http.get<Route | null>(
    '/engine-route',
    props.context.scope,
  )
  if (route.value) {
    form.from = route.value.exclusiveFrom
    form.mode = route.value.mode
  }
  const r = await props.context.http.get<{ list: Legacy[]; total: number }>(
    '/legacy-inventory',
    { ...props.context.scope, page: page.value, pageSize: 25 },
  )
  inventory.value = r.list
  total.value = r.total
}
async function run(work: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await work()
    if (work !== load) await load()
    notice.value = '已更新'
  } catch (e) {
    error.value = errorText(e)
  } finally {
    busy.value = false
  }
}
onMounted(() => run(load))
</script>
<template>
  <section class="engine-panel">
    <h2>试算与切换</h2>
    <p v-if="error" role="alert" class="engine-error">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p>
      当前状态：{{
        route ? modes[route.mode] : '尚未配置，请先确定新来源的起始日期'
      }}
    </p>
    <p class="engine-note">
      起始日期之后的来源由新引擎独占处理。日期登记后不可移动；停止写入会保留事实、历史确认与调整，也不会把来源交回旧财务。
    </p>
    <form
      @submit.prevent="
        run(() =>
          context.http.post('/engine-route', { ...context.scope, ...form }),
        )
      "
    >
      <label
        >新引擎起始日期<input
          v-model="form.from"
          type="date"
          required
          :disabled="!!route" /></label
      ><label
        >状态<select v-model="form.mode">
          <option value="trial">试算</option>
          <option v-if="route" value="enabled">启用对账确认</option>
          <option v-if="route" value="stopped">停止新写入</option>
        </select></label
      ><label
        >核对或变更依据<input
          v-model="form.reason"
          required
          maxlength="1000" /></label
      ><label v-if="form.mode === 'enabled'"
        ><span
          ><input v-model="form.sampleVerified" type="checkbox" required />
          已核对真实报告表头、日期、金额单位和代表性样本</span
        ></label
      ><button :disabled="busy">保存边界与状态</button>
    </form>
    <h2>历史关键词盘点</h2>
    <p class="engine-note">
      历史词和金额保持原值。多人共用、缺来源或缺关系证据的词留在历史流程；新周期创建新词，不自动分配历史收益。
    </p>
    <div class="engine-table">
      <table>
        <thead>
          <tr>
            <th>旧计划</th>
            <th>关键词</th>
            <th>同词计划数</th>
            <th>历史数据天数</th>
            <th>处理建议</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in inventory" :key="p.planId">
            <td>{{ p.planId }}</td>
            <td>{{ p.keyword }}</td>
            <td>{{ p.sharedCount }}</td>
            <td>{{ p.sourceDays }}</td>
            <td>
              {{
                p.exclusiveKeywordId
                  ? '新词库管理'
                  : Number(p.sharedCount) > 1
                    ? '历史共词，保持隔离'
                    : '保留历史，使用新词进入新周期'
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="!inventory.length">暂无历史关键词。</p>
    <div class="engine-actions">
      <button
        :disabled="busy || page <= 1"
        @click="
          () => {
            page--
            run(load)
          }
        "
      >
        上一页</button
      ><span>共 {{ total }} 条</span
      ><button
        :disabled="busy || page * 25 >= total"
        @click="
          () => {
            page++
            run(load)
          }
        "
      >
        下一页
      </button>
    </div>
  </section>
</template>
