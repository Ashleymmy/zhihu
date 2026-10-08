<script setup lang="ts">
import { computed, inject, reactive, ref, watch } from "vue";
import type { CoreWorkspace } from "./core-workspace";
import DataGrid from "./DataGrid.vue";
import DetailDrawer from "./DetailDrawer.vue";
import type { DataGridRow } from "./data-grid";
import type {
  PlatformTask,
  PlatformTaskDetail,
  TaskAction,
  TaskGroup,
} from "./platform-tasks";
const props = defineProps<{ hall?: boolean; initialProjectId?: string }>();
const w = inject<CoreWorkspace>("opc")!,
  emit = defineEmits<{ navigate: [path: string] }>();
const groups = ref<TaskGroup[]>([]),
  projects = ref<{ id: string; name: string }[]>([]),
  projectId = ref(props.initialProjectId ?? ""),
  search = ref(""),
  loading = ref(false),
  error = ref(""),
  notice = ref("");
const selected = ref<{ group: TaskGroup; task: PlatformTask } | null>(null),
  detail = ref<PlatformTaskDetail | null>(null),
  detailLoading = ref(false),
  detailError = ref(""),
  action = ref<TaskAction | null>(null),
  saving = ref(false),
  confirmed = ref(false),
  input = reactive<Record<string, string>>({});
let generation = 0,
  detailGeneration = 0,
  key = "";
const title = computed(() =>
  props.hall
    ? "任务大厅"
    : w.role.value === "creator"
      ? "我的任务"
      : w.role.value === "leader"
        ? "团队任务"
        : "任务管理",
);
const view = computed(() =>
  props.hall
    ? "available"
    : ["creator", "leader"].includes(w.role.value)
      ? "owned"
      : "all",
);
type Listing = {
  projects: { id: string; name: string }[];
  groups: TaskGroup[];
};
async function load() {
  const current = ++generation;
  loading.value = true;
  error.value = "";
  try {
    const data = await w.http.get<Listing>("/tasks", {
      ...(projectId.value ? { projectId: projectId.value } : {}),
      view: view.value,
      search: search.value,
    });
    if (current === generation) {
      groups.value = data.groups;
      projects.value = data.projects;
    }
  } catch {
    if (current === generation) error.value = "任务暂时没加载出来，请重试。";
  } finally {
    if (current === generation) loading.value = false;
  }
}
watch(
  [() => props.hall, () => props.initialProjectId],
  () => {
    projectId.value = props.initialProjectId ?? "";
    selected.value = null;
    void load();
  },
  { immediate: true },
);
async function more(group: TaskGroup) {
  const current = generation;
  loading.value = true;
  error.value = "";
  try {
    const data = await w.http.get<Listing>("/tasks", {
      projectId: group.projectId,
      accountId: group.accountId,
      page: group.page + 1,
      view: view.value,
      search: search.value,
    });
    if (current !== generation) return;
    const next = data.groups[0];
    if (next?.status !== "ready") throw Error();
    group.list = [
      ...group.list,
      ...next.list.filter(
        (task) => !group.list.some((old) => old.id === task.id),
      ),
    ];
    group.page = next.page;
    group.total = next.total;
  } catch {
    if (current === generation) error.value = "后续任务没有加载出来，请重试。";
  } finally {
    if (current === generation) loading.value = false;
  }
}
const taskKey = (group: TaskGroup, task: PlatformTask) =>
  [group.projectId, group.moduleId, group.accountId, task.id].join(":");
const lookup = computed(
  () =>
    new Map(
      groups.value.flatMap((group) =>
        group.list.map(
          (task) => [taskKey(group, task), { group, task }] as const,
        ),
      ),
    ),
);
const rows = computed<DataGridRow[]>(() =>
  [...lookup.value].map(([id, { group, task }]) => ({
    id,
    title: task.title,
    status: task.status,
    cells: {
      project: group.projectName,
      novel: task.subtitle || "—",
      executor: task.executor,
      metrics: task.metrics.map((m) => m.label + " " + m.value).join(" · "),
    },
    next: {
      actor: task.next.actor,
      text: task.next.text,
      ...(task.next.action
        ? {
            action: {
              key: task.next.action.key,
              label: task.next.action.label,
            },
          }
        : {}),
    },
  })),
);
const creations = computed(() => groups.value.filter((g) => g.create));
const total = computed(() =>
  groups.value.reduce((sum, g) => sum + (g.total ?? 0), 0),
);
const path = (group: TaskGroup, task: PlatformTask) =>
  "/tasks/" +
  encodeURIComponent(group.moduleId) +
  "/" +
  encodeURIComponent(group.accountId) +
  "/" +
  encodeURIComponent(task.id);
function chooseAction(value: TaskAction) {
  if (value.path) {
    emit("navigate", value.path);
    return;
  }
  action.value = value;
  confirmed.value = false;
  key =
    globalThis.crypto?.randomUUID?.() ??
    "task-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  Object.keys(input).forEach((k) => delete input[k]);
  for (const field of value.fields ?? []) input[field.key] = field.value ?? "";
}
async function inspect(row: DataGridRow, actionKey?: string) {
  const entry = lookup.value.get(row.id);
  if (!entry) return;
  const current = ++detailGeneration;
  selected.value = entry;
  detail.value = null;
  action.value = null;
  detailError.value = "";
  detailLoading.value = true;
  try {
    const result = await w.http.get<PlatformTaskDetail>(
      path(entry.group, entry.task),
      { projectId: entry.group.projectId },
    );
    if (current !== detailGeneration) return;
    detail.value = result;
    if (actionKey) {
      const found = result.actions.find((a) => a.key === actionKey);
      if (found) chooseAction(found);
    }
  } catch {
    if (current === detailGeneration)
      detailError.value = "任务详情暂时没加载出来，请重试。";
  } finally {
    if (current === detailGeneration) detailLoading.value = false;
  }
}
function close() {
  if (saving.value) return;
  ++detailGeneration;
  selected.value = null;
  detail.value = null;
  action.value = null;
}
async function perform() {
  if (!selected.value || !action.value || saving.value) return;
  const entry = selected.value;
  saving.value = true;
  detailError.value = "";
  try {
    const result = await w.http.post<{ message: string }>(
      path(entry.group, entry.task) + "/actions/" + action.value.key,
      {
        projectId: entry.group.projectId,
        requestKey: key,
        input: { ...input },
      },
    );
    await load();
    const refreshed = lookup.value.get(taskKey(entry.group, entry.task));
    if (refreshed)
      detail.value = await w.http.get<PlatformTaskDetail>(
        path(entry.group, entry.task),
        { projectId: entry.group.projectId },
      );
    else selected.value = null;
    action.value = null;
    notice.value = result.message;
  } catch (e) {
    detailError.value =
      typeof e === "object" && e && "message" in e
        ? String(e.message)
        : "没有保存成功，请重试。";
  } finally {
    saving.value = false;
  }
}
const safeUrl = (value: string) => {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
};
async function copy(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    notice.value = "原文链接已复制";
  } catch {
    detailError.value = "复制未完成，可以长按原文链接复制。";
  }
}
</script>
<template>
  <section class="page-stack platform-tasks" :aria-busy="loading">
    <header class="page-header">
      <div>
        <h1>{{ title }}</h1>
        <p>
          {{
            hall
              ? "选择任务，查看原文后开始创作。"
              : "点开任务查看进度，在需要处理的一步继续。"
          }}
        </p>
      </div>
      <router-link
        v-if="creations.length === 1"
        class="primary-action"
        :to="creations[0]!.create!.path"
        >{{ creations[0]!.create!.label }}</router-link
      >
    </header>
    <form class="task-filters panel" @submit.prevent="load">
      <label
        >项目<select v-model="projectId" @change="load">
          <option value="">全部项目</option>
          <option v-for="p in projects" :key="p.id" :value="p.id">
            {{ p.name }}
          </option>
        </select></label
      ><label
        >查找任务<input
          v-model="search"
          maxlength="128"
          placeholder="输入任务名称或说明" /></label
      ><button :disabled="loading">搜索</button
      ><button type="button" :disabled="loading" @click="load">刷新</button>
    </form>
    <p v-if="notice" role="status">{{ notice }}</p>
    <div
      v-if="error || groups.some((g) => g.status === 'unavailable')"
      role="alert"
      class="task-error"
    >
      <p>{{ error || "部分项目加载失败，已加载的任务仍可处理。" }}</p>
      <button :disabled="loading" @click="load">重试</button>
    </div>
    <p
      v-for="g in groups.filter((g) => g.status === 'unsupported')"
      :key="g.projectId + ':' + g.accountId"
    >
      {{ g.projectName }} 暂不提供任务功能。
    </p>
    <div v-if="creations.length > 1" class="task-create-options">
      <router-link
        v-for="g in creations"
        :key="g.accountId"
        :to="g.create!.path"
        >{{ g.projectName }}：{{ g.create!.label }} →</router-link
      >
    </div>
    <DataGrid
      :rows="rows"
      :columns="[
        { key: 'project', label: '项目' },
        { key: 'novel', label: '说明' },
        { key: 'executor', label: '执行人' },
        { key: 'metrics', label: '进展与适用规则' },
      ]"
      :title="title"
      title-label="任务"
      :views="[{ key: 'all', label: '当前显示' }]"
      :group-options="[
        { key: 'status', label: '按状态' },
        { key: 'project', label: '按项目' },
      ]"
      :totals="
        () => [
          { label: '已显示', value: rows.length + ' 条' },
          { label: '符合条件', value: total + ' 条' },
        ]
      "
      :busy="loading"
      hide-search
      external-details
      :empty-text="
        hall
          ? '暂时没有可以领取的任务，可以自主创建任务。'
          : '还没有相关任务，可创建任务或去任务大厅领取。'
      "
      @inspect="inspect"
      @action="({ row, key }) => inspect(row, key)"
    />
    <div
      v-for="g in groups.filter(
        (g) =>
          g.status === 'ready' && g.total !== null && g.list.length < g.total,
      )"
      :key="g.projectId + g.accountId"
      class="task-more"
    >
      <span
        >{{ g.projectName }} · 已显示 {{ g.list.length }} /
        {{ g.total }} 条</span
      ><button :disabled="loading" @click="more(g)">继续加载</button>
    </div>
    <router-link v-if="!hall && !rows.length && !loading" to="/task-hall"
      >去任务大厅 →</router-link
    >
    <DetailDrawer
      :open="!!selected"
      :title="detail?.title ?? selected?.task.title ?? '任务详情'"
      @close="close"
      ><p v-if="detailLoading" role="status">正在加载任务进度…</p>
      <div v-if="detailError" role="alert" class="task-error">
        <p>{{ detailError }}</p>
        <button
          v-if="!detail && selected"
          @click="
            inspect(
              rows.find(
                (r) => r.id === taskKey(selected!.group, selected!.task),
              )!,
            )
          "
        >
          重新加载
        </button>
      </div>
      <template v-if="detail">
        <p class="task-detail-status">
          {{ detail.status.label }} · {{ detail.executor }}
        </p>
        <p>{{ detail.next.actor }}：{{ detail.next.text }}</p>
        <div v-if="!action" class="task-actions">
          <button
            v-for="a in detail.actions"
            :key="a.key"
            :class="{'task-primary': a.key === detail.next.action?.key}"
            type="button"
            @click="chooseAction(a)"
          >
            {{ a.label }}
          </button>
        </div>
        <form v-else class="task-action-form" @submit.prevent="perform">
          <h3>{{ action.label }}</h3>
          <label v-for="field in action.fields ?? []" :key="field.key"
            >{{ field.label
            }}<select
              v-if="field.type === 'select'"
              v-model="input[field.key]"
              :aria-label="field.label"
              :disabled="saving"
              :required="field.required"
            >
              <option value="" disabled>请选择</option>
              <option
                v-for="option in field.options"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option></select
            ><textarea
              v-else-if="field.type === 'textarea'"
              v-model="input[field.key]"
              :aria-label="field.label"
              :disabled="saving"
              :required="field.required"
              maxlength="500" /><input
              v-else
              v-model="input[field.key]"
              :aria-label="field.label"
              :disabled="saving"
              :type="field.type"
              :required="field.required"
              :maxlength="field.type === 'url' ? 1024 : 128" /></label
          ><label v-if="action.confirm" class="task-confirm"
            ><input type="checkbox" v-model="confirmed" required />{{
              action.confirm
            }}</label
          >
          <div class="task-actions">
            <button
              class="task-primary"
              :disabled="saving || (!!action.confirm && !confirmed)"
            >
              {{ saving ? "保存中…" : "确认" + action.label }}</button
            ><button type="button" :disabled="saving" @click="action = null">
              取消
            </button>
          </div>
        </form>
        <div class="task-facts">
          <p v-for="field in detail.fields" :key="field.label">
            <span>{{ field.label }}</span
            ><a
              v-if="field.url && safeUrl(field.url)"
              :href="safeUrl(field.url)"
              target="_blank"
              rel="noopener noreferrer"
              >{{ field.value }}</a
            ><strong v-else>{{ field.value }}</strong
            ><button
              v-if="field.url && safeUrl(field.url)"
              type="button"
              @click="copy(field.url)"
            >
              复制链接
            </button>
          </p>
          <p v-for="metric in detail.metrics" :key="metric.label">
            <span>{{ metric.label }}</span
            ><strong>{{ metric.value }}</strong>
          </p>
        </div>
        <h3>任务进度</h3>
        <ol class="task-progress">
          <li
            v-for="step in detail.progress"
            :key="step.label"
            :class="step.status"
          >
            <strong>{{ step.label }}</strong
            ><span>{{
              step.status === "done"
                ? "已完成"
                : step.actor + "：" + (step.description || "等待前一步完成")
            }}</span>
          </li>
        </ol>

      </template></DetailDrawer
    >
  </section>
</template>
<style scoped>
.platform-tasks {
  min-width: 0;
}
.task-filters {
  padding: 18px;
  display: flex;
  align-items: end;
  gap: 12px;
  flex-wrap: wrap;
}
.task-filters label,
.task-action-form > label {
  display: grid;
  gap: 7px;
  font-size: 13px;
  min-width: 0;
}
.task-filters label {
  flex: 1;
  min-width: 160px;
}
.task-filters input,
.task-filters select,
.task-action-form input,
.task-action-form select,
.task-action-form textarea {
  width: 100%;
  min-height: 44px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--paper);
  color: inherit;
  box-sizing: border-box;
  min-width: 0;
}
.platform-tasks button,
.task-actions button,
.task-facts button,
.task-error button {
  min-height: 44px;
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--paper);
  color: inherit;
  cursor: pointer;
}
.task-error {
  padding: 14px;
  background: #fff1ed;
  border: 1px solid #d6ada1;
  border-radius: 8px;
}
.task-error p {
  margin: 0 0 8px;
}
.task-create-options,
.task-more {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
}
.task-detail-status {
  color: var(--ink-soft);
}
.task-facts p {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
  overflow-wrap: anywhere;
}
.task-facts span {
  color: var(--ink-soft);
  font-size: 13px;
}
.task-facts strong {
  font-weight: 500;
}
.task-progress {
  padding: 0;
  list-style: none;
  margin: 16px 0 24px;
}
.task-progress li {
  padding: 0 0 20px 25px;
  margin-left: 7px;
  border-left: 2px solid #d6dcda;
  position: relative;
}
.task-progress li:last-child {
  border: 0;
}
.task-progress li::before {
  content: "";
  position: absolute;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  left: -7px;
  top: 3px;
  background: #b9c0bd;
}
.task-progress li.done::before {
  background: #308268;
}
.task-progress li.current::before {
  background: #c58b2b;
}
.task-progress li.current strong {
  color: #99620b;
}
.task-progress strong,
.task-progress span {
  display: block;
}
.task-progress span {
  font-size: 13px;
  margin-top: 5px;
  color: var(--ink-soft);
  overflow-wrap: anywhere;
}
.task-actions {
  margin: 14px 0;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.task-action-form {
  display: grid;
  gap: 16px;
}
.task-action-form textarea {
  min-height: 96px;
}
.task-action-form .task-confirm {
  display: flex;
  align-items: start;
  gap: 8px;
  line-height: 1.6;
}
.task-confirm input {
  width: 18px;
  min-height: 18px;
  flex: none;
  margin-top: 3px;
}
.task-actions .task-primary {
  background: #195e62;
  border-color: #195e62;
  color: #fff;
}
@media (max-width: 600px) {
  .task-filters label {
    flex-basis: 100%;
  }
  .task-filters input,
  .task-filters select,
  .task-action-form input,
  .task-action-form select {
    font-size: 16px;
  }
  .task-actions button {
    max-width: 100%;
    white-space: normal;
  }
  .task-more span {
    flex-basis: 100%;
  }
}
</style>
