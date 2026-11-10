<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
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
    viewCounts?: Record<string, number>;
    modelValue?: string;
    title?: string;
    titleLabel?: string;
    searchPlaceholder?: string;
    groupOptions?: DataGridView[];
    totals?: (rows: DataGridRow[]) => DataGridTotal[];
    busy?: boolean;
    busyRowId?: string;
    emptyText?: string;
    hideSearch?: boolean;
    externalDetails?: boolean;
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
  selectedId = ref<string | null>(null),
  activeId = ref<string | null>(null);
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
/* 详情面板里的「上一条 / 下一条」：按当前分组后的顺序移动，并把那一行滚到可见位置 */
const ordered = computed(() => groups.value.flatMap((group) => group.rows));
const position = computed(() => positionOf(selectedId.value));
const root = ref<HTMLElement | null>(null);
function step(delta: number) {
  const row = activeId.value ? neighbor(activeId.value, delta) : undefined;
  if (!row) return;
  inspect(row);
  void nextTick(() => root.value?.querySelector(`[data-row-id="${CSS.escape(row.id)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
}
function choose(key: string) {
  currentView.value = key;
  emit("update:modelValue", key);
}
function inspect(row: DataGridRow) {
  if (!props.externalDetails) selectedId.value = row.id;
  activeId.value = row.id;
  emit("inspect", row);
}
/** 外部详情面板用：查某一行在当前顺序里的位置、取相邻行（delta 为 -1 / 1） */
function positionOf(id: string | null | undefined) {
  const index = id ? ordered.value.findIndex((row) => row.id === id) : -1;
  return index < 0 ? undefined : { index, total: ordered.value.length };
}
function neighbor(id: string, delta: number) {
  const p = positionOf(id);
  return p ? ordered.value[p.index + delta] : undefined;
}
defineExpose({ inspect, positionOf, neighbor, step });
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
  <section ref="root" class="data-grid" :aria-label="title" :aria-busy="busy">
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
            viewCounts?.[view.key] ?? gridViewRows(rows, view.key).length
          }}</span>
        </button>
      </div>
      <div class="grid-filters">
        <label v-if="!hideSearch" class="grid-search"
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
            :class="{ selected: activeId === row.id }"
            :data-row-id="row.id"
            :aria-current="activeId === row.id ? 'true' : undefined"
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
                  <strong v-if="row.next.actor">{{ row.next.actor }}：</strong>{{ row.next.text }}
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
            :class="{ selected: activeId === row.id }"
            :aria-current="activeId === row.id ? 'true' : undefined"
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
                <strong v-if="row.next.actor">{{ row.next.actor }}：</strong>{{ row.next.text }}
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
      :position="position"
      @prev="step(-1)"
      @next="step(1)"
      @close="selectedId = null; activeId = null"
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
/* 多维表格：分段视图切换、行悬停与选中、状态胶囊、窄屏变卡片 */
.data-grid { display: grid; gap: 0; min-width: 0; overflow: clip; border: 1px solid rgba(232, 230, 220, 0.7); border-radius: 22px; background: var(--white, #fff); box-shadow: 0 1px 2px rgba(20, 20, 19, 0.03), 0 10px 30px -8px rgba(20, 20, 19, 0.08); }
.data-grid * { box-sizing: border-box; }
.grid-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 18px; border-bottom: 1px solid var(--line-soft, #f0eee6); }
select, button { font: inherit; }
button { cursor: pointer; }
button:disabled { opacity: 0.5; cursor: default; }
.grid-views { display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 3px; border-radius: 12px; background: var(--paper-deep, #f3f1ea); }
.grid-views button { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 12px; border: 0; border-radius: 9px; color: var(--ink-soft, #5e5d59); background: transparent; font-size: 13.5px; transition: background 0.2s, color 0.2s, box-shadow 0.2s; }
.grid-views button:hover { color: var(--ink, #141413); }
.grid-views button.active { color: var(--ink, #141413); background: var(--white, #fff); box-shadow: 0 1px 3px rgba(20, 20, 19, 0.1); font-weight: 600; }
.view-count { min-width: 20px; padding: 0 6px; border-radius: 999px; color: var(--muted, #87867f); background: rgba(20, 20, 19, 0.05); font-size: 11.5px; line-height: 18px; text-align: center; }
.grid-views button.active .view-count { color: var(--clay-deep, #b5532f); background: var(--clay-soft, #f6e5dc); }
.grid-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.grid-search input { width: 220px; min-height: 36px; padding: 0 12px; border: 1px solid var(--line, #e8e6dc); border-radius: 11px; background: var(--white, #fff); font: inherit; font-size: 13.5px; }
.grid-search input:focus-visible { outline: none; border-color: var(--clay, #d46b45); box-shadow: 0 0 0 3px var(--clay-soft, #f6e5dc); }
.grid-filters select { min-height: 36px; border-radius: 11px; }
.desktop-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.desktop-table thead th { position: sticky; top: 0; z-index: 1; padding: 10px 16px; border-bottom: 1px solid var(--line, #e8e6dc); color: var(--muted, #87867f); background: rgba(250, 249, 245, 0.96); font-size: 12px; font-weight: 600; text-align: left; white-space: nowrap; }
.desktop-table td { padding: 13px 16px; border-bottom: 1px solid var(--line-soft, #f0eee6); color: var(--ink-soft, #5e5d59); vertical-align: middle; }
.desktop-table td.numeric, .numeric { text-align: right; font-variant-numeric: tabular-nums; color: var(--ink, #141413); }
.title-col { min-width: 180px; }
.next-col { min-width: 220px; }
.grid-row { cursor: pointer; transition: background 0.15s; }
.grid-row:hover { background: var(--hover, #f5f3ec); }
.grid-row:focus-visible { outline: 2px solid var(--clay, #d46b45); outline-offset: -2px; }
.grid-row.selected { background: var(--clay-soft, #f6e5dc); }
.grid-row.selected th { box-shadow: inset 3px 0 0 var(--clay, #d46b45); }
.grid-row th { padding: 13px 16px; border-bottom: 1px solid var(--line-soft, #f0eee6); text-align: left; font-weight: 600; }
.row-title { padding: 0; border: 0; color: var(--ink, #141413); background: none; font-weight: 600; text-align: left; overflow-wrap: anywhere; }
.row-title:hover { color: var(--clay-deep, #b5532f); }
.group-heading th { padding: 14px 16px 8px; background: var(--white, #fff); text-align: left; font-weight: 500; }
.group-heading th > span { margin-right: 8px; color: var(--muted, #87867f); font-size: 12.5px; }
.group-heading small { color: var(--muted, #87867f); font-size: 12.5px; }
.status-tag { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 10px; border-radius: 999px; font-size: 12.5px; font-weight: 600; white-space: nowrap; }
.status-tag::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.success { color: var(--ok, #2f7d4f); background: var(--ok-bg, #e3efe5); }
.warning { color: var(--warn, #a86a12); background: var(--warn-bg, #f5ead3); }
.danger { color: var(--danger, #b4402e); background: var(--danger-bg, #f6e1dc); }
.neutral { color: var(--ink-soft, #5e5d59); background: var(--paper-deep, #f3f1ea); }
.leader { color: #2d63ae; background: #e3ecf8; }
.next-cell p { margin: 0 0 6px; color: var(--ink-soft, #5e5d59); font-size: 13px; line-height: 1.5; }
.next-cell strong { color: var(--ink, #141413); }
.next-cell button, .grid-card footer button { min-height: 32px; padding: 0 12px; border: 0; border-radius: 10px; color: var(--paper, #faf9f5); background: var(--ink, #141413); font-size: 13px; font-weight: 600; transition: background 0.2s, transform 0.36s var(--spring, ease); }
.next-cell button:hover, .grid-card footer button:hover { background: var(--ink-soft, #5e5d59); }
.next-cell button:active, .grid-card footer button:active { transform: scale(0.96); }
.next-cell > span { color: var(--muted, #87867f); font-size: 13px; }
.grid-totals { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px 26px; padding: 14px 18px; border-top: 1px solid var(--line, #e8e6dc); background: var(--paper, #faf9f5); }
.grid-totals > div { display: flex; align-items: baseline; gap: 8px; }
.grid-totals span { color: var(--muted, #87867f); font-size: 12.5px; }
.grid-totals strong { font-family: var(--font-display, serif); font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; }
.grid-notice { margin: 0; padding: 10px 18px; color: var(--ink-soft, #5e5d59); background: var(--paper, #faf9f5); font-size: 13px; }
.grid-empty { display: grid; justify-items: center; gap: 10px; padding: 40px 20px; color: var(--ink-soft, #5e5d59); text-align: center; }
.grid-empty p { margin: 0; }
.grid-empty button { min-height: 34px; padding: 0 14px; border: 1px solid var(--line, #e8e6dc); border-radius: 10px; background: var(--white, #fff); }
.mobile-groups { display: none; }
.detail-fields { display: grid; gap: 0; margin: 16px 0; }
.detail-fields > div { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line-soft, #f0eee6); }
.detail-fields dt { color: var(--muted, #87867f); font-size: 13px; }
.detail-fields dd { margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 760px) {
  .data-grid { border-radius: 20px; }
  .desktop-table { display: none; }
  .mobile-groups { display: grid; gap: 4px; padding: 6px 12px 12px; }
  .mobile-group-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 4px 6px; color: var(--muted, #87867f); font-size: 12.5px; }
  .mobile-group-heading p { width: 100%; margin: 0; }
  .grid-card { display: grid; gap: 10px; margin-bottom: 8px; padding: 14px; border-radius: 16px; background: var(--paper, #faf9f5); cursor: pointer; transition: background 0.2s, transform 0.36s var(--spring, ease); }
  .grid-card:active { transform: scale(0.985); }
  .grid-card.selected { background: var(--clay-soft, #f6e5dc); }
  .grid-card:focus-visible { outline: 2px solid var(--clay, #d46b45); outline-offset: 2px; }
  .grid-card:last-child { margin-bottom: 0; }
  .grid-card > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
  .grid-card > header .row-title { font-size: 14.5px; }
  .grid-card > header .status-tag { flex: none; }
  .grid-card dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px; margin: 0; }
  .grid-card dl > div { min-width: 0; }
  .grid-card dt { color: var(--muted, #87867f); font-size: 12px; }
  .grid-card dd { margin: 2px 0 0; overflow-wrap: anywhere; font-size: 14px; }
  .grid-card footer { display: grid; gap: 8px; padding-top: 10px; border-top: 1px solid var(--line, #e8e6dc); }
  .grid-card footer p { margin: 0; font-size: 13px; line-height: 1.5; }
  .grid-card footer button { width: 100%; min-height: 40px; }
  .grid-toolbar { padding: 12px; }
  .grid-filters { width: 100%; }
  .grid-search { flex: 1; min-width: 0; }
  .grid-search input { width: 100%; font-size: 16px; }
  .grid-filters select { flex: none; }
  .grid-views { width: 100%; overflow-x: auto; flex-wrap: nowrap; }
  .grid-views button { flex: none; }
  .grid-totals { justify-content: space-between; padding: 12px 14px; }
}
</style>
