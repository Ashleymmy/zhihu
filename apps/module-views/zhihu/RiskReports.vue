<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { DetailDrawer } from "@zhihu-koc/shared-components";
import { errorText, requestKey, type EngineContext } from "./context";
const props = defineProps<{ context: EngineContext }>();
const emit = defineEmits<{ back: [] }>();
interface Risk {
  keyword: string;
  riskType: number;
  status: string;
  channel?: string;
  createChannel?: string;
  validedAt?: string;
  id?: string;
  attempt?: number;
  createdAt?: string;
  message?: string;
}
interface Work {
  id: string;
  keyword: string;
  title: string;
  workUrl: string;
  executorName: string;
}
interface Picture {
  id: string;
  name: string;
  url: string;
}
const allowed = computed(
  () =>
    ["admin", "developer"].includes(
      props.context.authRole ?? props.context.role,
    ) && props.context.adminDuty !== "finance",
);
const view = ref<"outgoing" | "incoming" | "history">("outgoing"),
  form = ref(false),
  loading = ref(false),
  busy = ref(false),
  error = ref(""),
  notice = ref("");
const list = ref<Risk[]>([]),
  page = ref(1),
  hasNext = ref(false),
  keyword = ref(""),
  riskType = ref(""),
  status = ref("");
const statuses: Record<string, string> = {
  reviewing: "审核中",
  violation: "判定违规",
  normal: "判定正常",
  unknown: "结果待核对",
  sending: "提交中",
  submitted: "已提交知乎",
  failed: "提交未成功",
};
let generation = 0,
  worksGeneration = 0,
  disposed = false;
const query = () => ({ ...props.context.scope });
async function load() {
  const n = ++generation;
  loading.value = true;
  error.value = "";
  try {
    const r = await props.context.http.get<{ list: Risk[]; hasNext: boolean }>(
      view.value === "history" ? "/risk-reports/history" : "/risk-reports",
      {
        ...query(),
        ...(view.value === "history"
          ? { page: page.value }
          : {
              type: view.value === "outgoing" ? 1 : 0,
              offset: (page.value - 1) * 20,
              limit: 20,
              ...(keyword.value.trim()
                ? { keyword: keyword.value.trim() }
                : {}),
              ...(riskType.value ? { risk_type: Number(riskType.value) } : {}),
              ...(status.value ? { status: Number(status.value) } : {}),
            }),
      },
    );
    if (n === generation) {
      list.value = r.list;
      hasNext.value = r.hasNext;
    }
  } catch (e) {
    if (n === generation) {
      error.value = errorText(e);
      list.value = [];
      hasNext.value = false;
    }
  } finally {
    if (n === generation) loading.value = false;
  }
}
function tab(value: typeof view.value) {
  view.value = value;
  page.value = 1;
  void load();
}
const workSearch = ref(""),
  works = ref<Work[]>([]),
  workPage = ref(1),
  workNext = ref(false),
  workLoading = ref(false),
  workError = ref(""),
  selected = ref<Work | null>(null);
const riskWord = ref(""),
  kind = ref(1),
  riskUrl = ref(""),
  damage = ref(""),
  pictures = ref<Picture[]>([]),
  formError = ref(""),
  key = ref(requestKey()),
  locked = ref(false);
async function findWorks(reset = true) {
  if (reset) workPage.value = 1;
  const n = ++worksGeneration;
  workLoading.value = true;
  workError.value = "";
  try {
    const r = await props.context.http.get<{ list: Work[]; hasNext: boolean }>(
      "/risk-reports/works",
      { ...query(), search: workSearch.value.trim(), page: workPage.value },
    );
    if (n === worksGeneration) {
      works.value = r.list;
      workNext.value = r.hasNext;
    }
  } catch (e) {
    if (n === worksGeneration) {
      workError.value = errorText(e);
      works.value = [];
    }
  } finally {
    if (n === worksGeneration) workLoading.value = false;
  }
}
function start() {
  pictures.value.forEach((p) => URL.revokeObjectURL(p.url));
  pictures.value = [];
  selected.value = null;
  riskWord.value = "";
  riskUrl.value = "";
  damage.value = "";
  kind.value = 1;
  key.value = requestKey();
  locked.value = false;
  formError.value = "";
  notice.value = "";
  form.value = true;
  void findWorks();
}
function choose(work: Work) {
  selected.value = work;
  if (!damage.value) damage.value = work.keyword;
}
async function upload(event: Event) {
  const input = event.target as HTMLInputElement,
    files = Array.from(input.files ?? []);
  input.value = "";
  formError.value = "";
  if (!files.length) return;
  if (pictures.value.length + files.length > 3) {
    formError.value = "每次举报最多上传 3 张截图";
    return;
  }
  if (
    files.some(
      (f) =>
        !["image/png", "image/jpeg"].includes(f.type) ||
        f.size === 0 ||
        f.size > 2 * 1024 * 1024,
    )
  ) {
    formError.value = "请选择不超过 2 MB 的 PNG 或 JPEG 截图";
    return;
  }
  busy.value = true;
  try {
    for (const file of files) {
      const data = new FormData();
      data.set("file", file);
      const image = await props.context.http.postForm<{ id: string }>(
        "/risk-reports/images?" + new URLSearchParams(query()),
        data,
      );
      if (disposed) return;
      pictures.value.push({
        id: image.id,
        name: file.name,
        url: URL.createObjectURL(file),
      });
    }
  } catch (e) {
    const status = (e as { status?: number })?.status;
    if (status && status >= 400 && status < 500) {
      locked.value = false;
      key.value = requestKey();
    }
    formError.value = errorText(e) + "。已经传好的截图会保留。";
  } finally {
    busy.value = false;
  }
}
function remove(index: number) {
  const picture = pictures.value[index];
  if (!picture) return;
  URL.revokeObjectURL(picture.url);
  pictures.value.splice(index, 1);
}
async function submit() {
  if (busy.value) return;
  formError.value = "";
  if (
    !selected.value ||
    !riskWord.value.trim() ||
    !pictures.value.length ||
    (kind.value === 2 && !riskUrl.value.trim())
  ) {
    formError.value = "请选择作品、填写风险词并上传截图；搬运词还需要风险链接";
    return;
  }
  busy.value = true;
  locked.value = true;
  try {
    const r = await props.context.http.post<Risk>("/risk-reports", {
      ...query(),
      requestKey: key.value,
      report: {
        compositionId: selected.value.id,
        keyword: riskWord.value.trim(),
        riskType: kind.value,
        imageIds: pictures.value.map((p) => p.id),
        ...(riskUrl.value.trim() ? { riskUrl: riskUrl.value.trim() } : {}),
        ...(damage.value.trim() ? { damageKeyword: damage.value.trim() } : {}),
      },
    });
    form.value = false;
    notice.value = r.message || statuses[r.status] || "已读取提交结果";
    tab("history");
  } catch (e) {
    const status = (e as { status?: number })?.status;
    if (status && status >= 400 && status < 500) {
      locked.value = false;
      key.value = requestKey();
    }
    formError.value =
      errorText(e) +
      (locked.value
        ? "。如网络中断，可用下方按钮查询本次提交；不会重复发送。"
        : "。请核对资料后重新提交。");
  } finally {
    busy.value = false;
  }
}
const retry = ref<Risk | null>(null),
  checked = ref(false),
  retryError = ref("");
function openRetry(row: Risk) {
  retry.value = row;
  checked.value = false;
  retryError.value = "";
}
async function resend() {
  if (!retry.value || busy.value) return;
  busy.value = true;
  retryError.value = "";
  try {
    const result = await props.context.http.post<Risk>(
      "/risk-reports/" + retry.value.id + "/retry",
      {
        ...query(),
        attempt: retry.value.attempt,
        checkedNotReceived: checked.value,
      },
    );
    notice.value =
      result.message || statuses[result.status] || "已读取提交结果";
    retry.value = null;
    await load();
  } catch (e) {
    retryError.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
function checkResult(row: Risk) {
  keyword.value = row.keyword;
  riskType.value = String(row.riskType);
  status.value = "";
  tab("outgoing");
}
const date = (value?: string) =>
  value
    ? new Date(value).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
      })
    : "—";
onMounted(() => {
  if (allowed.value) void load();
});
onUnmounted(() => {
  disposed = true;
  generation++;
  worksGeneration++;
  pictures.value.forEach((p) => URL.revokeObjectURL(p.url));
});
</script>
<template>
  <section class="risk-reports" aria-label="风险举报管理">
    <p v-if="!allowed" role="alert">风险举报仅向运营岗位管理员和开发者开放。</p>
    <template v-else>
      <header class="risk-heading">
        <div>
          <button
            :disabled="busy"
            @click="form ? (form = false) : emit('back')"
          >
            ← {{ form ? "返回举报记录" : "返回作品管理" }}
          </button>
          <h2>{{ form ? "提交风险举报" : "风险举报" }}</h2>
          <p>
            {{
              form
                ? "选择相关作品并提供截图，交由知乎核实。"
                : "查看知乎审核结果，跟进截流词和搬运词举报。"
            }}
          </p>
        </div>
        <button v-if="!form" class="primary" @click="start">提交举报</button>
      </header>
      <p v-if="notice" class="risk-notice" role="status">{{ notice }}</p>
      <template v-if="!form">
        <nav class="risk-tabs" aria-label="举报记录分类">
          <button
            v-for="t in [
              { key: 'outgoing', name: '我方举报' },
              { key: 'incoming', name: '我方被举报' },
              { key: 'history', name: '本地提交记录' },
            ] as const"
            :key="t.key"
            :aria-pressed="view === t.key"
            :class="{ active: view === t.key }"
            @click="tab(t.key)"
          >
            {{ t.name }}
          </button>
        </nav>
        <form
          v-if="view !== 'history'"
          class="risk-filters"
          @submit.prevent="
            page = 1;
            load();
          "
        >
          <label
            >风险词<input
              v-model="keyword"
              type="search"
              maxlength="128"
              placeholder="输入风险词" /></label
          ><label
            >风险类型<select v-model="riskType">
              <option value="">全部类型</option>
              <option value="1">截流词</option>
              <option value="2">搬运词</option>
            </select></label
          ><label
            >判定状态<select v-model="status">
              <option value="">全部状态</option>
              <option value="1">审核中</option>
              <option value="2">判定违规</option>
              <option value="3">判定正常</option>
            </select></label
          ><button :disabled="loading">查询</button>
        </form>
        <div v-else class="risk-actions">
          <p>提交成功后，可在“我方举报”中查询知乎判定结果。</p>
          <button :disabled="loading" @click="load">刷新记录</button>
        </div>
        <p v-if="loading" role="status">正在读取举报记录…</p>
        <div v-if="error" class="risk-error" role="alert">
          {{ error }} <button @click="load">重新查询</button>
        </div>
        <div v-if="!error && !loading && !list.length" class="risk-empty">
          <p>
            {{
              view === "history"
                ? "还没有从本平台提交的举报。"
                : "当前条件下没有举报记录，可调整筛选后查询。"
            }}
          </p>
          <button v-if="view === 'history'" @click="start">填写举报资料</button
          ><button
            v-else
            @click="
              keyword = '';
              riskType = '';
              status = '';
              page = 1;
              load();
            "
          >
            清空筛选并查询
          </button>
        </div>
        <div v-else-if="!error" class="risk-table">
          <table>
            <thead>
              <tr>
                <th>风险词</th>
                <th>类型</th>
                <th>状态</th>
                <th>{{ view === "history" ? "提交时间" : "渠道" }}</th>
                <th>{{ view === "history" ? "下一步" : "违规生效时间" }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in list" :key="row.id || i">
                <td data-label="风险词">
                  <strong>{{ row.keyword }}</strong>
                </td>
                <td data-label="类型">
                  {{ row.riskType === 1 ? "截流词" : "搬运词" }}
                </td>
                <td data-label="状态">
                  <span class="risk-badge" :class="row.status">{{
                    statuses[row.status] || "未知状态"
                  }}</span>
                  <p v-if="row.message" class="risk-note">{{ row.message }}</p>
                </td>
                <td :data-label="view === 'history' ? '提交时间' : '渠道'">
                  {{
                    view === "history"
                      ? date(row.createdAt)
                      : row.channel || "—"
                  }}
                  <p v-if="row.createChannel" class="risk-note">
                    创建渠道：{{ row.createChannel }}
                  </p>
                </td>
                <td
                  :data-label="view === 'history' ? '下一步' : '违规生效时间'"
                >
                  <template v-if="view === 'history'"
                    ><button
                      v-if="!['failed', 'unknown'].includes(row.status)"
                      @click="checkResult(row)"
                    >
                      查询知乎结果</button
                    ><button
                      v-if="['failed', 'unknown'].includes(row.status)"
                      @click="openRetry(row)"
                    >
                      核对后重试
                    </button></template
                  ><template v-else>{{ row.validedAt || "—" }}</template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="risk-pager">
          <button
            :disabled="loading || page === 1"
            @click="
              page--;
              load();
            "
          >
            上一页</button
          ><span>第 {{ page }} 页</span
          ><button
            :disabled="loading || !hasNext"
            @click="
              page++;
              load();
            "
          >
            下一页
          </button>
        </div>
      </template>
      <form v-else class="risk-compose" @submit.prevent="submit">
        <fieldset :disabled="busy || locked">
          <legend>相关作品</legend>
          <div class="risk-actions">
            <label
              >查找作品<input
                v-model="workSearch"
                maxlength="128"
                placeholder="关键词、作品名或提交人"
                @keydown.enter.prevent="findWorks()" /></label
            ><button type="button" @click="findWorks()">搜索作品</button>
          </div>
          <p v-if="selected" class="risk-notice">
            已选择：{{ selected.keyword }} ·
            {{ selected.title || selected.executorName }}
            <a
              :href="selected.workUrl"
              target="_blank"
              rel="noopener noreferrer"
              >查看作品</a
            >
          </p>
          <p v-if="workLoading">正在查找作品…</p>
          <p v-if="workError" class="risk-error" role="alert">
            {{ workError }}
            <button type="button" @click="findWorks()">重试</button>
          </p>
          <div
            v-if="!workLoading && !workError && !works.length"
            class="risk-empty"
          >
            没有找到已成功提交知乎的作品。可调整搜索词，或返回作品管理完成作品提交。
          </div>
          <div class="risk-work-list">
            <label v-for="w in works" :key="w.id" class="risk-work"
              ><input
                type="radio"
                name="report-work"
                :checked="selected?.id === w.id"
                @change="choose(w)"
              /><span
                ><strong>{{ w.keyword }}</strong> · {{ w.title || "推广作品"
                }}<small>{{ w.executorName }}</small></span
              ></label
            >
          </div>
          <div class="risk-pager">
            <button
              type="button"
              :disabled="workPage === 1 || workLoading"
              @click="
                workPage--;
                findWorks(false);
              "
            >
              上一组作品</button
            ><span>第 {{ workPage }} 页</span
            ><button
              type="button"
              :disabled="!workNext || workLoading"
              @click="
                workPage++;
                findWorks(false);
              "
            >
              下一组作品
            </button>
          </div>
        </fieldset>
        <fieldset :disabled="busy || locked">
          <legend>举报内容</legend>
          <div class="risk-fields">
            <label
              >风险类型<select v-model="kind" aria-label="风险类型">
                <option :value="1">截流词</option>
                <option :value="2">搬运词</option>
              </select></label
            ><label
              >风险词<input
                v-model="riskWord"
                required
                maxlength="128"
                placeholder="填写要举报的关键词" /></label
            ><label
              >受损词（选填）<input v-model="damage" maxlength="128" /></label
            ><label class="risk-wide"
              >风险链接{{ kind === 2 ? "（必填）" : "（选填）"
              }}<input
                v-model="riskUrl"
                :aria-label="
                  kind === 2 ? '风险链接（必填）' : '风险链接（选填）'
                "
                type="url"
                :required="kind === 2"
                maxlength="2048"
                placeholder="https://"
            /></label>
          </div>
        </fieldset>
        <fieldset :disabled="busy || locked">
          <legend>举报截图</legend>
          <p>1–3 张 PNG 或 JPEG，每张不超过 2 MB。</p>
          <input
            aria-label="上传举报截图"
            type="file"
            accept="image/png,image/jpeg"
            multiple
            :disabled="pictures.length >= 3"
            @change="upload"
          />
          <ul class="risk-pictures">
            <li v-for="(p, i) in pictures" :key="p.id">
              <img :src="p.url" :alt="p.name" /><span>{{ p.name }}</span
              ><button type="button" @click="remove(i)">移除截图</button>
            </li>
          </ul>
        </fieldset>
        <p v-if="formError" class="risk-error" role="alert">{{ formError }}</p>
        <div class="risk-actions">
          <button class="primary" :disabled="busy">
            {{
              busy ? "正在处理…" : locked ? "查询本次提交结果" : "提交举报"
            }}</button
          ><button
            v-if="locked && !busy"
            type="button"
            @click="
              form = false;
              tab('history');
            "
          >
            查看提交记录</button
          ><button type="button" :disabled="busy" @click="form = false">
            返回记录
          </button>
        </div>
      </form>
      <DetailDrawer
        :open="!!retry"
        title="核对举报后重试"
        @close="!busy && (retry = null)"
        ><div class="risk-retry">
          <p>{{ retry?.keyword }}</p>
          <p>
            重新发送会再次向知乎提交举报。请先查询“我方举报”，避免重复提交。
          </p>
          <label
            ><input
              v-model="checked"
              type="checkbox"
              :disabled="busy"
            />我已核对知乎记录，确认本次举报未被接收。</label
          >
          <button
            type="button"
            :disabled="busy"
            @click="
              retry && checkResult(retry);
              retry = null;
            "
          >
            查看知乎举报结果
          </button>
          <p v-if="retryError" role="alert">{{ retryError }}</p>
          <button :disabled="busy || !checked" @click="resend">
            {{ busy ? "正在提交…" : "确认重新提交" }}
          </button>
        </div></DetailDrawer
      >
    </template>
  </section>
</template>
<style scoped>
.risk-reports {
  min-width: 0;
  display: grid;
  gap: 20px;
  color: var(--ink, #1b3035);
}
.risk-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.risk-heading h2 {
  font-size: 26px;
  margin: 18px 0 8px;
}
.risk-heading p,
.risk-note {
  color: var(--ink-soft, #637078);
}
.risk-reports button,
.risk-retry button {
  font: inherit;
  min-height: 44px;
  padding: 9px 15px;
  border: 1px solid var(--line, #dce3e5);
  border-radius: 8px;
  background: var(--paper, #fff);
  color: inherit;
  cursor: pointer;
}
.risk-reports button.primary,
.risk-tabs .active {
  background: var(--accent, #195e62);
  color: #fff;
  border-color: var(--accent, #195e62);
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.risk-tabs,
.risk-actions,
.risk-pager {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.risk-filters {
  display: flex;
  align-items: end;
  gap: 12px;
  flex-wrap: wrap;
}
.risk-reports label {
  display: grid;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
.risk-reports input,
.risk-reports select {
  box-sizing: border-box;
  min-width: 0;
  width: 100%;
  font: inherit;
  padding: 10px;
  border: 1px solid var(--line, #dce3e5);
  border-radius: 6px;
  background: var(--paper, #fff);
  color: inherit;
}
.risk-error {
  padding: 14px;
  color: #9c3434;
  background: #fff1ef;
  border-radius: 8px;
  overflow-wrap: anywhere;
}
.risk-notice,
.risk-empty {
  padding: 16px;
  background: #edf5f5;
  border-radius: 8px;
  overflow-wrap: anywhere;
}
.risk-table {
  min-width: 0;
}
.risk-table table {
  width: 100%;
  border-collapse: collapse;
  min-width: 0;
}
.risk-table td,
.risk-table th {
  text-align: left;
  padding: 14px 10px;
  border-bottom: 1px solid var(--line, #dce3e5);
  white-space: normal;
  overflow-wrap: anywhere;
}
.risk-table th {
  font-size: 13px;
  color: var(--ink-soft, #637078);
}
.risk-badge {
  display: inline-block;
  font-size: 13px;
  border-radius: 15px;
  padding: 4px 9px;
  background: #eef1f2;
  white-space: nowrap;
}
.risk-badge.violation,
.risk-badge.failed {
  background: #fbe4df;
  color: #963b35;
}
.risk-badge.reviewing,
.risk-badge.unknown,
.risk-badge.sending {
  background: #fff0d4;
  color: #86510e;
}
.risk-badge.normal,
.risk-badge.submitted {
  background: #e1f1e8;
  color: #246a49;
}
.risk-note {
  font-size: 13px;
  max-width: 300px;
  margin: 8px 0 0;
}
.risk-compose {
  display: grid !important;
  gap: 20px !important;
}
.risk-compose fieldset {
  min-width: 0;
  border: 1px solid var(--line, #dce3e5);
  padding: 18px;
  border-radius: 8px;
}
.risk-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.risk-wide {
  grid-column: 1/-1;
}
.risk-work-list {
  display: grid;
  gap: 8px;
  max-height: 300px;
  overflow: auto;
  margin: 16px 0;
}
.risk-reports .risk-work {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-direction: row;
  padding: 12px;
  background: var(--paper, #fff);
  border: 1px solid var(--line, #dce3e5);
  border-radius: 8px;
}
.risk-work span {
  overflow-wrap: anywhere;
  min-width: 0;
}
.risk-work small {
  display: block;
  margin-top: 5px;
}
.risk-work input {
  width: 18px;
  min-height: 18px;
  flex: none;
}
.risk-pictures {
  list-style: none;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.risk-pictures li {
  display: grid;
  gap: 8px;
  width: 150px;
  overflow-wrap: anywhere;
}
.risk-pictures img {
  width: 150px;
  height: 120px;
  object-fit: contain;
  background: #f1f3f4;
}
.risk-retry {
  display: grid;
  gap: 18px;
  overflow-wrap: anywhere;
}
.risk-retry label {
  display: flex;
  gap: 10px;
  align-items: start;
}
.risk-retry input {
  width: 18px;
  height: 18px;
  flex: none;
}
button:focus-visible,
input:focus-visible,
select:focus-visible {
  outline: 2px solid var(--accent, #195e62);
  outline-offset: 3px;
}
@media (max-width: 700px) {
  .risk-fields {
    grid-template-columns: minmax(0, 1fr);
  }
  .risk-filters label {
    flex-basis: 100%;
  }
  .risk-compose fieldset {
    padding: 12px;
  }
  .risk-table table,
  .risk-table tbody,
  .risk-table tr,
  .risk-table td {
    display: block;
  }
  .risk-table thead {
    display: none;
  }
  .risk-table tr {
    border-bottom: 1px solid var(--line, #dce3e5);
    padding: 12px 0;
  }
  .risk-table td {
    border: 0;
    padding: 6px 0;
  }
  .risk-table td::before {
    content: attr(data-label);
    display: block;
    font-size: 12px;
    color: var(--ink-soft, #637078);
    margin-bottom: 5px;
  }
  .risk-pictures li,
  .risk-pictures img {
    width: 120px;
  }
  .risk-tabs button {
    flex: 1;
  }
  .risk-heading {
    align-items: start;
  }
  .risk-pager {
    gap: 8px;
  }
  .risk-reports input,
  .risk-reports select {
    font-size: 16px;
  }
}
</style>
