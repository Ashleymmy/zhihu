<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { errorText, requestKey, type EngineContext } from './context'
const props = defineProps<{ context: EngineContext }>()
interface Price {
  versionId: string
  taskId: string
  payerKind: string
  payerId: string
  payeeId: string
  price: string
  startDay: string
  endDay: string | null
  priceStatus: string
}
const list = ref<Price[]>([]),
  page = ref(1),
  total = ref(0),
  busy = ref(false),
  error = ref(''),
  success = ref('')
const form = reactive({
  taskId: '',
  payeeId: '',
  unitPrice: '',
  from: '',
  to: '',
  reason: '',
})
const name = (id: string) =>
  props.context.options.users.find((x) => String(x.id) === String(id))
    ?.displayName ?? `成员 ${id}`
async function load() {
  const r = await props.context.http.get<{ list: Price[]; total: number }>(
    '/price-agreements',
    { ...props.context.scope, page: page.value, pageSize: 25 },
  )
  list.value = r.list
  total.value = r.total
}
async function run(work: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  success.value = ''
  try {
    await work()
    if (work !== load) await load()
    success.value = '报价操作已保存'
  } catch (e) {
    error.value = errorText(e)
  } finally {
    busy.value = false
  }
}
const post = (path: string, input: object) =>
  props.context.http.post(path, {
    ...props.context.scope,
    ...input,
    requestKey: requestKey(),
  })
onMounted(() => run(load))
</script>
<template>
  <section class="engine-panel">
    <h2>任务级报价</h2>
    <p class="engine-note">
      价格单位为元 / 有效订单。同一任务的全部关键词适用；未来调价按生效日切换。
    </p>
    <form
      v-if="context.role !== 'creator'"
      @submit.prevent="
        run(() =>
          post('/price-agreements', { ...form, to: form.to || undefined }),
        )
      "
    >
      <label
        >推广任务<select v-model="form.taskId" required>
          <option value="">选择任务</option>
          <option v-for="t in context.options.tasks" :key="t.id" :value="t.id">
            {{ t.name }}
          </option>
        </select></label
      >
      <label
        >收款成员<select v-model="form.payeeId" required>
          <option value="">选择成员</option>
          <option
            v-for="u in context.options.users.filter((u) =>
              context.role === 'admin'
                ? u.role === 'leader' || (u.role === 'creator' && !u.parentId)
                : String(u.parentId) === context.userId,
            )"
            :key="u.id"
            :value="u.id"
          >
            {{ u.displayName }}
          </option>
        </select></label
      >
      <label
        >每单金额<input
          v-model="form.unitPrice"
          inputmode="decimal"
          pattern="[0-9]+(\.[0-9]{1,4})?"
          required /></label
      ><label>生效日<input v-model="form.from" type="date" required /></label
      ><label>截止日（不含）<input v-model="form.to" type="date" /></label
      ><label
        >报价或调价原因<input
          v-model="form.reason"
          required
          maxlength="500" /></label
      ><button :disabled="busy">保存草稿</button>
    </form>
    <p v-if="error" role="alert" class="engine-error">{{ error }}</p>
    <p v-if="success" role="status">{{ success }}</p>
    <div class="engine-table">
      <table>
        <thead>
          <tr>
            <th>任务</th>
            <th>付款方</th>
            <th>收款方</th>
            <th>单价</th>
            <th>有效期</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in list" :key="p.versionId">
            <td>
              {{
                context.options.tasks.find(
                  (t) => String(t.id) === String(p.taskId),
                )?.name ?? p.taskId
              }}
            </td>
            <td>
              {{ p.payerKind === 'agency' ? '运营代理' : name(p.payerId) }}
            </td>
            <td>{{ name(p.payeeId) }}</td>
            <td>{{ p.price }}</td>
            <td>{{ p.startDay }} 至 {{ p.endDay ?? '长期' }}</td>
            <td>{{ p.priceStatus === 'published' ? '已发布' : '草稿' }}</td>
            <td>
              <button
                v-if="
                  p.priceStatus === 'draft' &&
                  (p.payerKind === 'agency'
                    ? context.role === 'admin'
                    : String(p.payerId) === context.userId)
                "
                :disabled="busy"
                @click="
                  run(() => post(`/price-versions/${p.versionId}/publish`, {}))
                "
              >
                发布报价
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="!list.length">暂无本人有权查看的报价；缺价时不会按零元计算。</p>
    <div class="engine-actions">
      <button
        :disabled="page <= 1 || busy"
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
        :disabled="page * 25 >= total || busy"
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
