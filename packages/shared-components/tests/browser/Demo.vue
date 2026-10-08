<script setup lang="ts">
import { ref } from "vue";
import AnalysisRun from "../../src/AnalysisRun.vue";
import DataGrid from "../../src/DataGrid.vue";
import type { AnalysisRunModel } from "../../src/analysis-run";
import type { DataGridRow } from "../../src/data-grid";
const answer = ref(""),
  action = ref(""),
  busyAsk = ref("");
const run = ref<AnalysisRunModel>({
  id: "demo",
  fileName: "九月推广业绩.xlsx",
  source: "文件上传",
  createdAt: "今天 10:30",
  status: "needs_input",
  progress: { done: 4, total: 5 },
  steps: [
    {
      key: "read",
      title: "读取文件",
      status: "done",
      summary: "已读取 3 条记录，共 12 个业绩。",
    },
    {
      key: "match",
      title: "找到对应内容",
      status: "ask",
      summary: "有 1 条记录的名称需要你确认。",
      asks: [
        {
          id: "ask-name",
          text: "“晴川”是否指“晴川渠道”？",
          options: [
            { key: "confirm", label: "是，使用这个名称", tone: "primary" },
            { key: "skip", label: "先跳过" },
          ],
        },
      ],
    },
    {
      key: "amount",
      title: "核对金额",
      status: "pending",
      summary: "已算出的记录可以继续处理，其余保留在待处理列表。",
    },
  ],
  conclusion: {
    title: "本次处理结果",
    value: "¥30.00",
    summary: "2 条记录已算出金额。",
    pendingText: "还有 1 条记录等运营补齐资料。",
    actions: [
      { key: "follow-up", label: "先处理待办", tone: "primary" },
      { key: "people", label: "按人员核对" },
    ],
  },
});
const rows = ref<DataGridRow[]>([
  {
    id: "ready",
    title: "春日来信",
    status: {
      key: "ready",
      label: "可确认",
      tone: "success",
      description: "资料齐全，可以核对金额。",
    },
    cells: {
      person: "小林",
      quantity: "3",
      amount: "¥24.00",
      source:
        "https://www.example.com/novel/a-very-long-source-address-that-must-wrap-without-scrolling",
    },
    viewKeys: ["ready"],
  },
  {
    id: "missing",
    title: "悬疑短篇",
    status: {
      key: "missing",
      label: "需要处理",
      tone: "danger",
      description: "补齐资料后会继续计算。",
    },
    cells: { person: "待指定", quantity: "4", amount: null, source: "—" },
    next: {
      actor: "运营",
      text: "指定执行人",
      action: { key: "assign", label: "指定执行人" },
    },
    viewKeys: ["needs_attention"],
  },
  {
    id: "waiting",
    title: "星河与你",
    status: {
      key: "waiting",
      label: "等待核对",
      tone: "warning",
      description: "等待负责人完成核对。",
    },
    cells: {
      person: "小林",
      quantity: "5",
      amount: "¥6.00",
      source: "https://example.com/work",
    },
    next: { actor: "财务", text: "核对来源金额" },
    viewKeys: ["needs_attention"],
  },
]);
const columns = [
  { key: "person", label: "执行人" },
  { key: "quantity", label: "数量", numeric: true },
  { key: "amount", label: "金额", numeric: true },
];
const totals = (items: DataGridRow[]) => {
  const cents = items.reduce(
    (sum, r) =>
      sum +
      (({ ready: 2400n, waiting: 600n } as Record<string, bigint>)[r.id] ?? 0n),
    0n,
  );
  return [
    { label: "记录", value: items.length + " 条" },
    {
      label: "数量",
      value: items
        .reduce((sum, r) => sum + BigInt(r.cells.quantity ?? 0), 0n)
        .toString(),
    },
    {
      label: "已算出金额",
      value:
        "¥" +
        (cents / 100n).toString() +
        "." +
        (cents % 100n).toString().padStart(2, "0"),
    },
  ];
};
async function decide(value: { askId: string; option: string }) {
  busyAsk.value = value.askId;
  answer.value = value.option;
  await new Promise((resolve) => setTimeout(resolve, 150));
  busyAsk.value = "";
}
</script>
<template>
  <main>
    <header class="page-header">
      <div>
        <p>共享组件 · 隔离演示数据</p>
        <h1>上传与核对</h1>
      </div>
      <span>处理结果会在同一页保留</span>
    </header>
    <div class="layout">
      <AnalysisRun
        :run="run"
        :busy-ask-id="busyAsk"
        @answer="decide"
        @action="action = $event"
      /><DataGrid
        :rows="rows"
        :columns="columns"
        :views="[
          { key: 'all', label: '全部' },
          { key: 'needs_attention', label: '需要跟进' },
          { key: 'ready', label: '可确认' },
        ]"
        :group-options="[
          { key: 'status', label: '按状态' },
          { key: 'person', label: '按人员' },
        ]"
        :totals="totals"
        title="业绩明细"
        title-label="内容"
        @action="action = $event.key"
        ><template #detail="{ row }"
          ><p class="detail-lead">{{ row.status.label }}</p>
          <dl>
            <div>
              <dt>执行人</dt>
              <dd>{{ row.cells.person }}</dd>
            </div>
            <div>
              <dt>计算过程</dt>
              <dd>
                {{
                  row.id === "ready"
                    ? "3 × ¥8.00 = ¥24.00"
                    : row.id === "waiting"
                      ? "5 × ¥1.20 = ¥6.00"
                      : "指定执行人后自动计算"
                }}
              </dd>
            </div>
            <div>
              <dt>来源</dt>
              <dd>{{ row.cells.source }}</dd>
            </div>
          </dl></template
        ></DataGrid
      >
    </div>
    <output class="test-result" data-testid="answer">{{ answer }}</output
    ><output class="test-result" data-testid="action">{{ action }}</output>
  </main>
</template>
<style>
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  background: #f5f5f2;
  color: #243438;
  font:
    14px/1.6 -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    "Microsoft YaHei",
    sans-serif;
}
main {
  max-width: 1440px;
  margin: auto;
  padding: 32px;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: end;
  margin-bottom: 24px;
  gap: 16px;
  flex-wrap: wrap;
}
.page-header p {
  margin: 0;
  color: #637078;
  font-size: 12px;
}
.page-header h1 {
  font-size: 26px;
  margin: 4px 0 0;
}
.page-header > span {
  color: #637078;
  font-size: 12px;
}
.layout {
  display: grid;
  grid-template-columns: minmax(300px, 370px) minmax(0, 1fr);
  gap: 22px;
  align-items: start;
}
dl {
  display: grid;
  gap: 20px;
}
dt {
  color: #637078;
  font-size: 12px;
}
dd {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
}
.detail-lead {
  margin: 0;
  font-weight: 600;
}
.test-result {
  position: fixed;
  left: -10000px;
}
@media (max-width: 1000px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
  main {
    padding: 20px;
  }
}
@media (max-width: 600px) {
  main {
    padding: 16px;
  }
  .page-header {
    margin-bottom: 18px;
  }
  .layout {
    gap: 18px;
  }
}
</style>
