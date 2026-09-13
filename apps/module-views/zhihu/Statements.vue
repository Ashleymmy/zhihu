<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { errorText, requestKey, type EngineContext } from './context'
const props = defineProps<{ context: EngineContext }>()
interface Evidence {
  id: string
  bindingId: string
  keyword: string
  workUrl: string
  description: string
  status: string
  verificationStatus: string
  executorId: string
  reason: string
}
interface Entry {
  id: string
  factId: string
  relationType: string
  payerKind: string
  payerId: string
  payeeId: string
  amount: string
  targetAmount: string
  entryKind: string
  status: string
  inputHash: string
  snapshotJson: {
    date: string
    keyword: string
    orders: string
    obligation: { unitPrice: string }
  }
}
const evidence = ref<Evidence[]>([]),
  entries = ref<Entry[]>([]),
  error = ref(''),
  busy = ref(false),
  notice = ref(''),
  page = ref(1),
  total = ref(0),
  evidencePage = ref(1)
const selectedIds = ref<string[]>([]),
  period = reactive({ from: '', to: '' })
const canConfirm = (e: Entry) =>
  e.status === 'draft' &&
  (e.payerKind === 'agency'
    ? props.context.role === 'admin'
    : props.context.role === 'leader' && e.payerId === props.context.userId)
const work = reactive({ bindingId: '', url: '', description: '' }),
  factId = ref(''),
  review = ref<Evidence | null>(null),
  reason = ref('')
const labels: Record<string, string> = {
  draft: '应付草稿',
  confirmed: '已确认',
  superseded: '来源已变化',
  pending: '待核验',
  passed: '已通过',
  rejected: '已驳回',
  disputed: '有争议',
  agency_leader: '代理 → 团长',
  leader_creator: '团长 → 达人',
  agency_creator: '代理 → 达人',
}
function post(path: string, data: object) {
  return props.context.http.post(path, {
    ...props.context.scope,
    ...data,
    requestKey: requestKey(),
  })
}
async function load() {
  const s = await props.context.http.get<{ list: Entry[]; total: number }>(
    '/statements',
    { ...props.context.scope, page: page.value, pageSize: 25 },
  )
  entries.value = s.list
  selectedIds.value = selectedIds.value.filter((id) =>
    s.list.some((e) => e.id === id && canConfirm(e)),
  )
  total.value = s.total
  evidence.value = (
    await props.context.http.get<{ list: Evidence[] }>('/evidence', {
      ...props.context.scope,
      page: evidencePage.value,
      pageSize: 25,
    })
  ).list
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
    <h2>作品核验与对账</h2>
    <p class="engine-note">
      首次作品核验通过后才可确认。这里的“已确认”表示对账完成，实际付款尚未接入。
    </p>
    <p v-if="error" role="alert" class="engine-error">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <form @submit.prevent="run(() => post('/evidence', work))">
      <label
        >绑定编号<input
          v-model="work.bindingId"
          required
          pattern="[0-9]+" /></label
      ><label
        >作品链接<input
          v-model="work.url"
          type="url"
          required
          maxlength="2048" /></label
      ><label
        >使用说明<input
          v-model="work.description"
          required
          maxlength="1000" /></label
      ><button :disabled="busy">登记作品</button>
    </form>
    <div class="engine-table">
      <table>
        <thead>
          <tr>
            <th>关键词 / 绑定</th>
            <th>作品</th>
            <th>核验状态</th>
            <th>归属状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in evidence" :key="e.id">
            <td>{{ e.keyword }} / {{ e.bindingId }}</td>
            <td>
              <a :href="e.workUrl" target="_blank" rel="noopener noreferrer"
                >查看作品</a
              >
              <p>{{ e.description }}</p>
            </td>
            <td>
              {{ labels[e.status] ?? e.status }}
              <p>{{ e.reason }}</p>
            </td>
            <td>{{ labels[e.verificationStatus] ?? e.verificationStatus }}</td>
            <td>
              <button
                @click="
                  () => {
                    review = e
                    reason = ''
                  }
                "
              >
                核验或争议
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="!evidence.length">尚未登记作品。绑定编号可在关键词列表查看。</p>
    <div class="engine-actions">
      <button
        :disabled="busy || evidencePage <= 1"
        @click="
          () => {
            evidencePage--
            run(load)
          }
        "
      >
        上一页作品</button
      ><button
        :disabled="busy || evidence.length < 25"
        @click="
          () => {
            evidencePage++
            run(load)
          }
        "
      >
        下一页作品
      </button>
    </div>
    <form
      v-if="review"
      class="engine-panel"
      @submit.prevent="
        run(async () => {
          await post(`/evidence/${review!.id}/review`, { accept: true, reason })
          review = null
        })
      "
    >
      <label
        >核验或争议依据<input
          v-model="reason"
          required
          maxlength="500" /></label
      ><template
        v-if="
          review.status === 'pending' &&
          (context.role === 'admin' ||
            (context.role === 'leader' && review.executorId !== context.userId))
        "
        ><button :disabled="busy">通过核验</button
        ><button
          type="button"
          :disabled="busy || !reason"
          @click="
            run(async () => {
              await post(`/evidence/${review!.id}/review`, {
                accept: false,
                reason,
              })
              review = null
            })
          "
        >
          驳回
        </button></template
      ><button
        type="button"
        :disabled="busy || !reason"
        @click="
          run(async () => {
            await post(`/evidence-bindings/${review!.bindingId}/dispute`, {
              resolve: false,
              reason,
            })
            review = null
          })
        "
      >
        标记争议并暂停确认</button
      ><button
        v-if="
          context.role === 'admin' && review.verificationStatus === 'disputed'
        "
        type="button"
        :disabled="busy || !reason"
        @click="
          run(async () => {
            await post(`/evidence-bindings/${review!.bindingId}/dispute`, {
              resolve: true,
              reason,
            })
            review = null
          })
        "
      >
        解除争议</button
      ><button type="button" @click="review = null">取消</button>
    </form>
    <h2>应付与差额调整</h2>
    <form
      v-if="context.role !== 'creator'"
      @submit.prevent="run(() => post('/statements/preview-period', period))"
    >
      <label
        >账期起始日<input v-model="period.from" type="date" required /></label
      ><label
        >账期截至日<input v-model="period.to" type="date" required /></label
      ><button :disabled="busy">按账期生成草稿</button>
    </form>
    <p class="engine-note">
      每次最多处理 500
      条归因事实；大批次可缩小日期范围。每条确认仍保留独立事实与报价快照。
    </p>
    <form
      v-if="context.role !== 'creator'"
      @submit.prevent="run(() => post('/statements/preview', { factId }))"
    >
      <label>归因编号<input v-model="factId" required pattern="[0-9]+" /></label
      ><button :disabled="busy">生成本人付款草稿</button>
    </form>
    <p class="engine-note">
      团队路径须先由团长确认达人应付，再由管理员确认团长应付。来源修订会自动生成差额草稿。
    </p>
    <div class="engine-table">
      <table>
        <thead>
          <tr>
            <th>选择</th>
            <th>编号 / 日期</th>
            <th>关键词 / 订单</th>
            <th>付款关系</th>
            <th>本次应付或调整</th>
            <th>调整后应付</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in entries" :key="e.id">
            <td>
              <input
                v-if="canConfirm(e)"
                v-model="selectedIds"
                type="checkbox"
                :value="e.id"
                :aria-label="'选择对账 ' + e.id"
              />
            </td>
            <td>{{ e.id }} / {{ e.snapshotJson.date }}</td>
            <td>{{ e.snapshotJson.keyword }} / {{ e.snapshotJson.orders }}</td>
            <td>
              {{ labels[e.relationType] }}
              <p>收款成员 {{ e.payeeId }}</p>
            </td>
            <td>
              {{ e.entryKind === 'adjustment' ? '调整' : '首次' }}
              {{ e.amount }}
            </td>
            <td>{{ e.targetAmount }}</td>
            <td>{{ labels[e.status] ?? e.status }}</td>
            <td>
              <button
                v-if="
                  e.status === 'draft' &&
                  (e.payerKind === 'agency'
                    ? context.role === 'admin'
                    : context.role === 'leader' && e.payerId === context.userId)
                "
                :disabled="busy"
                @click="
                  run(() =>
                    post(`/statements/${e.id}/confirm`, {
                      expectedHash: e.inputHash,
                    }),
                  )
                "
              >
                确认应付
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="!entries.length">暂无对账记录。</p>
    <button
      v-if="context.role !== 'creator'"
      :disabled="busy || !selectedIds.length"
      @click="
        run(() =>
          post('/statements/confirm-batch', {
            entries: entries
              .filter((e) => selectedIds.includes(e.id))
              .map((e) => ({ id: e.id, expectedHash: e.inputHash })),
          }),
        )
      "
    >
      确认所选 {{ selectedIds.length }} 条应付
    </button>
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
        下一页</button
      ><button :disabled="busy" @click="run(load)">刷新</button>
    </div>
  </section>
</template>
