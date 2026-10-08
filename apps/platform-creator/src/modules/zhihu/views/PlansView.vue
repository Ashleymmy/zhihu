<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { Plan } from "@zhihu-koc/shared-contracts/zhihu";
import { apis } from "../context";
type MyPlan = Plan & {
  canRegister?: boolean;
  keywordProjectId?: string;
  keywordAccountId?: string;
};
const route = useRoute();
const plans = ref<MyPlan[]>([]),
  total = ref(0),
  page = ref(1),
  pageSize = 20;
const search = ref(""),
  loading = ref(false),
  error = ref("");
const statusLabels: Record<string, string> = {
  pending: "待确认",
  active: "进行中",
  paused: "已暂停",
  ended: "已结束",
  rejected: "暂不可用",
};
let generation = 0;
async function load() {
  const version = ++generation;
  loading.value = true;
  error.value = "";
  try {
    const result = await apis.plans.list({
      page: page.value,
      pageSize,
      keyword: search.value.trim() || undefined,
    });
    if (version !== generation) return;
    plans.value = result.list;
    total.value = result.total;
  } catch (e: any) {
    if (version === generation)
      error.value = e?.message || "计划加载失败，请重试";
  } finally {
    if (version === generation) loading.value = false;
  }
}
onMounted(load);
</script>
<template>
  <section class="page-stack my-plans">
    <router-link v-if="route.query.from === 'story'" to="/modules/zhihu/history"
      >← 返回知乎故事</router-link
    >
    <header class="page-header">
      <div>
        <p class="eyebrow">我的业务</p>
        <h1>我的计划</h1>
        <p>仅展示归属本人、已领取或已有本人作品记录的计划。</p>
      </div>
      <div class="plan-search">
        <router-link class="primary-action" to="/modules/zhihu/operations?create=1">创建关键词</router-link>
        <router-link to="/modules/zhihu/operations">查看 / 领取关键词</router-link>
      </div>
    </header>
    <form
      class="plan-search"
      @submit.prevent="
        page = 1;
        load();
      "
    >
      <label
        >搜索我的计划<input
          v-model="search"
          type="search"
          placeholder="输入关键词"
          maxlength="128" /></label
      ><button :disabled="loading">搜索</button
      ><button type="button" :disabled="loading" @click="load">刷新</button>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
    <article class="panel">
      <div class="plan-heading">
        我的计划 <span>{{ total }}</span>
      </div>
      <p v-if="loading" class="plan-empty" role="status">正在加载计划…</p>
      <p v-else-if="!plans.length" class="plan-empty">
        {{
          search
            ? "没有匹配的本人计划。"
            : "还没有关键词。可以自行创建、领取可用关键词，或由团长分配。"
        }}
      </p>
      <div v-else class="plan-table">
        <table>
          <thead>
            <tr>
              <th>关键词</th>
              <th>渠道</th>
              <th>状态</th>
              <th class="plan-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="plan in plans" :key="plan.id">
              <td>
                <strong>{{ plan.keyword }}</strong
                ><small>计划编号：{{ plan.id }}</small>
              </td>
              <td>{{ plan.channelName || "—" }}</td>
              <td>{{ statusLabels[plan.status] || "待确认" }}</td>
              <td class="plan-actions">
                <div>
                  <router-link
                    :to="{
                      path: '/modules/zhihu/works',
                      query: { planId: plan.id, keyword: plan.keyword },
                    }"
                    >查看我的作品</router-link
                  >
                  <router-link
                    v-if="plan.canRegister"
                    :to="{
                      path: '/modules/zhihu/works/new',
                      query: {
                        planId: plan.id,
                        keyword: plan.keyword,
                        projectId: plan.keywordProjectId,
                        accountId: plan.keywordAccountId,
                      },
                    }"
                    >登记作品</router-link
                  >
                  <span v-else class="plan-note">当前不可新增登记</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <footer class="plan-pagination">
        <span
          >共 {{ total }} 条 · 第 {{ page }} /
          {{ Math.max(1, Math.ceil(total / pageSize)) }} 页</span
        ><button
          :disabled="loading || page === 1"
          @click="
            page--;
            load();
          "
        >
          上一页</button
        ><button
          :disabled="loading || page * pageSize >= total"
          @click="
            page++;
            load();
          "
        >
          下一页
        </button>
      </footer>
    </article>
  </section>
</template>
<style scoped>
.my-plans {
  min-width: 0;
  grid-template-columns: minmax(0, 1fr);
}
.my-plans > * {
  min-width: 0;
  max-width: 100%;
}
.my-plans p {
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.my-plans [role="alert"] {
  color: #9b3434;
}
.my-plans button,
.my-plans .primary-action {
  min-height: 42px;
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-radius: 7px;
  cursor: pointer;
  text-decoration: none;
}
.my-plans button {
  color: inherit;
  background: var(--paper);
}
.my-plans button:disabled {
  opacity: 0.5;
  cursor: default;
}
.plan-search {
  display: flex;
  align-items: end;
  gap: 12px;
  flex-wrap: wrap;
}
.plan-search label {
  display: grid;
  gap: 8px;
  flex: 1;
  max-width: 480px;
  min-width: 160px;
}
.plan-search input {
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 7px;
  min-height: 42px;
  background: var(--paper);
  color: inherit;
}
.plan-heading,
.plan-pagination {
  padding: 20px;
  border-bottom: 1px solid var(--line);
}
.plan-heading span {
  color: var(--ink-soft);
  margin-left: 8px;
}
.plan-table {
  overflow: auto;
}
.plan-table table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}
.plan-table td,
.plan-table th {
  padding: 18px;
  border-bottom: 1px solid var(--line);
  font-size: 14px;
}
.plan-table th {
  font-weight: 500;
  color: var(--ink-soft);
}
.plan-table small {
  display: block;
  margin-top: 6px;
  color: var(--ink-soft);
  font-size: 12px;
}
.plan-actions {
  text-align: right;
}
.plan-actions div {
  display: flex;
  gap: 14px;
  justify-content: flex-end;
  flex-wrap: wrap;
}
.plan-actions a {
  color: #195e62;
  white-space: nowrap;
}
.plan-note {
  color: var(--ink-soft);
  font-size: 12px;
}
.plan-empty {
  padding: 30px;
  color: var(--ink-soft);
}
.plan-pagination {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 13px;
}
.plan-pagination span {
  margin-right: auto;
}
@media (max-width: 650px) {
  .plan-table table,
  .plan-table tbody {
    display: block;
  }
  .plan-table thead {
    display: none;
  }
  .plan-table tr {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    padding: 18px;
    gap: 12px;
    border-bottom: 1px solid var(--line);
  }
  .plan-table td {
    padding: 0;
    border: 0;
    overflow-wrap: anywhere;
  }
  .plan-table td:first-child,
  .plan-table .plan-actions {
    grid-column: 1 / -1;
    text-align: left;
  }
  .plan-actions div {
    justify-content: flex-start;
    align-items: center;
  }
  .plan-actions a {
    padding: 10px 0;
  }
  .plan-search label {
    flex-basis: 100%;
    max-width: none;
  }
  .plan-search input {
    font-size: 16px;
  }
  .plan-pagination {
    padding: 14px;
  }
}
</style>
