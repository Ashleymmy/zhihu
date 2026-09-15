<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
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
const canEdit=computed(()=>props.context.role==='leader'||props.context.role==='admin'&&props.context.adminDuty!=='finance')
const showForm=ref(false)
async function savePrice(){
const draft=await post('/price-agreements',{...form,to:form.to||undefined}) as {id:string}
await post('/price-versions/'+draft.id+'/publish',{})
showForm.value=false
}
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date())
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
  from: today,
  to: '',
  reason: '设置业务单价',
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
    <div class="section-heading"><h2>定价规则</h2><button v-if="canEdit" @click="showForm=!showForm">设置单价</button></div>
    <p class="engine-note">
      当前支持按有效订单设置单价；模拟项目中的价格仅用于联测。后续可调整规则，已确认账单保留当时的价格依据。未来调价请选择新的生效日期。
    </p>
    <form
      v-if="canEdit && showForm"
      @submit.prevent="run(savePrice)"
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
      ><button :disabled="busy">保存并发布</button>
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
              {{ p.payerKind === 'agency' ? '平台' : name(p.payerId) }}
            </td>
            <td>{{ name(p.payeeId) }}</td>
            <td>{{ p.price }}</td>
            <td>{{ p.startDay }} 至 {{ p.endDay ?? '长期' }}</td>
            <td>{{ p.priceStatus === 'published' ? '已发布' : '待发布' }}</td>
            <td>
              <button
                v-if="
                  canEdit && p.priceStatus === 'draft' &&
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
    <p v-if="!list.length">还没有设置适用单价。未设置单价的记录会等待处理。</p>
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
