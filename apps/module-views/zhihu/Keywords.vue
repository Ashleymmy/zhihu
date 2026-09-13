<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { errorText, requestKey, type EngineContext } from './context'
const props = defineProps<{ context: EngineContext }>(),
  emit = defineEmits<{ refresh: [] }>()
interface Word {
  id: string
  keyword: string
  taskId: string
  planId: string
  lifecycleStatus: string
  syncStatus: string
  syncError: string | null
  planStatus: string
  priorityUntil: string | null
  priorityEnded: number
  bindingId: string | null
  executorId: string | null
  leaderId: string | null
  releaseStatus: string
  usedEverAt: string | null
  verificationStatus: string
}
const list = ref<Word[]>([]),
  total = ref(0),
  page = ref(1),
  search = ref(''),
  error = ref(''),
  busy = ref(false),
  success = ref('')
const mapping = reactive({
  channelId: '',
  name: '',
  from: '2020-01-01',
  canonicalId: '',
})
const form = reactive({
  keyword: '',
  taskId: '',
  mappingId: '',
  landingUrl: '',
  popularizeType: 1,
})
const selected = ref<Word | null>(null),
  action = ref(''),
  executorId = ref(''),
  reason = ref('')
const labels: Record<string, string> = {
  pending: '等待上游',
  available: '可领取',
  reserved: '团长预留',
  assigned: '已分配',
  active: '使用中',
  retired: '停止新增',
  passed: '已核验',
  flagged: '有争议',
}
async function load() {
  const r = await props.context.http.get<{ list: Word[]; total: number }>(
    '/keywords',
    {
      ...props.context.scope,
      page: page.value,
      pageSize: 25,
      search: search.value,
    },
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
    success.value = '操作已保存'
  } catch (e) {
    error.value = errorText(e)
  } finally {
    busy.value = false
  }
}
function post(path: string, body: object) {
  return props.context.http.post(path, {
    ...props.context.scope,
    ...body,
    requestKey: requestKey(),
  })
}
function choose(w: Word, a: string) {
  selected.value = w
  action.value = a
  reason.value = ''
  executorId.value = ''
}
async function perform() {
  if (!selected.value) return
  await run(async () => {
    const url =
      action.value === 'confirm-upstream'
        ? `/keywords/${selected.value!.id}/confirm-upstream`
        : `/bindings/${selected.value!.bindingId}/${action.value}`
    await post(url, {
      executorId: executorId.value || undefined,
      reason: reason.value || undefined,
    })
    selected.value = null
  })
}
onMounted(() => run(load))
</script>
<template>
  <div v-if="context.role === 'admin'" class="engine-panel">
    <h2>维护报表渠道映射</h2>
    <form
      @submit.prevent="
        run(async () => {
          await post('/channel-mappings', {
            ...mapping,
            canonicalId: mapping.canonicalId || undefined,
          })
          emit('refresh')
        })
      "
    >
      <label
        >渠道<select v-model="mapping.channelId" required>
          <option value="">选择渠道</option>
          <option
            v-for="c in context.options.channels"
            :key="c.id"
            :value="c.id"
          >
            {{ c.name }}
          </option>
        </select></label
      ><label
        >报表中的渠道名称<input
          v-model="mapping.name"
          required
          maxlength="255" /></label
      ><label
        >生效日期<input v-model="mapping.from" type="date" required
      /></label>
      <label
        >渠道更名时关联原映射<select v-model="mapping.canonicalId">
          <option value="">新渠道主映射</option>
          <option
            v-for="m in context.options.mappings"
            :key="m.id"
            :value="m.id"
          >
            {{ m.channelName }}
          </option>
        </select></label
      ><button :disabled="busy">保存映射</button>
    </form>
  </div>
  <div v-if="context.role === 'admin'" class="engine-panel">
    <h2>创建关键词</h2>
    <form @submit.prevent="run(() => post('/keywords', form))">
      <label
        >推广任务<select v-model="form.taskId" required>
          <option value="">选择任务</option>
          <option v-for="t in context.options.tasks" :key="t.id" :value="t.id">
            {{ t.name }}
          </option>
        </select></label
      >
      <label
        >渠道<select v-model="form.mappingId" required>
          <option value="">选择映射</option>
          <option
            v-for="m in context.options.mappings"
            :key="m.id"
            :value="m.id"
          >
            {{ m.channelName }}
          </option>
        </select></label
      >
      <label
        >关键词<input v-model="form.keyword" required maxlength="128" /></label
      ><label
        >内容链接<input v-model="form.landingUrl" type="url" required /></label
      ><label
        >推广类型<input
          v-model.number="form.popularizeType"
          type="number"
          required /></label
      ><button :disabled="busy">提交上游创建</button>
    </form>
    <p class="engine-note">
      上游成功且可用后，团长享有 24 小时优先期。创建者不等于收益归属人。
    </p>
  </div>
  <div class="engine-panel">
    <h2>独占词库</h2>
    <form
      @submit.prevent="
        () => {
          page = 1
          run(load)
        }
      "
    >
      <label>搜索关键词<input v-model="search" /></label
      ><button :disabled="busy">查询</button>
    </form>
    <p v-if="error" role="alert" class="engine-error">{{ error }}</p>
    <p v-if="success" role="status">{{ success }}</p>
    <div class="engine-table">
      <table>
        <thead>
          <tr>
            <th>关键词</th>
            <th>状态</th>
            <th>优先期截至</th>
            <th>核验</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="w in list" :key="w.id">
            <td>
              {{ w.keyword }}
              <p v-if="w.bindingId">绑定 {{ w.bindingId }}</p>
            </td>
            <td>
              {{ labels[w.lifecycleStatus] ?? w.lifecycleStatus }}
              <p v-if="w.syncError" class="engine-error">{{ w.syncError }}</p>
            </td>
            <td>
              {{
                w.priorityUntil
                  ? new Date(w.priorityUntil).toLocaleString()
                  : '等待上游可用'
              }}
            </td>
            <td>{{ labels[w.verificationStatus] ?? '待首次核验' }}</td>
            <td>
              <div class="engine-actions">
                <button
                  v-if="
                    context.role === 'admin' &&
                    w.syncStatus === 'failed' &&
                    !w.usedEverAt
                  "
                  :disabled="busy"
                  @click="
                    run(() => post(`/keywords/${w.id}/retry-upstream`, {}))
                  "
                >
                  重试上游创建
                </button>
                <button
                  v-if="
                    w.lifecycleStatus === 'pending' &&
                    w.syncStatus === 'synced' &&
                    context.role === 'admin'
                  "
                  @click="choose(w, 'confirm-upstream')"
                >
                  核实上游可用
                </button>
                <button
                  v-if="
                    !w.bindingId &&
                    w.lifecycleStatus === 'available' &&
                    context.role !== 'admin'
                  "
                  :disabled="busy"
                  @click="run(() => post(`/keywords/${w.id}/claim`, {}))"
                >
                  领取
                </button>
                <button
                  v-if="
                    w.bindingId &&
                    !w.usedEverAt &&
                    w.leaderId &&
                    (context.role === 'admin' || w.leaderId === context.userId)
                  "
                  @click="choose(w, 'assign')"
                >
                  分配执行人
                </button>
                <button
                  v-if="
                    w.bindingId &&
                    !w.usedEverAt &&
                    w.executorId === context.userId
                  "
                  :disabled="busy"
                  @click="
                    run(() => post(`/bindings/${w.bindingId}/activate`, {}))
                  "
                >
                  声明开始使用
                </button>
                <button
                  v-if="
                    w.bindingId &&
                    !w.usedEverAt &&
                    w.releaseStatus !== 'requested'
                  "
                  @click="choose(w, 'request-release')"
                >
                  申请释放
                </button>
                <button
                  v-if="
                    w.releaseStatus === 'requested' && context.role === 'admin'
                  "
                  @click="choose(w, 'release')"
                >
                  核实并释放
                </button>
                <button
                  v-if="
                    w.bindingId &&
                    w.usedEverAt &&
                    w.lifecycleStatus !== 'retired'
                  "
                  :disabled="busy"
                  @click="run(() => post(`/bindings/${w.bindingId}/stop`, {}))"
                >
                  停止新增使用
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="!list.length && !busy">当前范围暂无关键词。</p>
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
      ><span>第 {{ page }} 页，共 {{ total }} 条</span
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
    <form v-if="selected" class="engine-panel" @submit.prevent="perform">
      <h2>
        {{ selected.keyword }}：{{
          action === 'assign'
            ? '分配执行人'
            : action === 'confirm-upstream'
              ? '上游可用核实'
              : '释放申请与核实'
        }}
      </h2>
      <label v-if="action === 'assign'"
        >执行人<select v-model="executorId" required>
          <option value="">选择成员</option>
          <option v-for="u in context.options.users" :key="u.id" :value="u.id">
            {{ u.displayName }}（{{ u.role }}）
          </option>
        </select></label
      ><label v-else
        >核实依据<textarea v-model="reason" required maxlength="500" /></label
      ><button :disabled="busy">确认保存</button
      ><button type="button" @click="selected = null">取消</button>
    </form>
  </div>
</template>
