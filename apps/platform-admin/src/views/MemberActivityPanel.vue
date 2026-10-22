<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { http } from "../stores/auth";
import type {
  ActivityKind,
  ActivityStatus,
  ActivitySummary,
  ActivityRecord,
} from "../member-activity";
const props = defineProps<{
  memberId: string;
  projectId?: string;
  initialKind: ActivityKind;
  initialStatus: ActivityStatus;
}>();
const summary = ref<ActivitySummary | null>(null),
  moduleId = ref(""),
  kind = ref<ActivityKind>(props.initialKind),
  status = ref<ActivityStatus>(props.initialStatus);
const loading = ref(false),
  error = ref(""),
  page = ref(1),
  total = ref(0),
  list = ref<ActivityRecord[]>([]);
const search = ref(""),
  from = ref(""),
  to = ref(""),
  taskRef = ref(""),
  taskName = ref("");
const applied = ref({ search: "", from: "", to: "" });
const counts = computed(
  () =>
    summary.value?.modules.find((m) => m.moduleId === moduleId.value)?.counts[
      props.memberId
    ],
);
let version = 0;
onBeforeUnmount(() => {
  version++;
});
const metrics: {
  label: string;
  key: "tasks" | "currentTasks" | "verifiedTasks" | "works";
  kind: ActivityKind;
  status: ActivityStatus;
}[] = [
  { label: "累计领取记录", key: "tasks", kind: "tasks", status: "all" },
  {
    label: "当前在手任务",
    key: "currentTasks",
    kind: "tasks",
    status: "current",
  },
  {
    label: "已核验任务",
    key: "verifiedTasks",
    kind: "tasks",
    status: "verified",
  },
  { label: "作品记录", key: "works", kind: "works", status: "all" },
];
async function load(refresh = false) {
  const run = ++version;
  loading.value = true;
  error.value = "";
  list.value = [];
  try {
    if (refresh || !summary.value) {
      const result = await http.post<ActivitySummary>(
        "/member-activity/summary",
        {
          memberIds: [props.memberId],
          ...(props.projectId ? { projectId: props.projectId } : {}),
        },
      );
      if (run !== version) return;
      summary.value = result;
      if (!result.modules.some((m) => m.moduleId === moduleId.value))
        moduleId.value = result.modules[0]?.moduleId || "";
    }
    if (!moduleId.value) {
      total.value = 0;
      return;
    }
    const result = await http.get<{ list: ActivityRecord[]; total: number }>(
      "/member-activity/" + props.memberId,
      {
        moduleId: moduleId.value,
        ...(props.projectId ? { projectId: props.projectId } : {}),
        kind: kind.value,
        status: status.value,
        page: page.value,
        pageSize: 20,
        ...(applied.value.search ? { search: applied.value.search } : {}),
        ...(applied.value.from ? { from: applied.value.from } : {}),
        ...(applied.value.to ? { to: applied.value.to } : {}),
        ...(taskRef.value ? { taskRef: taskRef.value } : {}),
      },
    );
    if (run !== version) return;
    total.value = result.total;
    const last = Math.max(1, Math.ceil(result.total / 20));
    if (page.value > last) {
      page.value = last;
      await load();
      return;
    }
    list.value = result.list;
  } catch (e: any) {
    if (run === version) error.value = e.message || "加载失败，请重试";
  } finally {
    if (run === version) loading.value = false;
  }
}
function choose(nextKind: ActivityKind, nextStatus: ActivityStatus = "all") {
  kind.value = nextKind;
  status.value = nextStatus;
  page.value = 1;
  taskRef.value = "";
  taskName.value = "";
  search.value = "";
  from.value = "";
  to.value = "";
  applied.value = { search: "", from: "", to: "" };
  load();
}
function filter() {
  applied.value = {
    search: search.value.trim(),
    from: from.value,
    to: to.value,
  };
  page.value = 1;
  load();
}
function showWorks(row: ActivityRecord) {
  kind.value = "works";
  status.value = "all";
  taskRef.value = row.taskRef;
  taskName.value = row.keyword;
  search.value = "";
  from.value = "";
  to.value = "";
  applied.value = { search: "", from: "", to: "" };
  page.value = 1;
  load();
}
watch(
  () => [
    props.memberId,
    props.projectId,
    props.initialKind,
    props.initialStatus,
  ],
  () => {
    summary.value = null;
    moduleId.value = "";
    kind.value = props.initialKind;
    status.value = props.initialStatus;
    page.value = 1;
    search.value = "";
    from.value = "";
    to.value = "";
    taskRef.value = "";
    taskName.value = "";
    applied.value = { search: "", from: "", to: "" };
    load(true);
  },
  { immediate: true },
);
</script>
<template>
  <section class="member-activity" aria-label="成员任务与作品">
    <div class="activity-head">
      <h3>任务与作品</h3>
      <button :disabled="loading" @click="load(true)">刷新记录</button>
    </div>
    <p class="scope-note">
      {{ projectId ? "当前筛选项目" : "当前可访问项目" }} ·
      该成员本人的记录，不累计下属的任务和作品。
    </p>
    <p v-if="summary?.unsupported.length" role="status">
      以下项目暂未提供统计：{{ summary.unsupported.join("、") }}
    </p>
    <label v-if="(summary?.modules.length || 0) > 1"
      >项目类型
      <select v-model="moduleId" @change="choose('tasks')">
        <option
          v-for="m in summary?.modules"
          :key="m.moduleId"
          :value="m.moduleId"
        >
          {{ m.name }}
        </option>
      </select>
    </label>
    <div v-if="counts" class="activity-metrics">
      <button
        v-for="m in metrics"
        :key="m.key"
        :aria-pressed="kind === m.kind && status === m.status && !taskRef"
        @click="choose(m.kind, m.status)"
      >
        <span>{{ m.label }}</span
        ><strong>{{ counts[m.key] }}</strong>
      </button>
    </div>
    <p v-if="counts" class="scope-note">
      任务按保存的领取／分配记录计数，释放后再次领取另记一条；在手含待分配、待核验及停用但未释放的记录。作品含提交失败和待提交，不代表审核通过。
    </p>
    <form v-if="moduleId" class="activity-filter" @submit.prevent="filter">
      <label class="search"
        >查找关键词或作品<input
          v-model="search"
          placeholder="输入关键词、小说名或作品信息"
          maxlength="200"
      /></label>
      <label v-if="kind === 'tasks'"
        >任务范围<select
          v-model="status"
          @change="
            page = 1;
            load();
          "
        >
          <option value="all">全部领取记录</option>
          <option value="current">当前在手</option>
          <option value="verified">已核验</option>
          <option value="released">已释放</option>
        </select></label
      >
      <label
        >{{ kind === "tasks" ? "领取／分配起日" : "登记起日"
        }}<input v-model="from" type="date" :max="to || undefined"
      /></label>
      <label
        >截止日期<input v-model="to" type="date" :min="from || undefined"
      /></label>
      <div class="filter-actions">
        <button :disabled="loading">搜索</button
        ><button type="button" @click="choose(kind)">清空筛选</button>
      </div>
    </form>
    <div v-if="taskRef" class="task-context">
      正在查看「{{ taskName }}」的作品
      <button @click="choose('works')">全部作品</button>
    </div>
    <p v-if="error" role="alert">
      {{ error }} <button @click="load(!summary)">重新加载</button>
    </p>
    <p v-else-if="loading" role="status">
      正在加载{{ kind === "tasks" ? "任务" : "作品" }}记录…
    </p>
    <template v-else>
      <p v-if="!list.length" class="activity-empty">
        {{
          !moduleId
            ? "当前没有可查看的项目记录。"
            : applied.search ||
                applied.from ||
                applied.to ||
                taskRef ||
                status !== "all"
              ? "没有符合条件的记录，可以清空筛选查看全部。"
              : kind === "tasks"
                ? "该成员还没有领取／分配记录，领取任务后会显示在这里。"
                : "该成员还没有作品记录，登记作品后会显示在这里。"
        }}
      </p>
      <article
        v-for="row in list"
        :key="`${row.projectId}:${row.accountId}:${row.id}`"
        class="activity-record"
      >
        <header>
          <strong>{{ row.title }}</strong
          ><span :class="['record-status', row.tone]">{{ row.status }}</span>
        </header>
        <p v-if="kind === 'works'">关键词：{{ row.keyword }}</p>
        <p class="record-meta">
          {{ row.projectName }} ·
          {{ kind === "tasks" ? "领取／分配" : "首次登记" }} {{ row.at }}
        </p>
        <div class="record-actions">
          <a
            v-if="row.url"
            :href="row.url"
            target="_blank"
            rel="noopener noreferrer"
            >打开作品 ↗</a
          ><button v-if="kind === 'tasks'" @click="showWorks(row)">
            查看该词作品
          </button>
        </div>
        <details>
          <summary>
            {{ kind === "tasks" ? "任务详情" : "作品详情与审核结果" }}
          </summary>
          <dl>
            <template v-for="field in row.fields" :key="field.label"
              ><dt>{{ field.label }}</dt>
              <dd>
                <a
                  v-if="field.url"
                  :href="field.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  >{{ field.value }}</a
                ><template v-else>{{ field.value }}</template>
              </dd></template
            >
          </dl>
        </details>
      </article>
      <nav
        v-if="moduleId"
        class="activity-pagination"
        aria-label="成员业务明细分页"
      >
        <span
          >共 {{ total }} 条 · 第 {{ page }} /
          {{ Math.max(1, Math.ceil(total / 20)) }} 页</span
        ><button
          :disabled="page <= 1"
          @click="
            page--;
            load();
          "
        >
          上一页</button
        ><button
          :disabled="page * 20 >= total"
          @click="
            page++;
            load();
          "
        >
          下一页
        </button>
      </nav>
    </template>
  </section>
</template>
<style scoped>
.member-activity {
  min-width: 0;
  color: var(--ink);
}
.activity-head,
.activity-record header,
.record-actions,
.filter-actions,
.activity-pagination {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.activity-head,
.activity-record header {
  justify-content: space-between;
}
.activity-head h3 {
  margin: 0;
}
.scope-note,
.record-meta {
  color: var(--ink-soft);
  font-size: 12px;
  line-height: 1.6;
}
.activity-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin: 16px 0;
}
.activity-metrics button {
  display: grid;
  text-align: left;
  gap: 10px;
  min-width: 0;
}
.activity-metrics strong {
  font-size: 22px;
  font-variant-numeric: tabular-nums;
}
button,
input,
select {
  border: 1px solid var(--line);
  background: var(--paper);
  color: inherit;
  border-radius: 6px;
  min-height: 40px;
  padding: 8px 10px;
  font: inherit;
  box-sizing: border-box;
}
button {
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
button[aria-pressed="true"] {
  background: #edf4f3;
  border-color: #195e62;
  color: #195e62;
}
.activity-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 12px;
  margin: 20px 0;
}
.activity-filter label {
  display: grid;
  gap: 6px;
  font-size: 12px;
  min-width: 0;
}
.activity-filter .search {
  flex: 1 1 100%;
}
input,
select {
  width: 100%;
  min-width: 0;
  max-width: 100%;
}
.activity-record {
  padding: 16px 0;
  border-bottom: 1px solid var(--line);
}
.activity-record strong,
.activity-record p,
dd,
a {
  overflow-wrap: anywhere;
}
.activity-record header strong {
  flex: 1;
  min-width: 0;
}
.record-status {
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 4px;
  background: #eef0ef;
}
.record-status.success {
  background: #e3efea;
  color: #23544a;
}
.record-status.warning {
  background: #fcf0db;
  color: #805614;
}
.record-status.danger {
  background: #f2e7e4;
  color: #8c413b;
}
a {
  color: #195e62;
}
summary {
  cursor: pointer;
  padding: 12px 0;
  color: #195e62;
}
dl {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  gap: 10px;
  font-size: 13px;
}
dt {
  color: var(--ink-soft);
}
dd {
  margin: 0;
}
.activity-empty {
  padding: 24px 0;
  line-height: 1.7;
}
.activity-pagination {
  margin-top: 16px;
  justify-content: flex-end;
  font-size: 12px;
}
.activity-pagination span {
  margin-right: auto;
}
.task-context {
  padding: 12px;
  background: #edf4f3;
  overflow-wrap: anywhere;
}
@media (max-width: 600px) {
  .activity-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .activity-filter label {
    flex: 1 1 40%;
  }
  dl {
    grid-template-columns: minmax(0, 1fr);
    gap: 5px;
  }
  dd {
    margin-bottom: 10px;
  }
}
</style>
