<script setup lang="ts">
import {
  computed,
  inject,
  onMounted,
  reactive,
  ref,
  watch,
  type Component,
} from "vue";
import type { CoreWorkspace } from "./core-workspace";
import DataGrid from "./DataGrid.vue";
import CashWallet from "./CashWallet.vue";
import FinanceHistoryLinks from "./FinanceHistoryLinks.vue";
import { earningMoney as money, cashUnits } from "./platform-earnings";
import type { DataGridRow } from "./data-grid";
interface Scope {
  projectId: string;
  projectName: string;
  accountId: string;
  accountName: string;
  moduleId: string;
  available: boolean;
}
interface Entry {
  id: string;
  taskName: string;
  businessDate: string;
  payeeName: string;
  amount: string;
  metricLabel: string | null;
  quantityUnit: string | null;
  quantity: string | null;
  unitPrice: string | null;
  confirmedAt: string;
  reason: string;
}
const props = defineProps<{
  initialProjectId?: string;
  initialAccountId?: string;
  initialFrom?: string;
  initialTo?: string;
}>();
const w = inject<CoreWorkspace>("opc")!,
  panels = inject<Record<string, Component>>("opc-finance-panels", {});
const scopes = ref<Scope[]>([]),
  key = ref(""),
  loading = ref(false),
  error = ref(""),
  revision = ref(0);
const current = computed(() =>
  scopes.value.find((s) => s.projectId + ":" + s.accountId === key.value),
);
const panel = computed(() =>
  current.value ? panels[current.value.moduleId] : undefined,
);
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
}).format(new Date());
const period = reactive({
  from: props.initialFrom || today.slice(0, 8) + "01",
  to: props.initialTo || today,
});
const view = ref<{
    list: Entry[];
    total: number;
    amount: string;
    page: number;
  } | null>(null),
  page = ref(1),
  entriesBusy = ref(false),
  entryError = ref("");
let generation = 0;
async function load() {
  loading.value = true;
  error.value = "";
  try {
    scopes.value = await w.http.get<Scope[]>("/finance/workspace");
    if (
      !scopes.value.some((s) => s.projectId + ":" + s.accountId === key.value)
    ) {
      const initial =
        scopes.value.find(
          (s) =>
            s.projectId === props.initialProjectId &&
            (!props.initialAccountId || s.accountId === props.initialAccountId),
        ) ?? scopes.value[0];
      key.value = initial ? initial.projectId + ":" + initial.accountId : "";
    }
    revision.value++;
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : "财务资料暂时未加载，请重试。";
  } finally {
    loading.value = false;
  }
}
async function loadEntries() {
  const version = ++generation;
  view.value = null;
  entryError.value = "";
  if (!current.value?.available || panel.value) {
    entriesBusy.value = false;
    return;
  }
  entriesBusy.value = true;
  try {
    const s = current.value;
    const result = await w.http.get<typeof view.value>(
      "/finance/workspace/entries",
      {
        projectId: s.projectId,
        accountId: s.accountId,
        moduleId: s.moduleId,
        ...period,
        page: page.value,
      },
    );
    if (version === generation) view.value = result;
  } catch (e) {
    if (version === generation)
      entryError.value =
        e instanceof Error ? e.message : "账目暂时未加载，请重试。";
  } finally {
    if (version === generation) entriesBusy.value = false;
  }
}
watch([key, revision], () => {
  page.value = 1;
  void loadEntries();
});
onMounted(load);
function totals(filtered: DataGridRow[]) {
  const ids = new Set(filtered.map((row) => row.id));
  const sum = (view.value?.list ?? [])
    .filter((entry) => ids.has(entry.id))
    .reduce((amount, entry) => amount + cashUnits(entry.amount), 0n);
  const absolute = sum < 0n ? -sum : sum;
  const amount =
    (sum < 0n ? "-" : "") +
    absolute / 10000n +
    "." +
    String(absolute % 10000n).padStart(4, "0");
  return [
    { label: "本页筛选", value: filtered.length + " 条" },
    { label: "已确认", value: money(amount) },
  ];
}
const rows = computed<DataGridRow[]>(
  () =>
    view.value?.list.map((e) => ({
      id: e.id,
      title: e.taskName,
      status: {
        key: e.reason ? "blocked" : "confirmed",
        label: e.reason ? "已确认，后续待核对" : "已确认",
        tone: e.reason ? "warning" : "success",
        description: e.reason,
      },
      cells: {
        date: e.businessDate,
        payee: e.payeeName,
        type: e.metricLabel || "收益",
        quantity:
          e.quantity === null ? "—" : e.quantity + (e.quantityUnit || ""),
        price: e.unitPrice === null ? "—" : money(e.unitPrice),
        amount: money(e.amount),
        confirmed: new Date(e.confirmedAt).toLocaleString("zh-CN"),
      },
      next: {
        actor: "财务",
        text: e.reason
          ? "处理项目数据待办，原确认金额保留"
          : "核对到账和提现申请",
      },
    })) ?? [],
);
</script>
<template>
  <section class="page-stack public-finance" :aria-busy="loading">
    <header class="page-header">
      <div>
        <h1>财务</h1>
        <p>核对各项目账目，办理提现与付款。</p>
      </div>
      <div class="finance-controls">
        <label v-if="scopes.length"
          >项目<select v-model="key">
            <option
              v-for="s in scopes"
              :key="s.projectId + ':' + s.accountId"
              :value="s.projectId + ':' + s.accountId"
            >
              {{ s.projectName
              }}{{
                scopes.filter((x) => x.projectId === s.projectId).length > 1
                  ? " · " + s.accountName
                  : ""
              }}
            </option>
          </select></label
        ><button @click="load" :disabled="loading">刷新项目</button>
      </div>
    </header>
    <div v-if="error" role="alert">
      <p>{{ error }}</p>
      <button @click="load">重新加载</button>
    </div>
    <article v-else-if="!loading && !scopes.length" class="panel finance-empty">
      <h2>还没有可用项目</h2>
      <p>项目开通后，这里会显示账目和付款进度。</p>
      <router-link to="/projects">查看项目设置</router-link>
    </article>
    <template v-if="current">
      <div v-if="!current.available" class="panel finance-empty" role="alert">
        <p>这个项目暂时未加载，其他项目仍可处理。</p>
        <button @click="load">重新加载</button>
      </div>
      <component
        v-else-if="panel"
        :is="panel"
        :key="key + ':' + revision"
        :scope="current"
        :initial-from="period.from"
        :initial-to="period.to"
      />
      <template v-else>
        <form
          class="panel finance-period"
          @submit.prevent="
            page = 1;
            loadEntries();
          "
        >
          <label
            >开始日期<input type="date" v-model="period.from" required /></label
          ><label
            >结束日期<input type="date" v-model="period.to" required /></label
          ><button :disabled="entriesBusy">查看账目</button>
        </form>
        <div v-if="entryError" role="alert">
          <p>{{ entryError }}</p>
          <button @click="loadEntries">重新加载</button>
        </div>
        <h2>已确认收益</h2>
        <DataGrid
          :rows="rows"
          :busy="entriesBusy"
          :totals="totals"
          title="已确认收益"
          title-label="任务"
          :columns="[
            { key: 'date', label: '业务日期' },
            { key: 'payee', label: '收款人' },
            { key: 'type', label: '业绩类型' },
            { key: 'quantity', label: '数量' },
            { key: 'amount', label: '金额', numeric: true },
            { key: 'price', label: '单价', numeric: true },
            { key: 'confirmed', label: '确认时间' },
          ]"
          :group-options="[
            { key: 'status', label: '按状态' },
            { key: 'payee', label: '按收款人' },
          ]"
          empty-text="这段日期还没有确认账目。项目完成结算后会自动显示。"
        />
        <div v-if="view" class="finance-pagination">
          <span>共 {{ view.total }} 条 · 已确认 {{ money(view.amount) }}</span
          ><button
            :disabled="page === 1 || entriesBusy"
            @click="
              page--;
              loadEntries();
            "
          >
            上一页</button
          ><span>第 {{ page }} 页</span
          ><button
            :disabled="page * 25 >= view.total || entriesBusy"
            @click="
              page++;
              loadEntries();
            "
          >
            下一页
          </button>
        </div>
        <CashWallet
          :key="key + ':' + revision"
          :http="w.http"
          :scope="current"
        />
        <FinanceHistoryLinks />
      </template>
    </template>
  </section>
</template>
<style scoped>
.public-finance {
  min-width: 0;
}
.finance-controls,
.finance-period,
.finance-pagination {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: end;
}
.finance-controls label,
.finance-period label {
  display: grid;
  gap: 6px;
  font-size: 14px;
  min-width: 0;
}
.finance-period,
.finance-empty {
  padding: 22px;
}
.finance-controls select {
  max-width: 280px;
}
.public-finance button {
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  color: inherit;
  cursor: pointer;
}
.public-finance button:disabled {
  opacity: 0.5;
  cursor: default;
}
.finance-pagination {
  align-items: center;
  justify-content: flex-end;
}
.finance-pagination > span:first-child {
  margin-right: auto;
}
.finance-empty h2 {
  font-size: 20px;
}
.finance-empty p {
  color: var(--ink-soft);
}
@media (max-width: 600px) {
  .finance-controls {
    width: 100%;
  }
  .finance-controls label,
  .finance-period label {
    flex: 1 1 100%;
  }
  .finance-controls select,
  .finance-period input {
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
  }
  .finance-pagination > span:first-child {
    width: 100%;
  }
}
</style>
