<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type {
  DataImportBatch,
  DataImportBatchDetail,
  DataImportConfirmResult,
  DataImportPreview,
  DataImportPreviewRow,
  DataImportSourceType,
} from "@zhihu-koc/shared-contracts";
import { apis } from "../context";

const sourceType = ref<DataImportSourceType>("email_attachment");
const selectedFile = ref<File | null>(null);
const preview = ref<DataImportPreview | null>(null);
const batchDetail = ref<DataImportBatchDetail | null>(null);
const batches = ref<DataImportBatch[]>([]);
const loading = ref(false);
const parsing = ref(false);
const confirming = ref(false);
const rejecting = ref(false);
const detailLoading = ref(false);
const error = ref("");
const message = ref("");
const inputKey = ref(0);
const detailPage = ref(1);
const detailPageSize = 100;
const attribution = ref<DataImportConfirmResult["attribution"] | null>(null);

const hasErrors = computed(() => (preview.value?.errorRows ?? 0) > 0);
const canConfirm = computed(
  () => preview.value?.status === "preview" && (preview.value?.validRows ?? 0) > 0,
);
const detailTotalPages = computed(() =>
  Math.max(1, Math.ceil((batchDetail.value?.total ?? 0) / detailPageSize)),
);
const detailStart = computed(() =>
  batchDetail.value && batchDetail.value.total > 0
    ? (batchDetail.value.page - 1) * batchDetail.value.pageSize + 1
    : 0,
);
const detailEnd = computed(() =>
  batchDetail.value
    ? Math.min(batchDetail.value.page * batchDetail.value.pageSize, batchDetail.value.total)
    : 0,
);

const reportTypeLabels: Record<string, string> = {
  search: "搜索量报表",
  order: "订单报表",
  unknown: "待识别报表",
};
const batchStatusLabels: Record<string, string> = {
  preview: "待确认",
  confirmed: "已确认",
  rejected: "已驳回",
};
const batchStatusClasses: Record<string, string> = {
  preview: "draft",
  confirmed: "active",
  rejected: "ended",
};

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function formatRate(value: string | null) {
  return value == null ? "—" : `${(Number(value) * 100).toFixed(2)}%`;
}

function rowStatus(row: DataImportPreviewRow) {
  return row.validationStatus === "valid" ? "通过" : "有错误";
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  selectedFile.value = input.files?.[0] ?? null;
  preview.value = null;
  batchDetail.value = null;
  attribution.value = null;
  error.value = "";
  message.value = "";
}

async function loadBatches() {
  loading.value = true;
  error.value = "";
  try {
    batches.value = await apis.dataImport.listBatches();
  } catch (e: any) {
    message.value = "";
    error.value = e?.message ?? String(e);
  } finally {
    loading.value = false;
  }
}

async function parseFile() {
  error.value = "";
  message.value = "";
  batchDetail.value = null;
  if (!selectedFile.value) {
    error.value = "请先选择邮件附件或 Excel 文件";
    return;
  }
  parsing.value = true;
  try {
    preview.value = await apis.dataImport.parse(
      selectedFile.value,
      sourceType.value,
    );
    message.value = preview.value.isDuplicate
      ? "该报表已经导入过，系统未新建重复批次；下方展示的是原批次数据。"
      : preview.value.errorRows
        ? `解析完成，确认时将保存 ${preview.value.validRows} 行有效数据并跳过 ${preview.value.errorRows} 行错误数据。`
        : "解析完成，请核对预览内容后确认。";
    await loadBatches();
  } catch (e: any) {
    message.value = "";
    error.value = e?.message ?? String(e);
  } finally {
    parsing.value = false;
  }
}

async function confirmImport() {
  if (!preview.value || !canConfirm.value)
    return;
  const batchId = preview.value.id;
  if (
    !window.confirm(
      `确认后将保存 ${preview.value.validRows} 行有效数据，错误行会保留在暂存批次中但不会进入后续业务；本阶段不会计算归因或写入收益。继续吗？`,
    )
  )
    return;
  confirming.value = true;
  error.value = "";
  message.value = "";
  try {
    const result = await apis.dataImport.confirm(preview.value.id);
    preview.value = {
      ...preview.value,
      ...result,
    };
    message.value = result.taskIds.length
      ? `导入批次已确认，已保存 ${result.imported} 行有效数据并生成 ${result.taskIds.length} 条待处理归因任务；本阶段不执行归因计算。`
      : "导入批次已确认保存。";
    await loadBatches();
    await loadBatchDetail(batchId);
  } catch (e: any) {
    message.value = "";
    error.value = e?.message ?? String(e);
  } finally {
    confirming.value = false;
  }
}

async function rejectImport() {
  if (!preview.value || preview.value.status !== "preview") return;
  if (!window.confirm("驳回后该批次会保留在历史记录中，但不能继续确认。继续吗？")) return;
  rejecting.value = true;
  error.value = "";
  message.value = "";
  try {
    const reason = window.prompt("可填写驳回原因（选填）") ?? "";
    preview.value = {
      ...preview.value,
      ...(await apis.dataImport.reject(preview.value.id, reason)),
    };
    message.value = "导入批次已驳回，原始暂存数据已保留。";
    await loadBatches();
  } catch (e: any) {
    message.value = "";
    error.value = e?.message ?? String(e);
  } finally {
    rejecting.value = false;
  }
}

function clearSelection() {
  selectedFile.value = null;
  preview.value = null;
  batchDetail.value = null;
  attribution.value = null;
  inputKey.value += 1;
  error.value = "";
  message.value = "";
}

function sourceLabel(value: string) {
  return value === "email_attachment" ? "邮件附件" : "手动 Excel";
}

async function loadBatchDetail(id: string, page = 1) {
  detailLoading.value = true;
  error.value = "";
  try {
    batchDetail.value = await apis.dataImport.getBatch(id, {
      page,
      pageSize: detailPageSize,
    });
    detailPage.value = batchDetail.value.page;
  } catch (e: any) {
    message.value = "";
    error.value = `批次明细读取失败：${e?.message ?? String(e)}`;
  } finally {
    detailLoading.value = false;
  }
}

function closeBatchDetail() {
  batchDetail.value = null;
  detailPage.value = 1;
}

function changeDetailPage(page: number) {
  if (!batchDetail.value || page < 1 || page > detailTotalPages.value || page === detailPage.value) return;
  void loadBatchDetail(batchDetail.value.id, page);
}

function rawHeaderKey(headers: string[], index: number) {
  const header = headers[index] || `列${index + 1}`;
  const sameBefore = headers
    .slice(0, index)
    .filter((item, itemIndex) => (item || `列${itemIndex + 1}`) === header).length;
  return sameBefore ? `${header}#${sameBefore + 1}` : header;
}

function rawCell(row: DataImportPreviewRow, headers: string[], index: number) {
  const value = row.raw[rawHeaderKey(headers, index)];
  if (value === null || value === undefined || value === "") return "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

onMounted(loadBatches);
</script>

<template>
  <div class="page-stack">
    <header class="page-header">
      <div>
        <p class="section-index">01 / 数据导入</p>
        <h1>历史邮件 / Excel 导入</h1>
        <p>
          把邮件中的报表附件上传，系统自动识别报表类型、校验字段并提供人工确认。
        </p>
      </div>
      <button class="row-action" @click="loadBatches">刷新记录</button>
    </header>

    <div class="notice">
      此入口用于旧版报表导入及历史记录查询。独占关键词的报告请进入
      <router-link to="/modules/zhihu/keywords">归因与对账</router-link>
      中的“报告与归因”。
    </div>

    <div v-if="error" class="notice error-notice">{{ error }}</div>
    <div v-if="message" class="notice success-notice">{{ message }}</div>

    <section class="workspace-grid">
      <article class="panel import-panel">
        <div class="panel-heading">
          <div>
            <p class="section-index quiet">02 / 上传与解析</p>
            <h2 class="workspace-title">选择报表文件</h2>
          </div>
          <span class="limit-note">仅支持合法 .xlsx，最大 10 MB</span>
        </div>

        <div class="source-tabs" role="tablist" aria-label="文件来源">
          <button
            type="button"
            :class="sourceType === 'email_attachment' ? 'selected' : ''"
            @click="sourceType = 'email_attachment'"
          >
            邮件附件
          </button>
          <button
            type="button"
            :class="sourceType === 'manual_excel' ? 'selected' : ''"
            @click="sourceType = 'manual_excel'"
          >
            手动 Excel
          </button>
        </div>

        <label class="drop-zone">
          <input
            :key="inputKey"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            @change="onFileChange"
          />
          <strong>{{
            selectedFile ? selectedFile.name : "点击选择 .xlsx 文件"
          }}</strong>
          <span>{{
            selectedFile
              ? formatBytes(selectedFile.size)
              : sourceType === "email_attachment"
                ? "请先从邮件中下载报表附件"
                : "选择本地 Excel 报表"
          }}</span>
        </label>

        <div class="action-row">
          <button
            class="primary-action"
            :disabled="parsing || !selectedFile"
            @click="parseFile"
          >
            {{ parsing ? "解析中..." : "解析并预览" }}
          </button>
          <button
            v-if="selectedFile || preview"
            class="ghost-aurora"
            @click="clearSelection"
          >
            清空
          </button>
        </div>

        <div class="field-hint">
          支持字段：日期时间、渠道名称、关键词、推广任务、风险判定、搜索量、订单量、搜索转化率、收益金额。确认后会按渠道、关键词绑定和生效单价进入归因分析；未匹配记录会显示具体待办。
        </div>
      </article>

      <aside class="workspace-rail">
        <p class="section-index quiet">03 / 当前规则</p>
        <h2 class="workspace-title">确认前检查</h2>
        <div class="check-list">
          <div>
            <span>文件来源</span><strong>{{ sourceLabel(sourceType) }}</strong>
          </div>
          <div><span>处理方式</span><strong>解析 → 预览 → 确认</strong></div>
          <div><span>错误策略</span><strong>错误行跳过，有效行可确认</strong></div>
          <div><span>业务影响</span><strong>确认后进入归因分析</strong></div>
        </div>
      </aside>
    </section>

    <article v-if="preview" class="panel data-panel">
      <div class="list-toolbar preview-toolbar">
        <div>
          <span class="toolbar-title">解析预览（已暂存）</span>
          <span class="toolbar-count">{{ preview.fileName }}</span>
        </div>
        <span
          :class="[
            'status-badge',
            preview.status === 'confirmed'
              ? 'active'
              : preview.status === 'rejected'
                ? 'ended'
                : 'draft',
          ]"
        >
          {{
            preview.status === "confirmed"
              ? "已确认"
              : preview.status === "rejected"
                ? "已驳回"
              : hasErrors
                ? "部分可确认"
                : "待确认"
          }}
        </span>
      </div>

      <div class="import-metrics">
        <div>
          <span>报表类型</span
          ><strong>{{ reportTypeLabels[preview.reportType] }}</strong>
        </div>
        <div>
          <span>工作表</span><strong>{{ preview.sheetName }}</strong>
        </div>
        <div>
          <span>总行数</span><strong>{{ preview.totalRows }}</strong>
        </div>
        <div>
          <span>有效行</span
          ><strong class="valid-text">{{ preview.validRows }}</strong>
        </div>
        <div>
          <span>错误行</span
          ><strong :class="preview.errorRows ? 'error-text' : 'valid-text'">{{
            preview.errorRows
          }}</strong>
        </div>
      </div>

      <div v-if="attribution" class="attribution-result">
        <strong>归因分析结果</strong>
        <span>业务日期：{{ attribution.from || "—" }} 至 {{ attribution.to || "—" }}</span>
        <span>已分析 {{ attribution.analyzedRows }} 行，已匹配 {{ attribution.matchedRows }} 行，待处理 {{ attribution.exceptionRows }} 行</span>
        <span>订单量 {{ attribution.orders }}，当前应付 ¥{{ Number(attribution.payable || 0).toFixed(2) }}</span>
        <span v-if="attribution.issues">还有 {{ attribution.issues }} 项需要运营处理，原因可在归因待办中查看。</span>
      </div>

      <div class="field-mapping">
        <div class="mapping-heading">
          <strong>字段匹配结果</strong>
          <span>系统按 Excel 表头识别，未匹配字段不会被伪造填充。</span>
        </div>
        <div class="mapping-grid">
          <div v-for="mapping in preview.fieldMappings" :key="mapping.field">
            <span>{{ mapping.label }}</span>
            <strong :class="mapping.sourceHeader ? 'mapped-text' : 'unmapped-text'">
              {{ mapping.sourceHeader || "未匹配" }}
            </strong>
          </div>
        </div>
      </div>

      <div v-if="hasErrors" class="validation-summary">
         <strong>发现 {{ preview.errorRows }} 行错误，确认时会跳过错误行。</strong>
        <span v-for="item in preview.errors.slice(0, 5)" :key="item.rowNumber"
          >第 {{ item.rowNumber }} 行：{{ item.messages.join("；") }}</span
        >
        <span v-if="preview.errors.length < preview.errorRows"
          >其余错误请查看原文件后修正并重新上传。</span
        >
      </div>

      <div class="responsive-table preview-table">
        <table>
          <thead>
            <tr>
              <th>行号</th>
              <th>日期时间</th>
              <th>渠道</th>
              <th>关键词</th>
              <th>推广任务</th>
              <th>风险判定</th>
              <th>搜索量</th>
              <th>订单量</th>
              <th>转化率</th>
              <th>收益金额</th>
              <th>校验</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in preview.previewRows" :key="row.rowNumber">
              <td class="mono-cell">{{ row.rowNumber }}</td>
              <td>{{ row.occurredAt || "—" }}</td>
              <td>{{ row.channelName || "—" }}</td>
              <td>{{ row.keyword || "—" }}</td>
              <td>{{ row.promotionTask || "—" }}</td>
              <td>{{ row.riskDecision || "—" }}</td>
              <td class="mono-cell">{{ row.searchVolume || "—" }}</td>
              <td class="mono-cell">{{ row.orderCount || "—" }}</td>
              <td class="mono-cell">
                {{ formatRate(row.searchConversionRate) }}
              </td>
              <td class="mono-cell">{{ row.revenueAmount || "—" }}</td>
              <td>
                <span
                  :class="[
                    'status-badge',
                    row.validationStatus === 'valid' ? 'active' : 'ended',
                  ]"
                  >{{ rowStatus(row) }}</span
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <details class="raw-preview">
        <summary>查看原始 Excel 字段（当前预览行）</summary>
        <div class="responsive-table preview-table">
          <table>
            <thead>
              <tr>
                <th>行号</th>
                <th v-for="(header, index) in preview.headers" :key="`${header}-${index}`">
                  {{ header || `列${index + 1}` }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in preview.previewRows" :key="`raw-${row.rowNumber}`">
                <td class="mono-cell">{{ row.rowNumber }}</td>
                <td v-for="(_header, index) in preview.headers" :key="`${row.rowNumber}-raw-${index}`">
                  {{ rawCell(row, preview.headers, index) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>

      <div class="confirm-bar">
        <span>{{
          preview.previewRows.length < preview.totalRows
            ? `仅展示前 ${preview.previewRows.length} 行`
            : "已展示全部数据行"
        }}</span>
        <button
          class="primary-action"
          :disabled="confirming || rejecting || !canConfirm"
          @click="confirmImport"
        >
          {{
            confirming
              ? "确认中..."
              : preview.status === "confirmed"
                ? "已确认"
                : `确认保存 ${preview.validRows} 行有效数据`
          }}
        </button>
        <button
          v-if="preview.status === 'preview'"
          class="ghost-aurora"
          :disabled="confirming || rejecting"
          @click="rejectImport"
        >
          {{ rejecting ? "驳回中..." : "驳回批次" }}
        </button>
      </div>
    </article>

    <article class="panel data-panel">
      <div class="list-toolbar">
        <div>
          <span class="toolbar-title">历史导入批次</span
          ><span class="toolbar-count">{{ batches.length }}</span>
        </div>
        <span v-if="loading" class="toolbar-count">加载中...</span>
      </div>
      <div v-if="!batches.length && !loading" class="empty-panel">
        <span>暂无导入记录。</span>
      </div>
      <div v-else class="responsive-table">
        <table>
          <thead>
            <tr>
              <th>文件</th>
              <th>来源</th>
              <th>报表类型</th>
              <th>行数</th>
              <th>有效 / 错误</th>
              <th>状态</th>
              <th>导入时间</th>
              <th>数据</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="batch in batches" :key="batch.id">
              <td>
                <strong>{{ batch.fileName }}</strong
                ><small class="sub-cell">{{ batch.sheetName }}</small>
              </td>
              <td>{{ sourceLabel(batch.sourceType) }}</td>
              <td>{{ reportTypeLabels[batch.reportType] }}</td>
              <td class="mono-cell">{{ batch.totalRows }}</td>
              <td class="mono-cell">
                {{ batch.validRows }} /
                <span :class="batch.errorRows ? 'error-text' : 'valid-text'">{{
                  batch.errorRows
                }}</span>
              </td>
              <td>
                <span
                  :class="['status-badge', batchStatusClasses[batch.status]]"
                  >{{ batchStatusLabels[batch.status] }}</span
                >
              </td>
              <td>{{ new Date(batch.createdAt).toLocaleString("zh-CN") }}</td>
              <td>
                <button
                  class="ghost-aurora compact-action"
                  :disabled="detailLoading"
                  @click="loadBatchDetail(batch.id)"
                >
                  {{ detailLoading ? "读取中..." : "查看数据" }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <article v-if="batchDetail" class="panel data-panel detail-panel">
      <div class="list-toolbar">
        <div>
          <span class="toolbar-title">批次数据明细</span>
          <span class="toolbar-count">{{ batchDetail.fileName }}</span>
        </div>
        <button class="ghost-aurora" @click="closeBatchDetail">关闭</button>
      </div>

      <div class="detail-summary">
        <span>
          这里展示该批次实际暂存的 Excel 原始字段，共 {{ batchDetail.total }} 行；当前显示
          {{ detailStart }} - {{ detailEnd }} 行。
        </span>
        <span>状态：{{ batchStatusLabels[batchDetail.status] }}</span>
      </div>

      <div class="responsive-table detail-table">
        <table>
          <thead>
            <tr>
              <th>行号</th>
              <th v-for="(header, index) in batchDetail.headers" :key="`${header}-${index}`">
                {{ header || `列${index + 1}` }}
              </th>
              <th>校验</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in batchDetail.rows" :key="row.rowNumber">
              <td class="mono-cell">{{ row.rowNumber }}</td>
              <td v-for="(_header, index) in batchDetail.headers" :key="`${row.rowNumber}-${index}`">
                {{ rawCell(row, batchDetail.headers, index) }}
              </td>
              <td>
                <span
                  :class="[
                    'status-badge',
                    row.validationStatus === 'valid' ? 'active' : 'ended',
                  ]"
                >
                  {{ row.validationStatus === "valid" ? "通过" : "有错误" }}
                </span>
                <small v-if="row.errors.length" class="sub-cell">{{ row.errors.join("；") }}</small>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="detail-pagination" v-if="detailTotalPages > 1">
        <button
          class="ghost-aurora"
          :disabled="detailLoading || detailPage <= 1"
          @click="changeDetailPage(detailPage - 1)"
        >
          上一页
        </button>
        <span>第 {{ detailPage }} / {{ detailTotalPages }} 页</span>
        <button
          class="ghost-aurora"
          :disabled="detailLoading || detailPage >= detailTotalPages"
          @click="changeDetailPage(detailPage + 1)"
        >
          下一页
        </button>
      </div>
    </article>
  </div>
</template>

<style scoped>
.attribution-result{display:flex;flex-wrap:wrap;gap:12px;margin:18px 0;padding:16px;border:1px solid #8eb8b9;border-radius:10px;background:#eef6f5}.attribution-result strong{width:100%}.attribution-result span{padding:6px 10px;background:#fff;border-radius:6px}
.notice {
  padding: 12px 16px;
  border-radius: var(--radius);
  font-size: 13px;
}
.error-notice {
  background: #f1ded9;
  color: #964639;
  border: 1px solid var(--clay);
}
.success-notice {
  background: #e6ebe7;
  color: var(--moss);
  border: 1px solid var(--moss);
}
.import-panel {
  padding: 22px;
}
.panel-heading,
.action-row,
.confirm-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.panel-heading {
  margin-bottom: 18px;
}
.panel-heading h2 {
  margin: 5px 0 0;
}
.limit-note,
.field-hint {
  color: var(--ink-soft);
  font-size: 12px;
}
.source-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}
.source-tabs button {
  padding: 8px 13px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--white);
  color: var(--ink-soft);
  cursor: pointer;
  font-size: 12px;
}
.source-tabs button.selected {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--white);
}
.drop-zone {
  display: grid;
  gap: 6px;
  min-height: 118px;
  place-content: center;
  margin-bottom: 14px;
  padding: 18px;
  border: 1px dashed var(--line);
  border-radius: var(--radius);
  background: var(--paper);
  text-align: center;
  cursor: pointer;
}
.drop-zone:hover {
  border-color: var(--clay);
  background: var(--paper-deep);
}
.drop-zone input {
  display: none;
}
.drop-zone strong {
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: min(420px, 70vw);
}
.drop-zone span {
  color: var(--ink-soft);
  font-size: 12px;
}
.action-row {
  justify-content: flex-start;
  margin-bottom: 14px;
}
.field-hint {
  line-height: 1.7;
}
.check-list {
  display: grid;
  gap: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}
.check-list div {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  font-size: 13px;
}
.check-list span {
  color: var(--ink-soft);
}
.check-list strong {
  text-align: right;
  font-weight: 500;
}
.preview-toolbar {
  align-items: center;
}
.import-metrics {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
  padding: 0 20px 18px;
}
.import-metrics div {
  display: grid;
  gap: 5px;
  padding: 12px;
  background: var(--paper);
  border-radius: var(--radius);
}
.import-metrics span {
  color: var(--ink-soft);
  font-size: 11px;
}
.import-metrics strong {
  font-family: var(--font-mono);
  font-size: 14px;
}
.field-mapping {
  margin: 0 20px 18px;
  padding: 14px;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}
.mapping-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  font-size: 12px;
}
.mapping-heading span {
  color: var(--ink-soft);
}
.mapping-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px 12px;
}
.mapping-grid div {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  background: var(--paper);
  border-radius: var(--radius);
  font-size: 12px;
}
.mapping-grid span {
  color: var(--ink-soft);
}
.mapping-grid strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.mapped-text {
  color: var(--moss);
}
.unmapped-text {
  color: var(--clay);
}
.valid-text {
  color: var(--moss);
}
.error-text {
  color: var(--clay);
}
.validation-summary {
  display: grid;
  gap: 4px;
  margin: 0 20px 16px;
  padding: 12px 14px;
  border: 1px solid var(--clay);
  border-radius: var(--radius);
  background: #fbf1ed;
  color: #964639;
  font-size: 12px;
  line-height: 1.5;
}
.preview-table {
  padding: 0 20px;
}
.preview-table table {
  min-width: 1080px;
}
.raw-preview {
  margin: 0 20px;
  border-top: 1px solid var(--line);
}
.raw-preview summary {
  padding: 14px 0;
  color: var(--ink-soft);
  cursor: pointer;
  font-size: 12px;
}
.raw-preview .preview-table {
  padding-left: 0;
  padding-right: 0;
}
.mono-cell {
  font-family: var(--font-mono);
  font-size: 12px;
}
.sub-cell {
  display: block;
  margin-top: 3px;
  color: var(--ink-soft);
  font-size: 11px;
}
.compact-action {
  padding: 7px 10px;
  white-space: nowrap;
}
.detail-panel {
  margin-top: 0;
}
.detail-summary {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  padding: 0 20px 16px;
  color: var(--ink-soft);
  font-size: 12px;
}
.detail-table {
  padding: 0 20px;
}
.detail-table table {
  min-width: 980px;
}
.detail-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  margin: 18px 20px 0;
  padding-top: 16px;
  border-top: 1px solid var(--line);
  color: var(--ink-soft);
  font-size: 12px;
}
.confirm-bar {
  margin: 18px 20px 0;
  padding-top: 16px;
  border-top: 1px solid var(--line);
  color: var(--ink-soft);
  font-size: 12px;
}
@media (max-width: 900px) {
  .import-metrics {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 600px) {
  .panel-heading,
  .confirm-bar {
    align-items: flex-start;
    flex-direction: column;
  }
  .import-metrics {
    padding-left: 14px;
    padding-right: 14px;
  }
  .field-mapping {
    margin-left: 14px;
    margin-right: 14px;
  }
  .mapping-grid {
    grid-template-columns: 1fr;
  }
  .preview-table {
    padding: 0 14px;
  }
  .validation-summary {
    margin-left: 14px;
    margin-right: 14px;
  }
  .raw-preview {
    margin-left: 14px;
    margin-right: 14px;
  }
  .detail-summary {
    align-items: flex-start;
    flex-direction: column;
    padding-left: 14px;
    padding-right: 14px;
  }
  .detail-table {
    padding-left: 14px;
    padding-right: 14px;
  }
}
</style>
