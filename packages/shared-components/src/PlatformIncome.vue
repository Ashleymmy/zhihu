<script setup lang="ts">
import { computed, inject, nextTick, reactive, ref, watch, type Component } from "vue";
import type { CoreWorkspace } from "./core-workspace";
import DataGrid from "./DataGrid.vue";
import DetailDrawer from "./DetailDrawer.vue";
import CashWallet from "./CashWallet.vue";
import FinanceHistoryLinks from "./FinanceHistoryLinks.vue";
import {
  earningMoney as money,
  type EarningLine,
  type EarningView,
} from "./platform-earnings";
import type { DataGridRow } from "./data-grid";
const props = defineProps<{ initialProjectId?: string }>(),
  emit = defineEmits<{ navigate: [path: string] }>();
const w = inject<CoreWorkspace>("opc")!;
const earningPanels = inject<Record<string,Component>>("opc-earning-panels", {});
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
}).format(new Date());
const filter = reactive({
  from: today.slice(0, 8) + "01",
  to: today,
  projectId: props.initialProjectId ?? "",
  metricType: "",
  search: "",
  group: "all",
  page: 1,
});
const view = ref<EarningView | null>(null),
  busy = ref(false),
  error = ref(""),
  selected = ref<EarningLine | null>(null),
  details = ref<HTMLElement | null>(null);
const metricOptions = ref<{ code: string; label: string }[]>([]),
  walletKey = ref("");
const history = ref<
    { amount: string; targetAmount: string; confirmedAt: string }[]
  >([]),
  historyPage = ref(1),
  historyTotal = ref(0),
  historyBusy = ref(false),
  historyError = ref("");
let generation = 0,
  historyGeneration = 0;
const projects = computed(() => [
  ...new Map(
    view.value?.scopes.map((s) => [
      s.projectId,
      { id: s.projectId, name: s.projectName },
    ]) ?? [],
  ).values(),
]);
const wallets = computed(
  () =>
    view.value?.scopes.filter(
      (s) => !filter.projectId || s.projectId === filter.projectId,
    ) ?? [],
);
const wallet = computed(() =>
  wallets.value.find(
    (s) => s.projectId + ":" + s.accountId === walletKey.value,
  ),
);
async function load(reset = false) {
  if (reset) filter.page = 1;
  const current = ++generation;
  busy.value = true;
  error.value = "";
  try {
    const data = await w.http.get<EarningView>("/earnings/mine", {
      from: filter.from,
      to: filter.to,
      page: filter.page,
      pageSize: 25,
      ...(filter.projectId ? { projectId: filter.projectId } : {}),
      ...(filter.metricType ? { metricType: filter.metricType } : {}),
      ...(filter.group !== "all" ? { group: filter.group } : {}),
      ...(filter.search ? { search: filter.search } : {}),
    });
    if (current !== generation) return;
    view.value = data;
    for (const g of data.groups)
      if (!metricOptions.value.some((m) => m.code === g.metricType))
        metricOptions.value.push({ code: g.metricType, label: g.metricLabel });
    if (
      !wallets.value.some(
        (s) => s.projectId + ":" + s.accountId === walletKey.value,
      )
    )
      walletKey.value = wallets.value[0]
        ? wallets.value[0].projectId + ":" + wallets.value[0].accountId
        : "";
  } catch {
    if (current === generation) error.value = "收益暂时没加载出来，请重试。";
  } finally {
    if (current === generation) busy.value = false;
  }
}
watch(
  () => props.initialProjectId,
  (value) => {
    filter.projectId = value ?? "";
    void load(true);
  },
  { immediate: true },
);
function group(key: string) {
  filter.group = key;
  void load(true);
}
async function focusDetails() {
  await nextTick();
  details.value?.scrollIntoView({ behavior: "smooth", block: "start" });
  details.value?.focus({ preventScroll: true });
}
async function chooseProject(id: string) {
  filter.projectId = id;
  filter.metricType = "";
  await load(true);
  await focusDetails();
}
function task(line: EarningLine) {
  selected.value = null;
  emit(
    "navigate",
    "/tasks?" +
      new URLSearchParams({
        projectId: line.projectId,
        moduleId: line.moduleId,
        accountId: line.accountId,
        taskId: line.taskId,
      }).toString(),
  );
}
const rows = computed<DataGridRow[]>(
  () =>
    view.value?.list.map((l) => {
      const blocked = !l.isReady && !l.isInternal,
        done = !!l.confirmedAt && !blocked;
      const actor = l.nextAction.split("：");
      return {
        id: l.id,
        title: l.taskName,
        status: {
          key: blocked ? "checking" : done ? "confirmed" : "pending",
          label: blocked ? "平台核对中" : done ? "已确认" : "待确认",
          tone: blocked ? "warning" : done ? "success" : "neutral",
        },
        cells: {
          date: l.businessDate,
          metric:
            l.metricLabel + " " + (l.quantity ?? "待核对") + l.quantityUnit,
          person: l.earningGroup === "team" ? l.performerName : "我的作品",
          project: l.projectName,
          amount: money(l.amount),
          pending: money(l.pendingAmount),
        },
        next: done
          ? undefined
          : {
              actor: actor.length > 1 ? actor[0]! : "财务",
              text:
                actor.length > 1 ? actor.slice(1).join("：") : "核对并确认金额",
              action: { key: "task", label: "查看任务" },
            },
        viewKeys: [l.earningGroup],
      };
    }) ?? [],
);
const item = (row: DataGridRow) =>
  view.value!.list.find((l) => l.id === row.id)!;
async function loadHistory() {
  if (!selected.value) return;
  const id = selected.value.id,
    current = ++historyGeneration;
  historyBusy.value = true;
  historyError.value = "";
  try {
    const result = await w.http.get<{
      list: typeof history.value;
      total: number;
    }>("/earnings/" + id + "/history", { page: historyPage.value });
    if (current === historyGeneration && selected.value?.id === id) {
      history.value = result.list;
      historyTotal.value = result.total;
    }
  } catch {
    if (current === historyGeneration)
      historyError.value = "确认记录暂时没加载出来，请重试。";
  } finally {
    if (current === historyGeneration) historyBusy.value = false;
  }
}
function inspect(row: DataGridRow) {
  selected.value = item(row);
  history.value = [];
  historyTotal.value = 0;
  historyPage.value = 1;
  void loadHistory();
}
function close() {
  selected.value = null;
  ++historyGeneration;
  historyBusy.value = false;
}
</script>
<template>
  <section class="platform-income page-stack" :aria-busy="busy">
    <header class="page-header">
      <div>
        <h1>我的收益</h1>
        <p>查看各项目的业绩、收益和收款进度。</p>
      </div>
    </header>
    <div v-if="error" class="income-error" role="alert">
      <span>{{ error }}</span
      ><button :disabled="busy" @click="load()">重新加载</button>
    </div>
    <form class="income-filter" @submit.prevent="load(true)">
      <label
        >项目<select
          v-model="filter.projectId"
          @change="
            filter.metricType = '';
            load(true);
          "
        >
          <option value="">全部项目</option>
          <option v-for="p in projects" :key="p.id" :value="p.id">
            {{ p.name }}
          </option>
        </select></label
      >
      <label>开始日期<input v-model="filter.from" type="date" required /></label
      ><label
        >结束日期<input
          v-model="filter.to"
          type="date"
          required
          :min="filter.from"
      /></label>
      <label
        >业绩类型<select v-model="filter.metricType" @change="load(true)">
          <option value="">全部类型</option>
          <option v-for="m in metricOptions" :key="m.code" :value="m.code">
            {{ m.label }}
          </option>
        </select></label
      >
      <label class="income-search"
        >任务或人员<input
          v-model="filter.search"
          placeholder="查找任务或人员"
          type="search" /></label
      ><button :disabled="busy">查看收益</button>
    </form>
    <template v-if="view">
      <div class="income-totals">
        <button @click="focusDetails">
          <span>本期收益</span
          ><strong>{{ money(view.summary.amount) }}</strong></button
        ><button @click="focusDetails">
          <span>已确认收入</span
          ><strong>{{ money(view.summary.confirmedAmount) }}</strong></button
        ><button @click="focusDetails">
          <span>待确认收入</span
          ><strong>{{ money(view.summary.pendingAmount) }}</strong>
        </button>
      </div>
      <p v-if="view.summary.pendingCalculations" class="income-notice">
        还有
        {{ view.summary.pendingCalculations }}
        条业绩在核对，计算完成后会自动显示金额。
      </p>
      <div v-if="view.groups.length" class="income-projects">
        <button
          v-for="g in view.groups"
          :key="g.projectId + g.metricType"
          @click="chooseProject(g.projectId)"
        >
          <span>{{ g.projectName }} · {{ g.metricLabel }}</span
          ><strong>{{ money(g.amount) }}</strong
          ><span
            >{{ g.quantity }}{{ g.quantityUnit }} · 已确认
            {{ money(g.confirmedAmount) }}</span
          >
        </button>
      </div>
      <section ref="details" tabindex="-1" class="income-details">
        <h2>
          {{ w.role.value === "leader" ? "团队业绩与分成" : "我的收入明细" }}
        </h2>
        <DataGrid
          :rows="rows"
          title="我的收入明细"
          title-label="任务"
          :busy="busy"
          :hide-search="true"
          :external-details="true"
          :columns="[
            { key: 'date', label: '日期' },
            { key: 'metric', label: '业绩' },
            { key: 'person', label: '来源' },
            { key: 'amount', label: '本人收益', numeric: true },
            { key: 'pending', label: '待确认', numeric: true },
          ]"
          :views="
            w.role.value === 'leader'
              ? [
                  { key: 'all', label: '全部' },
                  { key: 'self', label: '我的作品' },
                  { key: 'team', label: '团队分成' },
                ]
              : [{ key: 'all', label: '全部' }]
          "
          :model-value="filter.group"
          @update:model-value="group"
          :group-options="[
            { key: 'status', label: '按进度' },
            { key: 'project', label: '按项目' },
            { key: 'person', label: '按人员' },
          ]"
          :totals="(r) => [{ label: '当前页', value: r.length + ' 条' }]"
          empty-text="这段时间还没有收益。完成任务后，项目报表会自动更新这里。"
          @inspect="inspect"
          @action="task(item($event.row))"
        />
        <div v-if="view.total > 25" class="income-paging">
          <button
            :disabled="busy || filter.page === 1"
            @click="
              filter.page--;
              load();
            "
          >
            上一页</button
          ><span>第 {{ filter.page }} 页 · 共 {{ view.total }} 条</span
          ><button
            :disabled="busy || filter.page * 25 >= view.total"
            @click="
              filter.page++;
              load();
            "
          >
            下一页
          </button>
        </div>
        <router-link v-if="!view.total" to="/task-hall">去任务大厅</router-link>
      </section>
      <section v-if="wallets.length" class="income-wallet">
        <label v-if="wallets.length > 1"
          >收款项目<select v-model="walletKey">
            <option
              v-for="s in wallets"
              :key="s.projectId + ':' + s.accountId"
              :value="s.projectId + ':' + s.accountId"
            >
              {{ s.projectName }}
            </option>
          </select></label
        ><CashWallet
          v-if="wallet"
          :key="walletKey"
          :http="w.http"
          :scope="wallet"
        />
      </section>
      <div v-else class="income-empty">
        <h2>暂无项目</h2>
        <p>加入项目并完成任务后，这里会自动显示收益。</p>
        <router-link to="/task-hall">查看任务大厅</router-link>
      </div>
      <component v-if="wallet&&['leader','creator'].includes(w.role.value)&&earningPanels[wallet.moduleId]" :is="earningPanels[wallet.moduleId]" :key="walletKey" :scope="wallet"/>
      <FinanceHistoryLinks />
    </template>
    <DetailDrawer
      :open="!!selected"
      :title="selected?.taskName ?? '收益明细'"
      @close="close"
    >
      <template v-if="selected"
        ><p>
          {{ selected.projectName }} · {{ selected.businessDate }} ·
          {{ selected.metricLabel }}
        </p>
        <p>
          {{
            selected.earningGroup === "team"
              ? "团队分成 · " + selected.performerName
              : "我的作品"
          }}
        </p>
        <div class="income-calculation">
          <span>本人收益</span><strong>{{ money(selected.amount) }}</strong>
          <p v-if="selected.unitPrice !== null">
            {{ selected.quantity }}{{ selected.quantityUnit }} × ¥{{
              selected.unitPrice
            }}
            = {{ money(selected.calculationAmount) }}
          </p>
          <p v-else>单价尚在核对，完成后自动更新。</p>
        </div>
        <p>
          已确认 {{ money(selected.confirmedAmount) }} · 待确认
          {{ money(selected.pendingAmount) }}
        </p>
        <p v-if="selected.reason">{{ selected.reason }}</p>
        <p v-if="selected.nextAction && !selected.confirmedAt">
          下一步：{{ selected.nextAction }}
        </p>
        <button @click="task(selected)">查看任务与作品</button>
        <component v-if="['leader','creator'].includes(w.role.value)&&earningPanels[selected.moduleId]" :is="earningPanels[selected.moduleId]" :key="selected.id" :scope="selected" :earning-line-id="selected.id"/>
        <h3>确认与更正记录</h3>
        <p v-if="historyBusy" role="status">正在读取记录…</p>
        <div v-if="historyError" role="alert">
          <p>{{ historyError }}</p>
          <button @click="loadHistory">重新加载</button>
        </div>
        <ul class="income-history">
          <li v-for="(entry, i) in history" :key="i">
            <span>{{ entry.confirmedAt.slice(0, 10) }}</span
            ><strong>{{ money(entry.amount) }}</strong
            ><span>确认后合计 {{ money(entry.targetAmount) }}</span>
          </li>
        </ul>
        <p v-if="!history.length && !historyBusy && !historyError">
          还没有确认记录，财务核对后会更新。
        </p>
        <div v-if="historyTotal > 25" class="income-paging">
          <button
            :disabled="historyBusy || historyPage === 1"
            @click="
              historyPage--;
              loadHistory();
            "
          >
            上一页</button
          ><span>第 {{ historyPage }} 页</span
          ><button
            :disabled="historyBusy || historyPage * 25 >= historyTotal"
            @click="
              historyPage++;
              loadHistory();
            "
          >
            下一页
          </button>
        </div>
      </template>
    </DetailDrawer>
  </section>
</template>
<style scoped>
.platform-income {
  min-width: 0;
  grid-template-columns: minmax(0, 1fr);
}
.income-wallet {
  min-width: 0;
}
.platform-income button {
  min-height: 40px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--ink);
  background: var(--paper);
  cursor: pointer;
}
.platform-income button:disabled {
  opacity: 0.5;
  cursor: default;
}
.platform-income button:focus-visible {
  outline: 2px solid var(--forest-deep);
  outline-offset: 2px;
}
.income-filter > button {
  border-color: var(--forest-deep);
  color: var(--paper);
  background: var(--forest-deep);
}
.income-totals strong,
.income-projects strong,
.income-calculation strong {
  font-variant-numeric: tabular-nums;
}
.income-filter {
  display: flex;
  align-items: end;
  gap: 12px;
  flex-wrap: wrap;
}
.income-filter label,
.income-wallet > label {
  display: grid;
  gap: 6px;
  font-size: 13px;
}
.income-filter input,
.income-filter select,
.income-wallet select {
  min-height: 42px;
  max-width: 100%;
  box-sizing: border-box;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--paper);
}
.income-search {
  flex: 1;
  min-width: 170px;
}
.income-totals,
.income-projects {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
.income-totals button,
.income-projects button {
  display: grid;
  text-align: left;
  gap: 8px;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--paper);
  min-width: 0;
  overflow-wrap: anywhere;
}
.income-totals strong {
  font-size: 26px;
  font-weight: 650;
}
.income-totals span,
.income-projects span {
  color: var(--muted);
}
.income-projects strong {
  font-size: 20px;
}
.income-error,
.income-notice {
  padding: 16px;
  background: #fff5e5;
  border: 1px solid #e3c78b;
  border-radius: 8px;
}
.income-error,
.income-paging {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
}
.income-details {
  min-width: 0;
  scroll-margin-top: 16px;
}
.income-paging {
  margin: 16px 0;
  justify-content: space-between;
}
.income-details > a,
.income-empty a {
  display: inline-block;
  margin-top: 16px;
}
.income-calculation {
  padding: 18px;
  background: #edf5f3;
  border: 1px solid #c6dad4;
  border-radius: 8px;
  overflow-wrap: anywhere;
}
.income-calculation strong {
  display: block;
  font-size: 28px;
  margin-top: 8px;
}
.income-history {
  list-style: none;
  padding: 0;
}
.income-history li {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  padding: 14px 0;
  border-bottom: 1px solid var(--line);
}
.income-history li > span:last-child {
  grid-column: 1/-1;
  color: var(--muted);
}
.income-empty {
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 8px;
}
@media (max-width: 650px) {
  .income-totals,
  .income-projects {
    grid-template-columns: 1fr;
  }
  .income-totals button {
    grid-template-columns: 1fr auto;
    align-items: center;
  }
  .income-totals strong {
    font-size: 22px;
  }
  .income-filter {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: end;
  }
  .income-filter label {
    min-width: 0;
  }
  .income-filter label:first-child,
  .income-search {
    grid-column: 1/-1;
  }
  .income-filter input,
  .income-filter select {
    width: 100%;
    min-width: 0;
  }
  .income-wallet > label {
    margin-bottom: 16px;
  }
}
</style>
