<template>
  <div class="z-page">
    <div class="pg-header">
      <div>
        <h1 class="pg-title">投放实时数据</h1>
        <p class="pg-sub">
          每小时更新，延迟约 3–4 小时，仅供参考，不作为结算依据
        </p>
      </div>
      <button
        class="btn-accent-sm"
        :disabled="store.loading"
        @click="store.fetchReport()"
      >
        {{ store.loading ? "加载中…" : "查询数据" }}
      </button>
    </div>

    <div class="alert-info">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      仅返回当天搜索量超过阈值的部分关键词
      <span
        v-if="store.timeRange"
        style="margin-left: 12px; color: var(--color-text-disabled)"
        >数据范围：{{ store.timeRange }}</span
      >
    </div>

    <a-alert
      v-if="store.error"
      :message="store.error"
      type="warning"
      show-icon
      style="margin-bottom: 16px"
    />

    <div class="table-card">
      <a-table
        :data-source="store.data"
        :columns="cols"
        :loading="store.loading"
        row-key="keyword"
        size="middle"
        :locale="{ emptyText: '暂无数据，点击「查询数据」加载' }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'searchNum'">{{
            record.fieldsData?.searchNum ?? "—"
          }}</template>
          <template v-if="column.key === 'orderNum'">{{
            record.fieldsData?.orderNum ?? "—"
          }}</template>
          <template v-if="column.key === 'createdAt'">{{
            record.fieldsData?.createdAt ?? "—"
          }}</template>
        </template>
      </a-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useZReportStore } from "@/stores/zReport.store";
const store = useZReportStore();
const cols = [
  { title: "关键词", dataIndex: "keyword", key: "keyword", width: 160 },
  { title: "渠道", dataIndex: "channelName", key: "channelName" },
  { title: "搜索量", key: "searchNum", width: 100, align: "right" as const },
  { title: "订单量", key: "orderNum", width: 100, align: "right" as const },
  { title: "创建时间", key: "createdAt", width: 180 },
];
</script>

<style scoped>
.z-page {
  padding-bottom: 16px;
}
.pg-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}
.pg-title {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin-bottom: 4px;
}
.pg-sub {
  font-size: 12.5px;
  color: var(--color-text-disabled);
}
.btn-accent-sm {
  padding: 8px 16px;
  background: var(--color-accent);
  border: none;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 600;
  color: white;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.btn-accent-sm:hover:not(:disabled) {
  background: var(--color-accent-hover);
  box-shadow: var(--shadow-glow);
}
.btn-accent-sm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.alert-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--color-info-bg);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: var(--radius-md);
  font-size: 12.5px;
  color: var(--color-info);
  margin-bottom: 16px;
}
.table-card {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
</style>
