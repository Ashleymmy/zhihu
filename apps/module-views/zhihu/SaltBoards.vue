<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { DataGrid, type DataGridRow } from "@zhihu-koc/shared-components";
import type { HttpClient } from "@zhihu-koc/shared-services/core";
interface Board {
  id: string;
  name: string;
  type: number;
  updatedAt: string;
}
interface Book {
  id: string;
  title: string;
  url: string;
  columnTitle: string;
  columnUrl: string;
  topics: string[];
  category: string;
  contentType: string;
  contentLevel: string;
  firstCategory: string;
  secondCategory: string;
  theme: string;
  consumeValue: string;
}
interface Page {
  list: Book[];
  total: number;
  offset: number;
  limit: number;
  hasNext: boolean;
}
const props = defineProps<{
  http: HttpClient;
  coreHttp: HttpClient;
  role: string;
  adminDuty?: string;
  initialProjectId?: string;
  initialAccountId?: string;
}>();
const emit = defineEmits<{ back: [] }>();
const allowed = computed(
  () =>
    ["admin", "developer", "operator"].includes(props.role) &&
    (props.role !== "admin" || props.adminDuty !== "finance"),
);
const projects = ref<{ id: string; name: string }[]>([]),
  accounts = ref<{ id: string; name: string }[]>([]);
const projectId = ref(""),
  accountId = ref(""),
  boards = ref<Board[]>([]),
  activeId = ref("");
const books = ref<Book[]>([]),
  offset = ref(0),
  total = ref(0),
  hasNext = ref(false),
  limit = 20;
const scopeError = ref(""),
  boardError = ref(""),
  contentError = ref(""),
  copyMessage = ref("");
const scopeBusy = ref(false),
  boardBusy = ref(false),
  contentBusy = ref(false);
let scopesVersion = 0,
  boardsVersion = 0,
  contentsVersion = 0;
const scope = computed(() => ({
  projectId: projectId.value,
  accountId: accountId.value,
}));
const active = computed(() =>
  boards.value.find((b) => b.id === activeId.value),
);
const columns = [
  { key: "position", label: "顺序", numeric: true },
  { key: "column", label: "所属专栏" },
  { key: "topics", label: "题材与标签" },
];
const rows = computed<DataGridRow[]>(() =>
  books.value.map((b, i) => ({
    id: b.id,
    title: b.title,
    status: {
      key: "content",
      label: b.contentType || "榜单内容",
      tone: "neutral",
    },
    cells: {
      position: offset.value + i + 1,
      column: b.columnTitle || "—",
      topics:
        [...b.topics, b.theme, b.firstCategory].filter(Boolean).join(" · ") ||
        "—",
    },
    next: {
      actor: "选题",
      text: "查看小说原文",
      action: { key: "read", label: "查看原文", disabled: !b.url },
    },
  })),
);
const selectedBook = (row: DataGridRow) =>
  books.value.find((book) => book.id === row.id);
function clearContents() {
  ++contentsVersion;
  books.value = [];
  total.value = 0;
  hasNext.value = false;
  contentError.value = "";
  contentBusy.value = false;
  copyMessage.value = "";
}
function clearBoards() {
  ++boardsVersion;
  boards.value = [];
  activeId.value = "";
  boardError.value = "";
  boardBusy.value = false;
  clearContents();
}
async function loadProjects() {
  if (!allowed.value) return;
  scopeError.value = "";
  scopeBusy.value = true;
  try {
    projects.value = await props.coreHttp.get("/projects");
    const id =
      projects.value.find((p) => p.id === props.initialProjectId)?.id ??
      projects.value[0]?.id ??
      "";
    if (projectId.value === id) await loadAccounts();
    else projectId.value = id;
  } catch {
    scopeError.value = "项目加载失败，请重新加载";
  } finally {
    scopeBusy.value = false;
  }
}
async function loadAccounts() {
  const version = ++scopesVersion;
  clearBoards();
  accountId.value = "";
  accounts.value = [];
  scopeError.value = "";
  if (!projectId.value) return;
  scopeBusy.value = true;
  try {
    const list = await props.coreHttp.get<
      { id: string; name: string; moduleId: string; status: string }[]
    >("/projects/" + projectId.value + "/integrations");
    if (version !== scopesVersion) return;
    accounts.value = list.filter(
      (a) => a.moduleId === "zhihu" && a.status === "active",
    );
    accountId.value =
      accounts.value.find(
        (a) =>
          projectId.value === props.initialProjectId &&
          a.id === props.initialAccountId,
      )?.id ??
      accounts.value[0]?.id ??
      "";
  } catch {
    if (version === scopesVersion)
      scopeError.value = "项目服务加载失败，请重试";
  } finally {
    if (version === scopesVersion) scopeBusy.value = false;
  }
}
async function loadBoards() {
  clearBoards();
  if (!projectId.value || !accountId.value || !allowed.value) return;
  const version = boardsVersion;
  boardBusy.value = true;
  try {
    const result = await props.http.get<{ list: Board[] }>(
      "/zhihu-content/salt/boards",
      scope.value,
    );
    if (version !== boardsVersion) return;
    boards.value = result.list;
    activeId.value = result.list[0]?.id ?? "";
    if (activeId.value) await loadContents(0);
  } catch {
    if (version === boardsVersion)
      boardError.value =
        "暂时无法读取知乎榜单，请重新加载；也可以切换项目后再试。";
  } finally {
    if (version === boardsVersion) boardBusy.value = false;
  }
}
async function loadContents(nextOffset: number) {
  clearContents();
  if (!activeId.value) return;
  const version = contentsVersion;
  offset.value = nextOffset;
  contentBusy.value = true;
  try {
    const result = await props.http.get<Page>(
      "/zhihu-content/salt/boards/" +
        encodeURIComponent(activeId.value) +
        "/contents",
      { ...scope.value, offset: nextOffset, limit },
    );
    if (version !== contentsVersion) return;
    books.value = result.list;
    total.value = result.total;
    hasNext.value = result.hasNext;
  } catch {
    if (version === contentsVersion)
      contentError.value = "暂时无法读取榜单内容，请重试或切换其他榜单。";
  } finally {
    if (version === contentsVersion) contentBusy.value = false;
  }
}
function read(row: DataGridRow) {
  const url = selectedBook(row)?.url;
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}
async function copy(url: string) {
  copyMessage.value = "";
  try {
    await navigator.clipboard.writeText(url);
    copyMessage.value = "原文链接已复制";
  } catch {
    copyMessage.value = "复制失败，请选择下方原文链接后手动复制。";
  }
}
watch(projectId, loadAccounts);
watch(accountId, loadBoards);
onMounted(loadProjects);
onBeforeUnmount(() => {
  ++scopesVersion;
  ++boardsVersion;
  ++contentsVersion;
});
</script>
<template>
  <section class="salt-page page-stack">
    <header class="salt-heading">
      <div>
        <h1>盐选榜单</h1>
        <p>查看知乎榜单，打开小说原文或复制链接用于选题。</p>
      </div>
      <button @click="emit('back')">返回项目设置</button>
    </header>
    <p v-if="!allowed" role="alert">盐选榜单仅向管理员和运营开放。</p>
    <template v-else>
      <div class="salt-controls">
        <label
          >项目<select v-model="projectId" :disabled="!projects.length">
            <option v-for="p in projects" :key="p.id" :value="p.id">
              {{ p.name }}
            </option>
          </select></label
        ><label v-if="accounts.length > 1"
          >数据来源<select v-model="accountId">
            <option v-for="a in accounts" :key="a.id" :value="a.id">
              {{ a.name }}
            </option>
          </select></label
        ><button
          :disabled="scopeBusy || boardBusy || contentBusy || !accountId"
          @click="loadBoards"
        >
          刷新榜单
        </button>
      </div>
      <div v-if="scopeError" role="alert" class="salt-error">
        {{ scopeError }} <button @click="loadProjects">重新加载项目</button>
      </div>
      <p v-else-if="scopeBusy" role="status">正在读取项目…</p>
      <p v-else-if="!accountId" class="salt-empty">
        还没有可用的知乎项目。请返回项目设置接通服务后再查看。
      </p>
      <template v-else>
        <div v-if="boardError" role="alert" class="salt-error">
          {{ boardError }} <button @click="loadBoards">重新加载榜单</button>
        </div>
        <p v-else-if="boardBusy && !boards.length" role="status">
          正在读取知乎榜单…
        </p>
        <div v-else-if="!boards.length" class="salt-empty">
          <p>知乎暂未提供可用榜单，稍后可以重新查询。</p>
          <button @click="loadBoards">重新查询</button>
        </div>
        <template v-else>
          <div class="salt-board">
            <label
              >选择榜单<select
                v-model="activeId"
                aria-label="选择榜单"
                @change="loadContents(0)"
              >
                <option v-for="b in boards" :key="b.id" :value="b.id">
                  {{ b.name }}
                </option>
              </select></label
            >
            <div>
              <strong>{{ active?.name }}</strong>
              <p>
                {{
                  active?.type === 1
                    ? "常规书单"
                    : active?.type === 2
                      ? "推荐书单"
                      : "其他书单"
                }}<span v-if="active?.updatedAt">
                  · 更新于 {{ active.updatedAt }}</span
                >
              </p>
            </div>
          </div>
          <div v-if="contentError" role="alert" class="salt-error">
            {{ contentError }}
            <button @click="loadContents(offset)">重试内容查询</button>
          </div>
          <p v-else-if="contentBusy" role="status">正在读取榜单内容…</p>
          <template v-else>
            <DataGrid
              :key="projectId + '-' + accountId + '-' + activeId + '-' + offset"
              :rows="rows"
              :columns="columns"
              title="榜单内容"
              title-label="小说名称"
              search-placeholder="筛选本页小说名或标签"
              :views="[{ key: 'all', label: '本页内容' }]"
              empty-text="这一页没有内容。可以切换榜单，或返回上一页查看。"
              :totals="
                (visible) => [
                  { label: '本页筛选结果', value: visible.length + ' 条' },
                  { label: '榜单总数', value: total + ' 条' },
                ]
              "
              @action="({ row }) => read(row)"
              @inspect="copyMessage = ''"
            >
              <template #detail="{ row }"
                ><div v-if="selectedBook(row)" class="salt-detail">
                  <dl>
                    <div>
                      <dt>所属专栏</dt>
                      <dd>{{ selectedBook(row)!.columnTitle || "未提供" }}</dd>
                    </div>
                    <div>
                      <dt>题材标签</dt>
                      <dd>
                        {{ selectedBook(row)!.topics.join("、") || "未提供" }}
                      </dd>
                    </div>
                    <div>
                      <dt>内容分类</dt>
                      <dd>{{ selectedBook(row)!.category || "未提供" }}</dd>
                    </div>
                    <div v-if="selectedBook(row)!.firstCategory">
                      <dt>领域</dt>
                      <dd>
                        {{
                          [
                            selectedBook(row)!.firstCategory,
                            selectedBook(row)!.secondCategory,
                          ]
                            .filter(Boolean)
                            .join(" / ")
                        }}
                      </dd>
                    </div>
                    <div v-if="selectedBook(row)!.theme">
                      <dt>兴趣标签</dt>
                      <dd>{{ selectedBook(row)!.theme }}</dd>
                    </div>
                    <div v-if="selectedBook(row)!.contentLevel">
                      <dt>内容等级</dt>
                      <dd>{{ selectedBook(row)!.contentLevel }}</dd>
                    </div>
                    <div v-if="selectedBook(row)!.consumeValue">
                      <dt>推荐消费价值</dt>
                      <dd>{{ selectedBook(row)!.consumeValue }}</dd>
                    </div>
                  </dl>
                  <div class="salt-actions">
                    <a
                      v-if="selectedBook(row)!.url"
                      :href="selectedBook(row)!.url"
                      target="_blank"
                      rel="noopener noreferrer"
                      >查看原文</a
                    ><a
                      v-if="selectedBook(row)!.columnUrl"
                      :href="selectedBook(row)!.columnUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      >查看专栏</a
                    ><button
                      v-if="selectedBook(row)!.url"
                      @click="copy(selectedBook(row)!.url)"
                    >
                      复制原文链接
                    </button>
                  </div>
                  <label v-if="selectedBook(row)!.url"
                    >原文链接<input
                      readonly
                      :value="selectedBook(row)!.url"
                      @focus="($event.target as HTMLInputElement).select()"
                  /></label>
                  <p v-else>
                    知乎未提供可打开的原文链接，可以查看专栏或选择其他内容。
                  </p>
                  <p role="status">{{ copyMessage }}</p>
                </div></template
              >
            </DataGrid>
          </template>
          <footer class="salt-pages">
            <span
              >第 {{ Math.floor(offset / limit) + 1 }} 页<span
                v-if="!contentBusy && !contentError"
              >
                · 共 {{ total }} 条</span
              ></span
            >
            <div>
              <button
                :disabled="contentBusy || offset === 0"
                @click="loadContents(Math.max(0, offset - limit))"
              >
                上一页</button
              ><button
                :disabled="contentBusy || !!contentError || !hasNext"
                @click="loadContents(offset + limit)"
              >
                下一页
              </button>
            </div>
          </footer>
        </template>
      </template>
    </template>
  </section>
</template>
<style scoped>
.salt-page {
  min-width: 0;
  color: var(--ink, #20292f);
}
.salt-heading,
.salt-controls,
.salt-board,
.salt-pages,
.salt-actions {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}
.salt-heading h1 {
  margin: 0;
  font-size: 30px;
}
.salt-heading p,
.salt-board p {
  color: var(--ink-soft, #637078);
  margin: 8px 0;
}
.salt-controls,
.salt-board {
  justify-content: flex-start;
  padding: 20px;
  border: 1px solid var(--line, #ddd);
  border-radius: 12px;
  background: var(--paper, #fff);
}
.salt-page label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 200px;
  font-size: 14px;
}
.salt-page select,
.salt-page input {
  max-width: 100%;
  min-height: 42px;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--line, #ddd);
  border-radius: 6px;
  background: var(--paper, #fff);
  color: inherit;
}
.salt-page button,
.salt-actions a {
  padding: 10px 14px;
  border: 1px solid var(--line, #ddd);
  border-radius: 8px;
  background: var(--paper, #fff);
  color: var(--ink, #20292f);
  cursor: pointer;
  text-decoration: none;
  min-height: 42px;
}
.salt-page button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.salt-page button:focus-visible,
.salt-page select:focus-visible,
.salt-page a:focus-visible {
  outline: 2px solid #195e62;
  outline-offset: 3px;
}
.salt-error {
  padding: 18px;
  background: #fff1ef;
  color: #923c30;
  border-radius: 10px;
}
.salt-empty {
  padding: 28px;
  border: 1px solid var(--line, #ddd);
  border-radius: 12px;
  text-align: center;
}
.salt-pages > div {
  display: flex;
  gap: 8px;
}
.salt-detail {
  overflow-wrap: anywhere;
}
.salt-detail dl > div {
  padding: 12px 0;
  border-bottom: 1px solid var(--line, #ddd);
}
.salt-detail dt {
  font-size: 13px;
  color: var(--ink-soft, #637078);
}
.salt-detail dd {
  margin: 6px 0 0;
}
.salt-actions {
  justify-content: flex-start;
  margin: 20px 0;
}
.salt-detail label {
  min-width: 0;
}
.salt-detail input {
  width: 100%;
}
@media (max-width: 700px) {
  .salt-heading h1 {
    font-size: 25px;
  }
  .salt-controls,
  .salt-board {
    padding: 16px;
    align-items: stretch;
  }
  .salt-controls label,
  .salt-board label {
    width: 100%;
    min-width: 0;
  }
  .salt-page select {
    width: 100%;
  }
  .salt-pages {
    align-items: flex-start;
  }
  .salt-board > div {
    min-width: 0;
    overflow-wrap: anywhere;
  }
}

.salt-actions button {
  padding: 10px 14px;
  min-height: 42px;
  border: 1px solid var(--line, #ddd);
  border-radius: 8px;
  background: var(--paper, #fff);
  color: var(--ink, #20292f);
  cursor: pointer;
}
.salt-actions button:focus-visible {
  outline: 2px solid #195e62;
  outline-offset: 3px;
}
.salt-detail input {
  box-sizing: border-box;
  min-height: 42px;
  padding: 8px 10px;
  border: 1px solid var(--line, #ddd);
  border-radius: 6px;
  background: var(--paper, #fff);
  color: inherit;
}
.salt-detail label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 14px;
}
</style>
