<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { errorText, requestKey, type EngineContext } from './context'
const props = defineProps<{ context: EngineContext }>()
interface Batch {
  lastError?: string
  jobStatus?: string
  page: number
  id: string
  fileName: string
  reportKind: string
  status: string
  previewHash?: string
  counts?: { processingStatus: string; total: number }[]
  rows?: {
    id: string
    lineNumber: number
    normalizedJson: {
      date: string
      channel: string
      keyword: string
      search: string | null
      orders: string | null
      revenue: string | null
      promotionTask?: string | null
      riskAssessment?: string | null
      conversionRateRaw?: string | number | null
      conversionRateDisplay?: string | null
    }
    errorText: string | null
    processingStatus: string
  }[]
}
interface Fact {
  id: string
  revisionId: string
  keyword: string
  date: string
  orders: string | null
  search: string | null
  status: string
  reasonCode: string | null
  verificationStatus: string
  revenue?: string | null
  agencyMargin?: string | null
  obligations: {
    relation: string
    amount: string
    unitPrice: string
    payeeId: string
  }[]
}
interface Exception {
  id: string
  reasonCode: string
  status: string
  revisionId: string | null
  expectedRevisionId: string | null
  sourceRowId: string
  factId: string
  normalizedJson: { keyword: string; orders: string; revenue: string }
}
const batches = ref<Batch[]>([]),
  facts = ref<Fact[]>([]),
  exceptions = ref<Exception[]>([]),
  detail = ref<Batch | null>(null),
  selected = ref<Exception | null>(null)
const kind = ref('combined'),
  file = ref<File | null>(null),
  busy = ref(false),
  error = ref(''),
  notice = ref(''),
  reason = ref(''),
  page = ref(1),
  total = ref(0),
  batchPage = ref(1),
  exceptionPage = ref(1),
  traceData = ref<unknown>(null)
const labels: Record<string, string> = {
  pending: '待处理',
  preview: '待确认',
  committed: '处理中',
  processed: '已处理',
  duplicate: '重复行',
  invalid: '无效行',
  exception: '需处理',
  matched: '已归属',
  unmatched: '待归属',
  CHANNEL_UNMAPPED: '渠道未映射',
  KEYWORD_UNKNOWN: '关键词未知',
  PROJECT_MISMATCH: '项目不匹配',
  SOURCE_REVISION_PENDING: '来源更正待确认',
  REPORT_INCOMPLETE: '等待完整订单报告',
  RISK_REVIEW_REQUIRED: '风险判定待核实，暂停对账',
  PRICE_MISSING: '缺少适用报价',
  BINDING_MISSING: '尚无使用绑定',
  PERIOD_AMBIGUOUS: '报告早于绑定',
  LEGACY_SHARED: '历史共用词',
}
function post(path: string, data: object = {}) {
  return props.context.http.post(path, {
    ...props.context.scope,
    ...data,
    requestKey: requestKey(),
  })
}
async function load() {
  const r = await props.context.http.get<{ list: Fact[]; total: number }>(
    '/attributions',
    { ...props.context.scope, page: page.value, pageSize: 25 },
  )
  facts.value = r.list
  total.value = r.total
  if (props.context.role === 'admin') {
    batches.value = (
      await props.context.http.get<{ list: Batch[] }>('/imports', {
        ...props.context.scope,
        page: batchPage.value,
        pageSize: 25,
      })
    ).list
    exceptions.value = (
      await props.context.http.get<{ list: Exception[] }>('/exceptions', {
        ...props.context.scope,
        page: exceptionPage.value,
        pageSize: 25,
      })
    ).list
  }
}
async function run(work: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await work()
    if (work !== load) await load()
    notice.value = '数据已更新'
  } catch (e) {
    error.value = errorText(e)
  } finally {
    busy.value = false
  }
}
async function show(id: string, p = 1) {
  detail.value = await props.context.http.get<Batch>(`/imports/${id}`, {
    ...props.context.scope,
    page: p,
    pageSize: 100,
  })
}
async function upload() {
  if (!file.value) return
  const form = new FormData()
  form.append('file', file.value)
  form.append('projectId', props.context.scope.projectId)
  form.append('accountId', props.context.scope.accountId)
  form.append('reportKind', kind.value)
  const r = await props.context.http.postForm<{ id: string }>('/imports', form)
  await show(r.id)
}
async function resolve(accept: boolean) {
  const e = selected.value
  if (!e) return
  await run(async () => {
    if (e.revisionId)
      await post(`/metric-revisions/${e.revisionId}/resolve`, {
        expectedRevisionId: e.expectedRevisionId,
        accept,
        reason: reason.value,
      })
    else await post(`/exceptions/${e.id}/retry`, { reason: reason.value })
    selected.value = null
  })
}
async function download() {
  if (!detail.value) return
  const blob = await props.context.http.getBlob(
    '/imports/' +
      detail.value.id +
      '/file?' +
      new URLSearchParams({ ...props.context.scope }),
  )
  const url = URL.createObjectURL(blob),
    a = document.createElement('a')
  a.href = url
  a.download = detail.value.fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
onMounted(() => run(load))
</script>
<template>
  <section class="engine-panel">
    <h2>报告与归因</h2>
    <p v-if="error" role="alert" class="engine-error">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <template v-if="context.role === 'admin'"
      ><form @submit.prevent="run(upload)">
        <label
          >报告类型<select v-model="kind">
            <option value="order">订单报告（收益可选）</option>
            <option value="search">搜索报告</option>
            <option value="combined">综合反馈报告（搜索量＋订单量）</option>
          </select></label
        ><label
          >Excel 附件<input
            type="file"
            accept=".xlsx"
            required
            @change="
              file = ($event.target as HTMLInputElement).files?.[0] ?? null
            " /></label
        ><button :disabled="busy">上传并预览</button>
      </form>
      <p class="engine-note">
        原文件与原始行将保留。无效行不会计入业绩；同一来源的不同值需要人工确认修订。
        当前反馈表无收益列，应付按订单量与报价计算，代理毛差价显示为无法计算。
        风险判定为空时不扣减订单；非空值须核实，暂停该条对账。
        推广任务名称仅供核查；搜索转化率按原表显示，不参与计费。
      </p>
      <div class="engine-table">
        <table>
          <thead>
            <tr>
              <th>报告</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="b in batches" :key="b.id">
              <td>{{ b.fileName }}</td>
              <td>
                {{ labels[b.status] ?? b.status }}
                <p v-if="b.lastError" class="engine-error">
                  处理暂停：{{ b.lastError }}
                </p>
              </td>
              <td>
                <button :disabled="busy" @click="run(() => show(b.id))">
                  预览与明细</button
                ><button
                  v-if="b.status === 'committed' || b.jobStatus === 'failed'"
                  :disabled="busy"
                  @click="run(() => post(`/imports/${b.id}/process`))"
                >
                  继续处理
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="engine-actions">
        <button
          :disabled="batchPage <= 1 || busy"
          @click="
            () => {
              batchPage--
              run(load)
            }
          "
        >
          上一批</button
        ><button
          :disabled="batches.length < 25 || busy"
          @click="
            () => {
              batchPage++
              run(load)
            }
          "
        >
          下一批
        </button>
      </div>
      <div v-if="detail" class="engine-panel">
        <h2>{{ detail.fileName }}</h2>
        <p>
          {{
            detail.counts
              ?.map(
                (x) =>
                  (labels[x.processingStatus] ?? x.processingStatus) +
                  ' ' +
                  x.total +
                  ' 行',
              )
              .join('；')
          }}
        </p>
        <button
          v-if="detail.status === 'preview'"
          :disabled="busy"
          @click="
            run(async () => {
              await post(`/imports/${detail!.id}/commit`, {
                previewHash: detail!.previewHash,
              })
              await show(detail!.id)
            })
          "
        >
          确认导入全部有效行</button
        ><button :disabled="busy" @click="run(download)">下载原文件</button
        ><button
          :disabled="busy || detail.page <= 1"
          @click="run(() => show(detail!.id, detail!.page - 1))"
        >
          上一页明细</button
        ><button
          :disabled="busy || (detail.rows?.length ?? 0) < 100"
          @click="run(() => show(detail!.id, detail!.page + 1))"
        >
          下一页明细</button
        ><button @click="detail = null">关闭明细</button>
        <div class="engine-table">
          <table>
            <thead>
              <tr>
                <th>行</th>
                <th>日期</th>
                <th>渠道</th>
                <th>关键词</th>
                <th>推广任务（原文）</th>
                <th>风险判定</th>
                <th>搜索</th>
                <th>订单</th>
                <th>搜索转化率（原表显示）</th>
                <th>来源收益</th>
                <th>结果</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in detail.rows" :key="r.id">
                <td>{{ r.lineNumber }}</td>
                <td>{{ r.normalizedJson.date }}</td>
                <td>{{ r.normalizedJson.channel }}</td>
                <td>{{ r.normalizedJson.keyword }}</td>
                <td>{{ r.normalizedJson.promotionTask ?? '未提供' }}</td>
                <td>{{ r.normalizedJson.riskAssessment ?? '未提供' }}</td>
                <td>{{ r.normalizedJson.search ?? '未提供' }}</td>
                <td>{{ r.normalizedJson.orders ?? '未提供' }}</td>
                <td>
                  {{ r.normalizedJson.conversionRateDisplay ?? '未提供' }}
                </td>
                <td>{{ r.normalizedJson.revenue ?? '未提供' }}</td>
                <td>
                  {{
                    r.errorText
                      ? (labels[r.errorText] ?? r.errorText)
                      : labels[r.processingStatus]
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <h2>来源异常与修订</h2>
      <div class="engine-actions">
        <button
          :disabled="busy || exceptionPage <= 1"
          @click="
            () => {
              exceptionPage--
              run(load)
            }
          "
        >
          上一页异常</button
        ><button
          :disabled="busy || exceptions.length < 25"
          @click="
            () => {
              exceptionPage++
              run(load)
            }
          "
        >
          下一页异常
        </button>
      </div>
      <div class="engine-table">
        <table>
          <thead>
            <tr>
              <th>关键词</th>
              <th>问题</th>
              <th>订单 / 收益</th>
              <th>状态</th>
              <th>处理</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in exceptions" :key="e.id">
              <td>{{ e.normalizedJson?.keyword ?? '—' }}</td>
              <td>{{ labels[e.reasonCode] ?? e.reasonCode }}</td>
              <td>
                {{ e.normalizedJson?.orders ?? '—' }} /
                {{ e.normalizedJson?.revenue ?? '—' }}
              </td>
              <td>{{ e.status === 'open' ? '待处理' : '已处理' }}</td>
              <td>
                <button
                  v-if="
                    e.status === 'open' &&
                    e.reasonCode !== 'RISK_REVIEW_REQUIRED'
                  "
                  @click="
                    () => {
                      selected = e
                      reason = ''
                    }
                  "
                >
                  核对
                </button>
                <span
                  v-if="
                    e.status === 'open' &&
                    e.reasonCode === 'RISK_REVIEW_REQUIRED'
                  "
                  >待核实上游风险口径或取得更正报告</span
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <form
        v-if="selected"
        class="engine-panel"
        @submit.prevent="resolve(true)"
      >
        <label
          >核对依据<input v-model="reason" required maxlength="500" /></label
        ><button :disabled="busy">
          {{ selected.revisionId ? '接受修订' : '修正映射后重试' }}</button
        ><button
          v-if="selected.revisionId"
          type="button"
          :disabled="!reason || busy"
          @click="resolve(false)"
        >
          驳回修订</button
        ><button
          v-if="selected.revisionId"
          type="button"
          :disabled="!reason || busy"
          @click="
            run(async () => {
              await post(`/metric-revisions/${selected!.revisionId}/rebase`, {
                expectedRevisionId: selected!.expectedRevisionId,
                reason,
              })
              selected = null
            })
          "
        >
          依据当前事实重建候选</button
        ><button type="button" @click="selected = null">取消</button>
      </form></template
    >
    <h2>归因结果</h2>
    <button :disabled="busy" @click="run(load)">刷新</button>
    <div class="engine-table">
      <table>
        <thead>
          <tr>
            <th>归因编号 / 日期</th>
            <th>关键词</th>
            <th>订单</th>
            <th>归属</th>
            <th>本人可见应付</th>
            <th v-if="context.role === 'admin'">来源收益 / 代理毛差价</th>
            <th>核验</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in facts" :key="f.id">
            <td>{{ f.id }} / {{ f.date }}</td>
            <td>{{ f.keyword }}</td>
            <td>{{ f.orders ?? '未提供' }}</td>
            <td>
              {{
                f.reasonCode
                  ? (labels[f.reasonCode] ?? f.reasonCode)
                  : labels[f.status]
              }}
            </td>
            <td>
              <div v-for="o in f.obligations" :key="o.relation">
                {{
                  o.relation === 'agency_leader'
                    ? '代理 → 团长'
                    : o.relation === 'leader_creator'
                      ? '团长 → 达人'
                      : '代理 → 达人'
                }}：{{ o.amount }}
              </div>
            </td>
            <td v-if="context.role === 'admin'">
              {{ f.revenue ?? '未提供' }} / {{ f.agencyMargin ?? '无法计算' }}
            </td>
            <td>
              {{
                f.verificationStatus === 'passed' ? '已通过' : '待核验或有争议'
              }}
            </td>
            <td>
              <button
                :disabled="busy"
                @click="
                  run(async () => {
                    traceData = await context.http.get(
                      `/attributions/${f.id}/trace`,
                      context.scope,
                    )
                  })
                "
              >
                来源详情</button
              ><button
                v-if="context.role === 'admin'"
                :disabled="busy"
                @click="run(() => post(`/attributions/${f.id}/recompute`))"
              >
                补价后重算
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="!facts.length">暂无归因结果。</p>
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
    <div v-if="traceData" class="engine-panel">
      <h2>来源链路与计算快照</h2>
      <button @click="traceData = null">关闭来源详情</button>
      <pre style="white-space: pre-wrap; overflow-wrap: anywhere">{{
        JSON.stringify(traceData, null, 2)
      }}</pre>
    </div>
  </section>
</template>
