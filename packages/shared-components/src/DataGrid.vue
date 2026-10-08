<script setup lang="ts">
import { computed, ref, watch } from "vue";
import DetailDrawer from "./DetailDrawer.vue";
import { gridViewRows, groupGridRows } from "./data-grid";
import type {
  DataGridColumn,
  DataGridRow,
  DataGridTotal,
  DataGridView,
} from "./data-grid";
const props = withDefaults(
  defineProps<{
    rows: DataGridRow[];
    columns: DataGridColumn[];
    views?: DataGridView[];
    modelValue?: string;
    title?: string;
    titleLabel?: string;
    searchPlaceholder?: string;
    groupOptions?: DataGridView[];
    totals?: (rows: DataGridRow[]) => DataGridTotal[];
    busy?: boolean;
    busyRowId?: string;
    emptyText?: string;
  }>(),
  {
    title: "明细",
    titleLabel: "内容",
    searchPlaceholder: "搜索内容或人员",
    emptyText: "当前条件下没有记录。",
    views: () => [{ key: "all", label: "全部" }],
    groupOptions: () => [{ key: "status", label: "按状态" }],
  },
);
const emit = defineEmits<{
  "update:modelValue": [key: string];
  action: [payload: { row: DataGridRow; key: string }];
  inspect: [row: DataGridRow];
}>();
const currentView = ref(props.modelValue ?? props.views[0]?.key ?? "all"),
  search = ref(""),
  groupBy = ref(props.groupOptions[0]?.key ?? "status"),
  selectedId = ref<string | null>(null);
watch(
  () => props.modelValue,
  (key) => {
    if (key) currentView.value = key;
  },
);
watch(
  () => props.views,
  (views) => {
    if (!views.some((v) => v.key === currentView.value))
      currentView.value = views[0]?.key ?? "all";
  },
);
watch(
  () => props.groupOptions,
  (options) => {
    if (!options.some((g) => g.key === groupBy.value))
      groupBy.value = options[0]?.key ?? "status";
  },
);
const filtered = computed(() =>
  gridViewRows(props.rows, currentView.value, search.value),
);
const groups = computed(() => groupGridRows(filtered.value, groupBy.value));
const visibleColumns = computed(() => props.columns.slice(0, 5));
const selected = computed(() =>
  props.rows.find((r) => r.id === selectedId.value),
);
const totals = computed(
  () =>
    props.totals?.(filtered.value) ?? [
      { label: "合计", value: filtered.value.length + " 条" },
    ],
);
watch(selected, (row) => {
  if (!row) selectedId.value = null;
});
function choose(key: string) {
  currentView.value = key;
  emit("update:modelValue", key);
}
function inspect(row: DataGridRow) {
  selectedId.value = row.id;
  emit("inspect", row);
}
function keyboard(event: KeyboardEvent, row: DataGridRow) {
  if (
    event.target === event.currentTarget &&
    (event.key === "Enter" || event.key === " ")
  ) {
    event.preventDefault();
    inspect(row);
  }
}
function text(row: DataGridRow, column: DataGridColumn) {
  return row.cells[column.key] ?? "—";
}
</script>
<template>
  <section class="data-grid" :aria-label="title" :aria-busy="busy">
    <header class="grid-toolbar">
      <div class="grid-views" role="group" aria-label="查看范围">
        <button
          v-for="view in views"
          :key="view.key"
          type="button"
          :class="{ active: currentView === view.key }"
          :aria-pressed="currentView === view.key"
          @click="choose(view.key)"
        >
          {{ view.label }}
          <span class="view-count">{{
            gridViewRows(rows, view.key).length
          }}</span>
        </button>
      </div>
      <div class="grid-filters">
        <label class="grid-search"
          ><span class="sr-only">{{ searchPlaceholder }}</span
          ><input
            v-model="search"
            type="search"
            :placeholder="searchPlaceholder" /></label
        ><label v-if="groupOptions.length > 1"
          ><span class="sr-only">分组方式</span
          ><select v-model="groupBy">
            <option
              v-for="option in groupOptions"
              :key="option.key"
              :value="option.key"
            >
              {{ option.label }}
            </option>
          </select></label
        ><slot name="filters" />
      </div>
    </header>
    <p v-if="busy" class="grid-notice" role="status">正在更新记录…</p>
    <div v-if="!filtered.length" class="grid-empty">
      <p>{{ emptyText }}</p>
      <button v-if="search" type="button" @click="search = ''">清除搜索</button
      ><slot name="empty" />
    </div>
    <template v-else>
      <table class="desktop-table">
        <caption class="sr-only">
          {{
            title
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col" class="title-col">{{ titleLabel }}</th>
            <th
              v-for="column in visibleColumns"
              :key="column.key"
              scope="col"
              :class="{ numeric: column.numeric }"
            >
              {{ column.label }}
            </th>
            <th scope="col">状态</th>
            <th scope="col" class="next-col">下一步</th>
          </tr>
        </thead>
        <tbody v-for="group in groups" :key="group.key">
          <tr class="group-heading">
            <th :colspan="visibleColumns.length + 3" scope="rowgroup">
              <span :class="['status-tag', group.tone]">{{ group.label }}</span
              ><span>{{ group.rows.length }} 条</span
              ><small v-if="group.description">{{ group.description }}</small>
            </th>
          </tr>
          <tr
            v-for="row in group.rows"
            :key="row.id"
            class="grid-row"
            tabindex="0"
            :aria-label="'查看' + row.title + '详情'"
            @click="inspect(row)"
            @keydown="keyboard($event, row)"
          >
            <th scope="row">
              <button
                type="button"
                class="row-title"
                @click.stop="inspect(row)"
              >
                {{ row.title }}
              </button>
            </th>
            <td
              v-for="column in visibleColumns"
              :key="column.key"
              :class="{ numeric: column.numeric }"
            >
              <slot
                name="cell"
                :row="row"
                :column="column"
                :value="text(row, column)"
                >{{ text(row, column) }}</slot
              >
            </td>
            <td>
              <span :class="['status-tag', row.status.tone]">{{
                row.status.label
              }}</span>
            </td>
            <td class="next-cell">
              <template v-if="row.next"
                ><p>
                  <strong>{{ row.next.actor }}：</strong>{{ row.next.text }}
                </p>
                <button
                  v-if="row.next.action"
                  type="button"
                  :disabled="row.next.action.disabled || busyRowId === row.id"
                  @click.stop="
                    emit('action', { row, key: row.next.action!.key })
                  "
                >
                  {{ row.next.action.label }}
                </button></template
              ><span v-else>无需处理</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="mobile-groups">
        <section v-for="group in groups" :key="group.key" class="mobile-group">
          <header class="mobile-group-heading">
            <span :class="['status-tag', group.tone]">{{ group.label }}</span
            ><span>{{ group.rows.length }} 条</span>
            <p v-if="group.description">{{ group.description }}</p>
          </header>
          <article
            v-for="row in group.rows"
            :key="row.id"
            class="grid-card"
            tabindex="0"
            :aria-label="'查看' + row.title + '详情'"
            @click="inspect(row)"
            @keydown="keyboard($event, row)"
          >
            <header>
              <button
                type="button"
                class="row-title"
                @click.stop="inspect(row)"
              >
                {{ row.title }}</button
              ><span :class="['status-tag', row.status.tone]">{{
                row.status.label
              }}</span>
            </header>
            <dl>
              <div v-for="column in visibleColumns" :key="column.key">
                <dt>{{ column.label }}</dt>
                <dd :class="{ numeric: column.numeric }">
                  <slot
                    name="cell"
                    :row="row"
                    :column="column"
                    :value="text(row, column)"
                    >{{ text(row, column) }}</slot
                  >
                </dd>
              </div>
            </dl>
            <footer v-if="row.next">
              <p>
                <strong>{{ row.next.actor }}：</strong>{{ row.next.text }}
              </p>
              <button
                v-if="row.next.action"
                type="button"
                :disabled="row.next.action.disabled || busyRowId === row.id"
                @click.stop="emit('action', { row, key: row.next.action!.key })"
              >
                {{ row.next.action.label }}
              </button>
            </footer>
          </article>
        </section>
      </div>
    </template>
    <footer class="grid-totals" aria-live="polite">
      <slot name="totals" :rows="filtered" :totals="totals"
        ><div v-for="total in totals" :key="total.label">
          <span>{{ total.label }}</span
          ><strong>{{ total.value }}</strong>
        </div></slot
      >
    </footer>
    <DetailDrawer
      :open="Boolean(selected)"
      :title="selected?.title ?? '详情'"
      @close="selectedId = null"
      ><template v-if="selected"
        ><slot name="detail" :row="selected"
          ><span :class="['status-tag', selected.status.tone]">{{
            selected.status.label
          }}</span>
          <dl class="detail-fields">
            <div v-for="column in columns" :key="column.key">
              <dt>{{ column.label }}</dt>
              <dd>{{ text(selected, column) }}</dd>
            </div>
          </dl>
          <p v-if="selected.next">
            下一步：{{ selected.next.actor }}：{{ selected.next.text }}
          </p></slot
        ></template
      ></DetailDrawer
    >
  </section>
</template>
<style scoped>
.data-grid {
  min-width: 0;
  border: 1px solid var(--line, #dce3e5);
  border-radius: 12px;
  background: var(--paper, #fff);
  color: var(--ink, #243438);
  font-size: 14px;
  line-height: 1.5;
  overflow: hidden;
}
.data-grid * {
  box-sizing: border-box;
}
.grid-toolbar,
.grid-filters,
.grid-views {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}
.grid-toolbar {
  padding: 14px 16px;
  justify-content: space-between;
  border-bottom: 1px solid var(--line, #dce3e5);
}
button,
input,
select {
  font: inherit;
  color: inherit;
  min-height: 40px;
  border-radius: 7px;
  border: 1px solid var(--line, #ccd7d7);
  background: var(--paper, #fff);
  padding: 8px 12px;
}
button {
  cursor: pointer;
  overflow-wrap: anywhere;
}
button:disabled {
  opacity: 0.55;
  cursor: default;
}
button:focus-visible,
input:focus-visible,
select:focus-visible,
.grid-row:focus-visible,
.grid-card:focus-visible {
  outline: 3px solid #195e62;
  outline-offset: -3px;
}
.grid-views button {
  border-color: transparent;
  background: transparent;
  color: #536269;
}
.grid-views button.active {
  background: #e8f2f0;
  color: #164d51;
  font-weight: 600;
}
.view-count {
  display: inline-block;
  min-width: 22px;
  padding: 0 5px;
  border-radius: 5px;
  font-size: 12px;
  background: #ffffffa8;
  color: #4e6265;
  margin-left: 4px;
  font-variant-numeric: tabular-nums;
}
.grid-search {
  min-width: 0;
}
.grid-search input {
  width: 220px;
  max-width: 100%;
}
.desktop-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 13px;
}
.desktop-table th,
.desktop-table td {
  text-align: left;
  padding: 14px 12px;
  vertical-align: top;
  border-bottom: 1px solid var(--line, #e6ebeb);
  overflow-wrap: anywhere;
}
.desktop-table th.numeric,
.desktop-table td.numeric {
  text-align: right;
}
.desktop-table thead th {
  color: #637078;
  font-size: 12px;
  font-weight: 500;
  background: #f6f8f7;
}
.title-col {
  width: 21%;
}
.next-col {
  width: 21%;
}
.grid-row {
  cursor: pointer;
}
.grid-row:hover {
  background: #f6faf9;
}
.grid-row th {
  font-weight: 600;
}
.row-title {
  padding: 0;
  min-height: 24px;
  border: 0;
  background: none;
  text-align: left;
  line-height: 1.6;
  font-weight: 600;
  color: #195e62;
  max-width: 100%;
  overflow-wrap: anywhere;
}
.row-title:hover {
  text-decoration: underline;
}
.numeric {
  font-variant-numeric: tabular-nums;
}
.group-heading th {
  background: #f5f7f6;
  padding: 9px 12px;
  font-weight: 500;
}
.group-heading th > span {
  margin-right: 10px;
}
.group-heading small {
  color: #637078;
  font-size: 12px;
  font-weight: 400;
}
.status-tag {
  display: inline-block;
  border-radius: 5px;
  padding: 3px 8px;
  font-size: 12px;
  line-height: 1.5;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.success {
  background: #e5f2eb;
  color: #205c44;
}
.warning {
  background: #fff0d4;
  color: #815400;
}
.danger {
  background: #fcebe8;
  color: #a23327;
}
.neutral {
  background: #edf0f0;
  color: #55636a;
}
.leader {
  background: #eee8f7;
  color: #69439b;
}
.next-cell p,
.grid-card footer p {
  margin: 0 0 8px;
  line-height: 1.6;
}
.next-cell button,
.grid-card footer button {
  font-size: 13px;
  border-color: #b6cecb;
  color: #195e62;
  background: #f5faf8;
}
.next-cell > span {
  font-size: 12px;
  color: #637078;
}
.grid-totals {
  display: flex;
  justify-content: flex-end;
  align-items: baseline;
  gap: 12px 26px;
  flex-wrap: wrap;
  padding: 16px;
  background: #f6f8f7;
  border-top: 1px solid var(--line, #dce3e5);
}
.grid-totals > div {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.grid-totals span {
  color: #637078;
  font-size: 12px;
}
.grid-totals strong {
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.grid-notice {
  padding: 8px 16px;
  margin: 0;
  color: #637078;
  background: #f6faf9;
}
.grid-empty {
  text-align: center;
  padding: 36px 20px;
  color: #637078;
}
.grid-empty p {
  margin: 0 0 14px;
  overflow-wrap: anywhere;
}
.mobile-groups {
  display: none;
}
.detail-fields {
  display: grid;
  gap: 16px;
}
.detail-fields > div {
  display: grid;
  gap: 4px;
}
.detail-fields dt {
  color: #637078;
  font-size: 12px;
}
.detail-fields dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
@media (max-width: 760px) {
  .desktop-table {
    display: none;
  }
  .mobile-groups {
    display: block;
    padding: 0 14px 14px;
    background: #f6f8f7;
  }
  .mobile-group-heading {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
    padding: 18px 2px 10px;
    font-size: 12px;
    color: #637078;
  }
  .mobile-group-heading p {
    flex-basis: 100%;
    margin: 0;
    overflow-wrap: anywhere;
  }
  .grid-card {
    padding: 16px;
    background: var(--paper, #fff);
    border: 1px solid var(--line, #dce3e5);
    border-radius: 10px;
    margin: 0 0 10px;
    min-width: 0;
    cursor: pointer;
  }
  .grid-card:last-child {
    margin: 0;
  }
  .grid-card > header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .grid-card > header .row-title {
    font-size: 16px;
    min-height: 32px;
  }
  .grid-card > header .status-tag {
    flex: none;
    max-width: 45%;
  }
  .grid-card dl {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px 16px;
    margin: 16px 0;
  }
  .grid-card dl > div {
    min-width: 0;
  }
  .grid-card dt {
    font-size: 12px;
    color: #637078;
    margin-bottom: 3px;
  }
  .grid-card dd {
    margin: 0;
    overflow-wrap: anywhere;
    font-weight: 500;
  }
  .grid-card footer {
    padding-top: 12px;
    border-top: 1px solid var(--line, #e6ebeb);
    font-size: 13px;
  }
  .grid-card footer button {
    width: 100%;
    min-height: 44px;
  }
  .grid-toolbar {
    padding: 12px;
    gap: 12px;
  }
  .grid-filters {
    width: 100%;
  }
  .grid-search {
    flex: 1;
    min-width: 140px;
  }
  .grid-search input {
    width: 100%;
    font-size: 16px;
  }
  .grid-filters select {
    max-width: 100%;
    font-size: 16px;
  }
  .grid-views {
    width: 100%;
    gap: 4px;
  }
  .grid-views button {
    padding: 8px;
    min-height: 44px;
    font-size: 13px;
  }
  .grid-totals {
    justify-content: flex-start;
    padding: 16px;
    gap: 12px 20px;
  }
}
</style>
