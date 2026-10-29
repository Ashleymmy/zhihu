<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  ROLE_LABELS,
  type TeamMember,
  type Project,
  type MemberChangeOperation,
  type MemberChangeRun,
  type MemberChangeState,
  type MemberChangeHistory,
} from "@zhihu-koc/shared-contracts/core";
import { apis } from "../stores/auth";
const props = defineProps<{
  references: string[];
  members: TeamMember[];
  projects: Project[];
  initialEdit?: Extract<MemberChangeOperation, { kind: "edit" }> | null;
}>();
const emit = defineEmits<{ close: []; changed: []; edit: [] }>();
const input = ref(props.references.join("\n")),
  kind = ref<MemberChangeOperation["kind"]>("team"),
  parent = ref(""),
  newRole = ref<"leader" | "creator">("leader"),
  childrenParent = ref("__choose"),
  projectMode = ref<"add" | "remove">("add"),
  projectIds = ref<string[]>([]),
  active = ref("1");
const run = ref<MemberChangeRun | null>(null),
  busy = ref(false),
  error = ref(""),
  history = ref<MemberChangeHistory[]>([]),
  statusFilter = ref("");
let mounted = true;
onBeforeUnmount(() => {
  mounted = false;
});
const leaders = computed(() =>
  props.members.filter(
    (m) =>
      m.role === "leader" &&
      m.isActive &&
      (!props.initialEdit || !props.references.includes("id:" + m.id)),
  ),
);
const singleMember = computed(() =>
  props.members.find((m) => props.references.includes("id:" + m.id)),
);
const needsChildDestination = computed(
  () =>
    props.initialEdit?.role === "creator" &&
    singleMember.value?.role === "leader",
);
const references = computed(() =>
  input.value
    .split(/[\s,，;；]+/)
    .map((v) => v.trim())
    .filter(Boolean),
);
const ready = computed(
  () =>
    run.value?.items.filter(
      (i) => i.status === "ready" || i.status === "pending",
    ).length ?? 0,
);
const succeeded = computed(
  () => run.value?.items.filter((i) => i.status === "succeeded").length ?? 0,
);
const problems = computed(
  () =>
    run.value?.items.filter(
      (i) => i.status === "blocked" || i.status === "failed",
    ) ?? [],
);
const retryable = computed(() =>
  problems.value.filter(
    (i) =>
      !i.userId ||
      run.value?.items.find((first) => first.userId === i.userId)?.ordinal ===
        i.ordinal,
  ),
);
const shown = computed(
  () =>
    run.value?.items.filter(
      (i) => !statusFilter.value || i.status === statusFilter.value,
    ) ?? [],
);
const labels: Record<string, string> = {
  ready: "可执行",
  pending: "等待处理",
  succeeded: "已完成",
  failed: "未完成",
  blocked: "需要处理",
  unchanged: "无需变更",
};
function operation(): MemberChangeOperation {
  if (props.initialEdit)
    return {
      ...props.initialEdit,
      ...(needsChildDestination.value && childrenParent.value !== "__choose"
        ? { childrenParentId: childrenParent.value || null }
        : {}),
    };
  if (kind.value === "team")
    return { kind: "team", parentId: parent.value || null };
  if (kind.value === "role")
    return {
      kind: "role",
      role: newRole.value,
      ...(newRole.value === "creator"
        ? {
            parentId: parent.value || null,
            ...(childrenParent.value !== "__choose"
              ? { childrenParentId: childrenParent.value || null }
              : {}),
          }
        : {}),
    };
  if (kind.value === "projects")
    return {
      kind: "projects",
      mode: projectMode.value,
      projectIds: projectIds.value,
    };
  return { kind: "active", isActive: active.value === "1" };
}
function summary(s: MemberChangeState | undefined) {
  if (!s) return "资料已变化，请重新预览";
  const role = ROLE_LABELS[s.role as keyof typeof ROLE_LABELS] ?? s.role;
  return `${role} · ${s.role === "leader" ? "团长本人" : s.parentName || "独立达人"} · ${s.active ? "启用" : "停用"} · 项目：${
    s.projects
      .filter((p) => !p.leftAt)
      .map((p) => p.name)
      .join("、") || "未开通"
  }`;
}
async function refreshHistory() {
  history.value = await apis.team.changeRuns();
}
async function preview(refs = references.value, op = operation()) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  statusFilter.value = "";
  try {
    run.value = await apis.team.previewChanges(refs, op);
    await refreshHistory();
  } catch (e: any) {
    error.value = e?.message || "预览失败，请重试";
  } finally {
    busy.value = false;
  }
}
async function openRun(id: string) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  statusFilter.value = "";
  try {
    run.value = await apis.team.changeRun(id);
  } catch (e: any) {
    error.value = e?.message || "读取失败，请重试";
  } finally {
    busy.value = false;
  }
}
async function execute() {
  if (!run.value || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    do {
      run.value = await apis.team.executeChanges(
        run.value.id,
        run.value.reviewHash,
      );
    } while (mounted && run.value.status !== "done");
    emit("changed");
    await refreshHistory();
  } catch (e: any) {
    error.value = e?.message || "操作暂时中断，请重新读取结果后继续";
  } finally {
    busy.value = false;
  }
}
function retry() {
  if (run.value)
    void preview(
      retryable.value.map((i) => (i.userId ? "id:" + i.userId : i.reference)),
      run.value.operation,
    );
}
function editAgain() {
  if (props.initialEdit) {
    if (needsChildDestination.value) {
      run.value = null;
      error.value = "";
    } else emit("edit");
    return;
  }
  // A saved single edit is reviewed here, but new edits start from current member data.
  if (run.value?.operation.kind === "edit") {
    emit("close");
    return;
  }
  if (run.value) {
    const op = run.value.operation;
    input.value = run.value.items.map((i) => i.reference).join("\n");
    kind.value = op.kind;
    if (op.kind === "team") parent.value = op.parentId || "";
    if (op.kind === "role") {
      newRole.value = op.role;
      parent.value = op.parentId || "";
      childrenParent.value =
        op.childrenParentId === undefined
          ? "__choose"
          : op.childrenParentId || "";
    }
    if (op.kind === "projects") {
      projectMode.value = op.mode;
      projectIds.value = [...op.projectIds];
    }
    if (op.kind === "active") active.value = op.isActive ? "1" : "0";
  }
  run.value = null;
  error.value = "";
}
onMounted(async () => {
  if (props.initialEdit && !needsChildDestination.value) await preview();
  else
    await refreshHistory().catch(() => {
      error.value = "操作记录暂未加载，可点击重新读取";
    });
});
</script>
<template>
  <article
    class="member-change panel"
    :aria-label="initialEdit ? '变更成员' : '批量变更成员'"
  >
    <header>
      <div>
        <h2>{{ initialEdit ? "变更成员" : "批量变更成员" }}</h2>
        <p>
          {{
            initialEdit
              ? "核对角色、团队及资料，确认后一起保存。"
              : "先核对影响，再确认执行。每位成员都有处理结果。"
          }}
        </p>
      </div>
      <button :disabled="busy" @click="emit('close')">返回成员列表</button>
    </header>
    <p v-if="error" class="change-error" role="alert">
      {{ error }}
      <button v-if="run" :disabled="busy" @click="openRun(run.id)">
        重新读取结果
      </button>
    </p>
    <nav class="change-steps" aria-label="操作进度">
      <span :class="{ current: !run }">1 选择变更</span
      ><span :class="{ current: run?.status === 'preview' }">2 核对影响</span
      ><span :class="{ current: run && run.status !== 'preview' }"
        >3 执行与结果</span
      >
    </nav>
    <form v-if="!run" @submit.prevent="preview()">
      <template v-if="initialEdit">
        <p>{{ singleMember?.displayName }} · {{ singleMember?.username }}</p>
        <p>
          调整为{{ ROLE_LABELS[initialEdit.role] }} ·
          {{
            initialEdit.role === "leader"
              ? "团长本人"
              : members.find((m) => m.id === initialEdit?.parentId)
                  ?.displayName || "独立达人"
          }}
        </p>
        <button type="button" :disabled="busy" @click="emit('edit')">
          返回修改资料
        </button>
        <label v-if="needsChildDestination"
          >团长名下成员的安置<select
            aria-label="团长名下成员的安置"
            v-model="childrenParent"
            :disabled="busy"
          >
            <option value="__choose">如有下属，需先选择归属</option>
            <option value="">全部调整为独立达人</option>
            <option v-for="l in leaders" :key="l.id" :value="l.id">
              全部转入 {{ l.displayName }}（{{ l.username }}）
            </option>
          </select></label
        >
      </template>
      <template v-else>
        <label
          >成员账号或固定 ID<textarea
            v-model="input"
            rows="5"
            placeholder="每行一个账号或 timo ID，也可以用空格、逗号分隔"
            :disabled="busy"
            required
          />
        </label>
        <p class="muted">
          已输入
          {{ references.length }}
          条，重复与未找到的账号会在预览中逐条列出。每次最多 1000 条。
        </p>
        <div class="change-fields">
          <label
            >要做什么<select
              aria-label="要做什么"
              v-model="kind"
              :disabled="busy"
            >
              <option value="team">调整所属团队</option>
              <option value="role">调整业务角色</option>
              <option value="projects">开通或移除项目</option>
              <option value="active">启用或停用账号</option>
            </select></label
          >
          <label v-if="kind === 'role'"
            >调整为<select
              aria-label="调整为"
              v-model="newRole"
              :disabled="busy"
            >
              <option value="leader">团长</option>
              <option value="creator">达人</option>
            </select></label
          >
          <label
            v-if="kind === 'team' || (kind === 'role' && newRole === 'creator')"
            >成员的新归属<select
              aria-label="成员的新归属"
              v-model="parent"
              :disabled="busy"
            >
              <option value="">独立达人</option>
              <option v-for="l in leaders" :key="l.id" :value="l.id">
                {{ l.displayName }}（{{ l.username }}）
              </option>
            </select></label
          >
          <label v-if="kind === 'role' && newRole === 'creator'"
            >团长名下成员的安置<select
              aria-label="团长名下成员的安置"
              v-model="childrenParent"
              :disabled="busy"
            >
              <option value="__choose">如有下属，需先选择归属</option>
              <option value="">全部调整为独立达人</option>
              <option v-for="l in leaders" :key="l.id" :value="l.id">
                全部转入 {{ l.displayName }}（{{ l.username }}）
              </option>
            </select></label
          >
          <label v-if="kind === 'projects'"
            >项目操作<select
              aria-label="项目操作"
              v-model="projectMode"
              :disabled="busy"
            >
              <option value="add">开通所选项目</option>
              <option value="remove">移除所选项目</option>
            </select></label
          >
          <label v-if="kind === 'active'"
            >账号状态<select
              aria-label="账号状态"
              v-model="active"
              :disabled="busy"
            >
              <option value="1">启用</option>
              <option value="0">停用（退出全部设备）</option>
            </select></label
          >
        </div>
        <fieldset v-if="kind === 'projects'">
          <legend>选择项目</legend>
          <label v-for="p in projects" :key="p.id" class="check"
            ><input
              v-model="projectIds"
              type="checkbox"
              :value="p.id"
              :disabled="busy || (projectMode === 'add' && !p.isEnabled)"
            />{{ p.name }}{{ p.isEnabled ? "" : "（已停用）" }}</label
          >
        </fieldset>
      </template>
      <p class="change-note">
        旧任务、作品及收益保留原归属；新业务按变更后的身份和团队办理。
      </p>
      <footer>
        <button
          class="primary-action"
          :disabled="
            busy ||
            !references.length ||
            references.length > 1000 ||
            (kind === 'projects' && !projectIds.length)
          "
        >
          {{ busy ? "正在核对成员与任务…" : "预览变更" }}
        </button>
      </footer>
    </form>
    <template v-else>
      <div class="change-summary" role="status">
        <strong>共 {{ run.items.length }} 条</strong
        ><span>可执行 / 待处理 {{ ready }}</span
        ><span>已完成 {{ succeeded }}</span
        ><span>需要处理 {{ problems.length }}</span
        ><span
          >无需变更
          {{ run.items.filter((i) => i.status === "unchanged").length }}</span
        >
      </div>
      <p v-if="run.status === 'preview'" class="change-note">
        仅执行“可执行”的成员，其余逐条保留原因。涉及团长降级时，下属安置会一起完成。权限变化后相关成员需要重新登录。
      </p>
      <p v-else-if="run.status === 'running'" class="change-note">
        进度已保存。刷新或离开页面后，可在操作记录中继续剩余成员。
      </p>
      <p v-else class="change-note">
        本次处理已结束。需要处理的成员可单独重新预览；已完成的不会重复执行。
      </p>
      <label class="status-filter"
        >查看结果<select v-model="statusFilter">
          <option value="">全部</option>
          <option
            v-for="(label, status) in labels"
            :key="status"
            :value="status"
          >
            {{ label }}
          </option>
        </select></label
      >
      <div class="change-results">
        <article v-for="item in shown" :key="item.ordinal" class="change-row">
          <div class="change-row-title">
            <strong>{{
              item.preview?.before[0]?.name || item.reference
            }}</strong
            ><small>{{ item.preview?.before[0]?.username || "" }}</small
            ><span class="change-badge" :data-status="item.status">{{
              labels[item.status]
            }}</span>
          </div>
          <div v-if="item.preview" class="before-after">
            <div>
              <small>变更前</small>
              <p>{{ summary(item.preview.before[0]) }}</p>
              <p v-if="run.operation.kind === 'edit'">
                姓名：{{ item.preview.before[0]?.name }} · 手机号：{{
                  item.preview.before[0]?.phone || "未填写"
                }}
              </p>
            </div>
            <div>
              <small>变更后</small>
              <p>{{ summary(item.preview.after[0]) }}</p>
              <p v-if="run.operation.kind === 'edit'">
                姓名：{{ item.preview.after[0]?.name }} · 手机号：{{
                  item.preview.after[0]?.phone || "未填写"
                }}
              </p>
            </div>
          </div>
          <p>{{ item.message }}</p>
          <details
            v-if="
              item.preview &&
              (item.preview.before.length > 1 || item.preview.tasks.length)
            "
          >
            <summary>
              查看影响：下属 {{ item.preview.before.length - 1 }} 人 ·
              保留旧任务 {{ item.preview.tasks.length }} 个
            </summary>
            <div
              v-for="(m, index) in item.preview.before.slice(1)"
              :key="m.id"
              class="dependent"
            >
              <strong>{{ m.name }}（{{ m.username }}）</strong>
              <p>
                {{ summary(m) }} → {{ summary(item.preview.after[index + 1]) }}
              </p>
            </div>
            <ul v-if="item.preview.tasks.length">
              <li
                v-for="t in item.preview.tasks"
                :key="t.projectId + ':' + t.id"
              >
                {{ t.label }} · 继续按原归属处理
              </li>
            </ul>
          </details>
          <a
            v-if="
              (item.status === 'blocked' || item.status === 'failed') &&
              item.message.includes('任务')
            "
            href="/app/tasks"
            target="_blank"
            rel="noopener"
            >打开任务管理处理，再回来重新预览</a
          >
        </article>
        <p v-if="!shown.length">
          没有此状态的成员。<button @click="statusFilter = ''">
            查看全部结果
          </button>
        </p>
      </div>
      <footer>
        <button
          v-if="run.status === 'preview'"
          :disabled="busy"
          @click="editAgain"
        >
          调整选择
        </button>
        <button
          v-if="run.status === 'preview'"
          class="primary-action"
          :disabled="busy || !ready"
          @click="execute"
        >
          {{ busy ? "正在执行…" : `确认执行 ${ready} 条` }}
        </button>
        <button
          v-if="run.status === 'running'"
          class="primary-action"
          :disabled="busy"
          @click="execute"
        >
          {{ busy ? "正在执行…" : "继续处理剩余成员" }}
        </button>
        <button
          v-if="run.status === 'done' && retryable.length"
          class="primary-action"
          :disabled="busy"
          @click="retry"
        >
          重新预览未完成项
        </button>
        <button
          v-if="run.status === 'done' && !initialEdit"
          :disabled="busy"
          @click="editAgain"
        >
          发起新的变更
        </button>
      </footer>
    </template>
    <details v-if="!initialEdit" class="change-history">
      <summary>最近操作记录（{{ history.length }}）</summary>
      <button
        :disabled="busy"
        @click="refreshHistory().catch(() => (error = '读取失败，请重试'))"
      >
        重新读取
      </button>
      <div v-for="h in history" :key="h.id">
        <span
          >{{ new Date(h.createdAt).toLocaleString("zh-CN") }} ·
          {{ h.total }} 条 ·
          {{
            h.status === "preview"
              ? "待确认"
              : h.status === "running"
                ? "处理中"
                : "已结束"
          }}</span
        ><button :disabled="busy" @click="openRun(h.id)">
          查看{{ h.status === "running" ? "并继续" : "" }}
        </button>
      </div>
    </details>
  </article>
</template>
<style scoped>
.member-change {
  padding: 24px;
  min-width: 0;
}
.member-change header,
.member-change footer,
.change-summary,
.change-steps,
.change-row-title {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.member-change header {
  justify-content: space-between;
}
.member-change h2 {
  margin: 0;
}
.member-change footer {
  justify-content: flex-end;
  margin-top: 20px;
}
.change-steps {
  margin: 20px 0;
  border-bottom: 1px solid var(--line);
  padding-bottom: 16px;
}
.change-steps span {
  padding: 8px 12px;
  color: var(--ink-soft);
}
.change-steps .current {
  background: #e8f2ef;
  color: #195e62;
  border-radius: 6px;
  font-weight: 600;
}
.member-change label {
  display: grid;
  gap: 8px;
  min-width: 0;
}
.member-change form {
  display: grid;
  gap: 16px;
}
.member-change input,
.member-change select,
.member-change textarea {
  font: inherit;
  color: inherit;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 10px;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
}
.member-change textarea {
  width: 100%;
  resize: vertical;
}
.change-fields,
.before-after {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.member-change fieldset {
  border: 1px solid var(--line);
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  min-width: 0;
}
.member-change .check {
  display: flex;
  align-items: center;
}
.check input {
  width: 18px;
  height: 18px;
}
.change-note {
  padding: 12px 16px;
  background: #edf4f3;
  border-radius: 6px;
}
.change-error {
  color: #a02f39;
}
.muted,
.member-change small {
  color: var(--ink-soft);
}
.change-summary {
  padding: 16px 0;
}
.status-filter {
  max-width: 240px;
  margin: 16px 0;
}
.change-results {
  display: grid;
  gap: 12px;
}
.change-row {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 16px;
  min-width: 0;
}
.change-row-title strong {
  font-size: 16px;
}
.change-badge {
  margin-left: auto;
  font-size: 12px;
  padding: 4px 8px;
  background: #eef1f2;
  border-radius: 5px;
}
.change-badge[data-status="ready"],
.change-badge[data-status="succeeded"] {
  color: #23544a;
  background: #e3efea;
}
.change-badge[data-status="blocked"],
.change-badge[data-status="failed"] {
  color: #8c413b;
  background: #f2e7e4;
}
.before-after {
  margin-top: 14px;
}
.before-after p {
  margin: 6px 0;
}
.member-change details {
  margin-top: 12px;
}
.member-change summary {
  cursor: pointer;
  color: #195e62;
}
.dependent {
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}
.member-change p,
.member-change li,
.change-row-title {
  overflow-wrap: anywhere;
}
.change-history {
  padding-top: 20px;
  border-top: 1px solid var(--line);
}
.change-history > div {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
}
.member-change a {
  color: #195e62;
}
.member-change button {
  font: inherit;
  min-height: 40px;
  padding: 8px 12px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 7px;
  color: inherit;
  cursor: pointer;
}
.member-change button.primary-action {
  background: #195e62;
  color: white;
}
.member-change button:disabled {
  opacity: 0.5;
  cursor: default;
}
@media (max-width: 650px) {
  .member-change {
    padding: 16px;
  }
  .change-fields,
  .before-after {
    grid-template-columns: minmax(0, 1fr);
  }
  .change-steps {
    gap: 4px;
    font-size: 12px;
  }
  .change-steps span {
    padding: 6px;
  }
  .change-history > div {
    align-items: start;
    flex-direction: column;
  }
  .member-change header > button {
    width: 100%;
  }
  .change-row-title {
    align-items: start;
  }
  .change-badge {
    margin-left: 0;
  }
}
</style>
