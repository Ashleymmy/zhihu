<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount, nextTick } from "vue";
import { errorText, type EngineContext } from "./context";
import Works from "./Works.vue";
const props = defineProps<{ context: EngineContext }>();
interface Counts {
  registered: number;
  submitted: number;
  failed: number;
  pending: number;
}
interface Member extends Counts {
  id: string;
  name: string;
  role: string;
}
const today = new Date().toLocaleDateString("en-CA", {
  timeZone: "Asia/Shanghai",
});
const from = ref(today.slice(0, 8) + "01"),
  to = ref(today),
  view = ref("self"),
  page = ref(1),
  total = ref(0);
const summary = ref<Counts | null>(null),
  members = ref<Member[]>([]),
  busy = ref(false),
  error = ref("");
const drill = ref<Record<string, string> | null>(null),
  drillHeading = ref(""),
  workSection = ref<HTMLElement>();
const views = computed(() => [
  { key: "self", label: "我的作品" },
  ...(props.context.role === "creator"
    ? []
    : [
        props.context.role === "leader"
          ? { key: "team", label: "团队成员" }
          : { key: "all", label: "项目全部" },
      ]),
]);
const metrics = [
  { key: "registered", label: "登记作品", result: "" },
  { key: "submitted", label: "已提交知乎", result: "submitted" },
  { key: "failed", label: "提交失败", result: "failed" },
  { key: "pending", label: "待提交", result: "pending" },
] as const;
let generation = 0;
async function load() {
  const n = ++generation;
  busy.value = true;
  error.value = "";
  summary.value = null;
  members.value = [];
  drill.value = null;
  try {
    if (from.value > to.value) throw new Error("开始日期不能晚于结束日期");
    const r = await props.context.http.get<{
      summary: Counts;
      list: Member[];
      total: number;
    }>("/workbench/work-activity", {
      ...props.context.scope,
      from: from.value,
      to: to.value,
      view: view.value,
      page: page.value,
      pageSize: 25,
    });
    if (n === generation) {
      summary.value = r.summary;
      members.value = r.list;
      total.value = r.total;
    }
  } catch (e) {
    if (n === generation) error.value = errorText(e);
  } finally {
    if (n === generation) busy.value = false;
  }
}
watch(
  [
    from,
    to,
    view,
    () => props.context.scope.projectId,
    () => props.context.scope.accountId,
    () => props.context.userId,
  ],
  () => {
    page.value = 1;
    void load();
  },
  { immediate: true },
);
onBeforeUnmount(() => generation++);
async function showWorks(result = "", member?: Member) {
  drill.value = {
    from: from.value,
    to: to.value,
    view: view.value,
    registeredOnly: "1",
    ...(result ? { result } : {}),
    ...(member ? { ownerId: member.id } : {}),
  };
  drillHeading.value = member
    ? member.name + "的作品"
    : metrics.find((m) => m.result === result)!.label;
  await nextTick();
  workSection.value?.scrollIntoView({ behavior: "smooth", block: "start" });
  workSection.value?.focus({ preventScroll: true });
}
</script>
<template>
  <section>
    <div class="section-heading">
      <p>按登记时间统计知乎业务作品，修改和重试不重复计数。</p>
      <button :disabled="busy" @click="load">刷新数据</button>
    </div>
    <nav class="work-tabs" aria-label="数据范围">
      <button
        v-for="v in views"
        :key="v.key"
        :class="{ active: view === v.key }"
        :aria-pressed="view === v.key"
        @click="view = v.key"
      >
        {{ v.label }}
      </button>
    </nav>
    <div class="period-filter">
      <label>开始日期<input v-model="from" type="date" /></label
      ><label>结束日期<input v-model="to" type="date" /></label>
    </div>
    <p v-if="error" role="alert" class="engine-error">{{ error }}</p>
    <p v-if="busy" role="status">正在统计作品…</p>
    <div v-if="summary" class="activity-metrics">
      <button v-for="m in metrics" :key="m.key" @click="showWorks(m.result)">
        <span>{{ m.label }}</span
        ><strong>{{ summary[m.key] }}</strong
        ><small>{{ m.result === "failed" ? "查看原因" : "查看作品" }} →</small>
      </button>
    </div>
    <p class="engine-note">
      已提交知乎不代表审核通过，审核结果在作品详情中查看。
    </p>
    <article v-if="view !== 'self' && !busy && !error" class="work-card">
      <h2>成员明细</h2>
      <p>点击成员查看本期登记的作品。</p>
      <div class="engine-table">
        <table>
          <thead>
            <tr>
              <th>成员</th>
              <th>登记作品</th>
              <th>已提交知乎</th>
              <th>提交失败</th>
              <th>待提交</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in members" :key="m.id">
              <td>
                <button class="member-link" @click="showWorks('', m)">
                  {{ m.name }} →
                </button>
              </td>
              <td>{{ m.registered }}</td>
              <td>{{ m.submitted }}</td>
              <td>{{ m.failed }}</td>
              <td>{{ m.pending }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!members.length" class="empty-state">当前范围没有成员。</p>
      <div v-if="total > 25" class="engine-actions">
        <button
          :disabled="page === 1"
          @click="
            page--;
            load();
          "
        >
          上一页</button
        ><span>第 {{ page }} 页，共 {{ total }} 人</span
        ><button
          :disabled="page * 25 >= total"
          @click="
            page++;
            load();
          "
        >
          下一页
        </button>
      </div>
    </article>
    <div v-if="drill" ref="workSection" tabindex="-1" class="work-drill">
      <div class="section-heading">
        <p>{{ from }} 至 {{ to }} · 按登记时间</p>
        <button @click="drill = null">收起作品</button>
      </div>
      <Works :context="context" :filters="drill" :heading="drillHeading" />
    </div>
  </section>
</template>
<style scoped>
.period-filter {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
.activity-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin: 22px 0;
}
.activity-metrics button {
  text-align: left;
  padding: 22px;
  background: var(--paper, #fff);
}
.activity-metrics span {
  font-size: 14px;
  color: var(--ink-soft, #637078);
}
.activity-metrics strong {
  display: block;
  font-size: 34px;
  font-weight: 600;
  margin: 12px 0;
  color: #195e62;
}
.activity-metrics button:hover {
  border-color: #195e62;
}
.work-drill {
  margin-top: 28px;
  scroll-margin-top: 20px;
}
.engine button.member-link {
  border: 0;
  padding-left: 0;
  color: #195e62;
  text-align: left;
}
@media (max-width: 700px) {
  .activity-metrics {
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .activity-metrics button {
    padding: 16px;
  }
  .activity-metrics strong {
    font-size: 28px;
  }
}
</style>
