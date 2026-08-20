<template>
  <div class="report-view">
    <div class="page-header">
      <h2>投放实时数据</h2>
      <el-button type="primary" :loading="reportStore.loading" @click="reportStore.fetchReport()">
        查询
      </el-button>
    </div>

    <!-- 数据说明（官方要求必须展示）-->
    <el-alert
      title="数据说明"
      type="warning"
      :closable="false"
      show-icon
      style="margin-bottom: 16px"
    >
      <ul style="margin: 6px 0 0; padding-left: 18px; line-height: 1.8">
        <li>数据每小时更新一次，延迟约 3–4 小时</li>
        <li><strong>仅供参考，不作为结算依据</strong></li>
        <li>仅返回当天搜索量超过阈值的部分关键词</li>
      </ul>
    </el-alert>

    <div v-if="reportStore.timeRange" style="margin-bottom: 12px; color: #606266; font-size: 13px">
      数据时间范围：{{ reportStore.timeRange }}
    </div>

    <el-table
      v-loading="reportStore.loading"
      :data="reportStore.data"
      border
      empty-text="暂无数据，点击「查询」加载"
    >
      <el-table-column prop="keyword" label="关键词" min-width="140" show-overflow-tooltip />
      <el-table-column prop="channel_name" label="渠道" min-width="120" show-overflow-tooltip />
      <el-table-column label="搜索量" width="100" align="right">
        <template #default="{ row }">{{ row.fields_data.search_num ?? '—' }}</template>
      </el-table-column>
      <el-table-column label="订单量" width="100" align="right">
        <template #default="{ row }">{{ row.fields_data.order_num ?? '—' }}</template>
      </el-table-column>
      <el-table-column label="创建时间" min-width="160">
        <template #default="{ row }">{{ row.fields_data.created_at ?? '—' }}</template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { useReportStore } from '@/stores/report.store'
const reportStore = useReportStore()
</script>

<style scoped>
.report-view { padding: 20px; }
.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.page-header h2 { margin: 0; }
</style>
