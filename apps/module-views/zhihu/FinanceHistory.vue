<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { HttpClient } from "@zhihu-koc/shared-services/core";
import {
  DataGrid,
  DetailDrawer,
  type DataGridRow,
} from "@zhihu-koc/shared-components";
const props = defineProps<{
  http: HttpClient;
  role: string;
  currentPath: string;
}>();
type Field = { label: string; value: string };
type RecordRow = DataGridRow & { fields: Field[]; invoiceName?: string | null };
const staff = computed(() => ["admin", "developer"].includes(props.role));
const categories = computed(() => [
  { key: "earnings", label: "收益记录" },
  { key: "withdrawals", label: "提现记录" },
  { key: "appeals", label: "申诉记录" },
  ...(staff.value
    ? [
        { key: "settlements", label: "结算记录" },
        { key: "data-import", label: "导入记录" },
      ]
    : []),
]);
const kind = computed(
  () =>
    categories.value.find((c) => props.currentPath.endsWith("/" + c.key))
      ?.key || "earnings",
);
const page = ref(1),
  total = ref(0),
  list = ref<RecordRow[]>([]),
  busy = ref(false),
  error = ref("");
const selected = ref<RecordRow | null>(null),
  lines = ref<{ id: string; fields: Field[] }[]>([]),
  lineTotal = ref(0),
  linePage = ref(1),
  lineBusy = ref(false),
  lineError = ref("");
let generation = 0,
  detailGeneration = 0;
async function load() {
  const current = ++generation;
  busy.value = true;
  error.value = "";
  try {
    const data = await props.http.get<{ list: RecordRow[]; total: number }>(
      "/finance-history/" + kind.value,
      { page: page.value, pageSize: 25 },
    );
    if (current === generation) {
      list.value = data.list;
      total.value = data.total;
    }
  } catch (e) {
    if (current === generation) {
      list.value = [];
      error.value =
        e instanceof Error ? e.message : "历史账目没加载出来，请重试。";
    }
  } finally {
    if (current === generation) busy.value = false;
  }
}
async function loadLines() {
  if (!selected.value) return;
  const current = ++detailGeneration;
  lineBusy.value = true;
  lineError.value = "";
  try {
    const data = await props.http.get<{
      list: { id: string; fields: Field[] }[];
      total: number;
    }>("/finance-history/" + kind.value + "/" + selected.value.id + "/lines", {
      page: linePage.value,
      pageSize: 25,
    });
    if (current === detailGeneration) {
      lines.value = data.list;
      lineTotal.value = data.total;
    }
  } catch (e) {
    if (current === detailGeneration)
      lineError.value =
        e instanceof Error ? e.message : "明细没加载出来，请重试。";
  } finally {
    if (current === detailGeneration) lineBusy.value = false;
  }
}
function inspect(row: DataGridRow) {
  removal.value=null;removalError.value='';
  downloadError.value = "";
  selected.value = list.value.find((r) => r.id === row.id) || null;
  lines.value = [];
  lineTotal.value = 0;
  linePage.value = 1;
  if (["settlements", "data-import"].includes(kind.value)) void loadLines();
}
const downloading = ref(false),
  downloadError = ref("");
async function downloadInvoice() {
  if (!selected.value?.invoiceName || downloading.value) return;
  downloading.value = true;
  downloadError.value = "";
  try {
    const blob = await props.http.getBlob(
      "/withdrawals/" + selected.value.id + "/invoice",
    );
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = selected.value.invoiceName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    downloadError.value =
      typeof e === "object" && e && "message" in e
        ? String(e.message)
        : "发票下载失败，请重试。";
  } finally {
    downloading.value = false;
  }
}
type Removal={id:string;fileName:string;rows:number;reviewHash:string;canRemove:boolean;blocked:string;linked:{id:string;corrections:number}[]};
const removal=ref<Removal|null>(null),removalBusy=ref(false),removalError=ref(''),notice=ref('');
async function prepareRemoval(){
 if(!selected.value)return;
 removalBusy.value=true;removalError.value='';
 try{removal.value=await props.http.get<Removal>('/finance-history/data-import/'+selected.value.id+'/removal');}
 catch(e){removalError.value=e instanceof Error?e.message:'删除影响没加载出来，请重试。';}
 finally{removalBusy.value=false;}
}
async function removeImport(){
 if(!removal.value?.canRemove)return;
 removalBusy.value=true;removalError.value='';
 try{
  await props.http.post('/finance-history/data-import/'+removal.value.id+'/removal',{reviewHash:removal.value.reviewHash});
  notice.value='已删除这份旧报表；关联的未确认业绩已撤回。可到财务页重新上传正确文件。';
  close();await load();
 }catch(e){removalError.value=e instanceof Error?e.message:'删除未完成，请重新查看影响后重试。';}
 finally{removalBusy.value=false;}
}
function close() {
  removal.value=null;removalError.value='';
  selected.value = null;
  detailGeneration++;
}
watch(
  kind,
  () => {
    page.value = 1;
    close();
    void load();
  },
  { immediate: true },
);
watch(page, () => void load());
watch(linePage, () => void loadLines());
</script>
<template>
  <section class="finance-history" :aria-busy="busy">
    <header class="history-heading">
      <div>
        <h2>历史账目</h2>
        <p>{{kind==='data-import'?'核对或删除旧报表，关联的计账数据一起处理。':'保留原始记录，仅供查询。'}}</p>
      </div>
      <button :disabled="busy" @click="load">刷新</button>
    </header>
    <nav aria-label="历史账目类型">
      <router-link
        v-for="c in categories"
        :key="c.key"
        :aria-current="kind === c.key ? 'page' : undefined"
        :to="'/modules/zhihu/' + c.key"
        >{{ c.label }}</router-link
      >
    </nav>
    <p v-if="notice" role="status">{{notice}} <router-link to="/finance">上传正确报表</router-link></p>
    <p v-if="error" role="alert">
      {{ error }} <button @click="load">重试</button>
    </p>
    <DataGrid
      title="历史记录"
      title-label="记录"
      :rows="list"
      :columns="[
        { key: 'date', label: '日期' },
        { key: 'owner', label: '记录人' },
        { key: 'amount', label: '金额（元）', numeric: true },
      ]"
      :busy="busy"
      :external-details="true"
      @inspect="inspect"
    >
      <template #empty
        ><p>暂无这类历史记录。</p>
        <router-link :to="staff ? '/finance' : '/income'"
          >查看当前{{ staff ? "财务" : "收益" }}</router-link
        ></template
      >
    </DataGrid>
    <footer class="history-paging">
      <span
        >共 {{ total }} 条 · 第 {{ page }} /
        {{ Math.max(1, Math.ceil(total / 25)) }} 页</span
      ><button :disabled="busy || page === 1" @click="page--">上一页</button
      ><button :disabled="busy || page * 25 >= total" @click="page++">
        下一页
      </button>
    </footer>
    <DetailDrawer
      :open="!!selected"
      :title="selected?.title || '历史记录'"
      @close="close"
    >
      <template v-if="selected"
        ><p class="readonly-label">{{kind==='data-import'?'历史导入记录':'历史记录 · 只读'}}</p>
        <section v-if="staff&&kind==='data-import'" class="removal-actions">
         <button v-if="!removal" :disabled="removalBusy" @click="prepareRemoval">{{removalBusy?'正在核对…':'删除这份旧报表'}}</button>
         <template v-else>
          <p>{{removal.canRemove?'删除 '+removal.rows+' 行旧报表记录，并撤回 '+removal.linked.length+' 份关联报表的计账影响。':removal.blocked}}</p>
          <p v-if="removal.linked.some(row=>row.corrections)">已确认的金额会生成更正供财务核对，原账和付款记录保留。</p>
          <div><button :disabled="removalBusy" @click="removal=null">取消</button> <button v-if="removal.canRemove" :disabled="removalBusy" @click="removeImport">确认删除旧报表</button><router-link v-else to="/finance">查看当前财务</router-link></div>
         </template>
         <p v-if="removalError" role="alert">{{removalError}} <button :disabled="removalBusy" @click="prepareRemoval">重新核对</button></p>
        </section>
        <button
          v-if="selected.invoiceName"
          :disabled="downloading"
          @click="downloadInvoice"
        >
          {{ downloading ? "正在下载…" : "下载历史发票" }}
        </button>
        <p v-if="downloadError" role="alert">{{ downloadError }}</p>
        <dl>
          <div v-for="f in selected.fields" :key="f.label">
            <dt>{{ f.label }}</dt>
            <dd>{{ f.value }}</dd>
          </div>
        </dl>
        <template v-if="['settlements', 'data-import'].includes(kind)"
          ><h3>原记录明细</h3>
          <p v-if="lineBusy" role="status">正在读取…</p>
          <p v-if="lineError" role="alert">
            {{ lineError }} <button @click="loadLines">重试</button>
          </p>
          <article v-for="line in lines" :key="line.id" class="history-line">
            <dl>
              <div v-for="f in line.fields" :key="f.label">
                <dt>{{ f.label }}</dt>
                <dd>{{ f.value }}</dd>
              </div>
            </dl>
          </article>
          <p v-if="!lineBusy && !lineError && !lines.length">
            这条记录没有明细。
          </p>
          <footer class="history-paging">
            <span>共 {{ lineTotal }} 条</span
            ><button :disabled="lineBusy || linePage === 1" @click="linePage--">
              上一页</button
            ><button
              :disabled="lineBusy || linePage * 25 >= lineTotal"
              @click="linePage++"
            >
              下一页
            </button>
          </footer></template
        >
      </template>
    </DetailDrawer>
  </section>
</template>
<style scoped>
.finance-history {
  min-width: 0;
  display: grid;
  gap: 18px;
}
.history-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.history-heading h2 {
  margin: 0;
}
.history-heading p,
.readonly-label {
  color: var(--muted);
}
nav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
nav a {
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  text-decoration: none;
  color: var(--ink);
}
nav a[aria-current="page"] {
  background: var(--ink);
  color: var(--paper);
}
button {
  padding: 10px 14px;
  min-height: 44px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink);
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
.history-paging {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.history-paging span {
  margin-right: auto;
}
dl {
  margin: 0;
}
dl div {
  display: grid;
  grid-template-columns: 110px minmax(0, 1fr);
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}
dt {
  color: var(--muted);
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.history-line {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px;
  margin: 12px 0;
}
@media (max-width: 480px) {
  dl div {
    grid-template-columns: 88px minmax(0, 1fr);
    gap: 8px;
  }
  nav a {
    flex: 1 0 auto;
    text-align: center;
  }
}
</style>
