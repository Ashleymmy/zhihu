<script setup lang="ts">
import { onMounted, ref } from "vue";
import { DetailDrawer } from "@zhihu-koc/shared-components";
import { http } from "../stores/auth";
import { ROLE_LABELS, type GlobalRole } from "@zhihu-koc/shared-contracts/core";
type Node = {
  id: string;
  name: string;
  role: string;
  children: number;
  active: boolean;
};
type Detail = {
  user: { name: string };
  referral: { inviter: { name: string } | null; channel: string } | null;
  team: { leader: { name: string } | null; since: string } | null;
  counts: { direct: number; indirect: number };
  timeline: {
    at: string;
    kind: string;
    title: string;
    detail: string;
    operator: string | null;
  }[];
  hasMore: boolean;
};
const mode = ref("team"),
  nodes = ref<Node[]>([]),
  crumbs = ref<Node[]>([]),
  page = ref(1),
  hasMore = ref(false),
  busy = ref(false),
  error = ref(""),
  selected = ref<Node | null>(null),
  detail = ref<Detail | null>(null),
  historyPage = ref(1);
let requestVersion = 0;
function date(v: string) {
  return new Date(v).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}
async function load(more = false) {
  const version = ++requestVersion;
  busy.value = true;
  error.value = "";
  try {
    const next = more ? page.value + 1 : 1,
      parent = crumbs.value.at(-1)?.id;
    const r = await http.get<{ list: Node[]; page: number; hasMore: boolean }>(
      "/relations/tree",
      { mode: mode.value, page: next, ...(parent ? { parent } : {}) },
    );
    if (version !== requestVersion) return;
    nodes.value = more ? [...nodes.value, ...r.list] : r.list;
    page.value = r.page;
    hasMore.value = r.hasMore;
  } catch (e: any) {
    if (version === requestVersion)
      error.value = e.message || "加载失败，请重试";
  } finally {
    if (version === requestVersion) busy.value = false;
  }
}
function switchMode(value: string) {
  mode.value = value;
  crumbs.value = [];
  selected.value = null;
  detail.value = null;
  load();
}
function enter(node: Node) {
  crumbs.value.push(node);
  selected.value = null;
  detail.value = null;
  load();
}
function back(index: number) {
  crumbs.value = crumbs.value.slice(0, index);
  selected.value = null;
  detail.value = null;
  load();
}
async function show(node: Node, more = false) {
  const version = ++requestVersion;
  busy.value = true;
  error.value = "";
  selected.value = node;
  if (!more) detail.value = null;
  try {
    const next = more ? historyPage.value + 1 : 1;
    const result = await http.get<Detail>("/relations/members/" + node.id, {
      page: next,
    });
    if (version !== requestVersion) return;
    detail.value =
      more && detail.value
        ? {
            ...result,
            timeline: [...detail.value.timeline, ...result.timeline].sort(
              (a, b) => Date.parse(b.at) - Date.parse(a.at),
            ),
          }
        : result;
    historyPage.value = next;
  } catch (e: any) {
    if (version === requestVersion)
      error.value = e.message || "关系记录加载失败";
  } finally {
    if (version === requestVersion) busy.value = false;
  }
}
onMounted(() => load());
function closeDetail() {
  requestVersion++;
  selected.value = null;
  detail.value = null;
  busy.value = false;
}
</script>
<template>
  <section class="panel relations-panel">
    <header>
      <h2>成员关系记录</h2>
      <div class="actions">
        <button :aria-pressed="mode === 'team'" @click="switchMode('team')">
          团队归属</button
        ><button
          :aria-pressed="mode === 'invite'"
          @click="switchMode('invite')"
        >
          邀请来源
        </button>
      </div>
    </header>
    <p>当前团队与邀请来源分别记录；转团不会改变最初的邀请来源。</p>
    <nav class="crumbs" aria-label="关系层级">
      <button @click="back(0)">全部</button
      ><button v-for="(item, i) in crumbs" :key="item.id" @click="back(i + 1)">
        › {{ item.name }}
      </button>
    </nav>
    <p v-if="error" role="alert">
      {{ error }}
      <button @click="selected ? show(selected) : load()">重试</button>
    </p>
    <p v-if="busy" role="status">正在加载…</p>
    <div class="relation-layout">
      <div>
        <ul class="nodes">
          <li v-for="node in nodes" :key="node.id">
            <div>
              <strong>{{ node.name }}</strong
              ><small
                >{{ ROLE_LABELS[node.role as GlobalRole] || "平台" }} ·
                {{ node.active ? "启用" : "停用" }}</small
              >
            </div>
            <button v-if="node.children" @click="enter(node)">
              {{ node.children }} 人 · 查看</button
            ><button v-if="node.id !== 'platform'" @click="show(node)">
              关系记录
            </button>
          </li>
        </ul>
        <p v-if="!busy && !nodes.length">此层没有成员，可返回上一级查看。</p>
        <button v-if="hasMore" :disabled="busy" @click="load(true)">
          加载更多成员
        </button>
      </div>
      <DetailDrawer
        :open="!!selected"
        title="成员关系记录"
        @close="closeDetail"
      >
        <p v-if="busy" role="status">正在加载关系记录…</p>
        <p v-if="error" role="alert">
          {{ error }}
          <button v-if="selected" @click="show(selected)">重试</button>
        </p>
        <article v-if="detail" class="relation-detail">
          <h3>{{ detail.user.name }}</h3>
          <p>当前团队：{{ detail.team?.leader?.name || "平台直管" }}</p>
          <p>邀请人：{{ detail.referral?.inviter?.name || "未记录邀请人" }}</p>
          <p>来源：{{ detail.referral?.channel || "尚未整理" }}</p>
          <p>
            直接邀请 {{ detail.counts.direct }} 人 · 间接邀请
            {{ detail.counts.indirect }} 人
          </p>
          <h4>关系变更记录</h4>
          <ol>
            <li
              v-for="(item, index) in detail.timeline"
              :key="item.kind + item.at + index"
            >
              <time>{{ date(item.at) }}</time
              ><strong>{{ item.title }}</strong>
              <p>
                {{ item.detail
                }}{{ item.operator ? " · 操作人：" + item.operator : "" }}
              </p>
            </li>
          </ol>
          <button
            v-if="detail.hasMore && selected"
            :disabled="busy"
            @click="show(selected, true)"
          >
            加载更多记录
          </button>
        </article>
      </DetailDrawer>
    </div>
  </section>
</template>
<style scoped>
.relations-panel {
  padding: 24px;
}
.relations-panel header,
.actions,
.crumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.relations-panel header {
  justify-content: space-between;
}
.relations-panel p,
.nodes small,
time {
  color: var(--ink-soft);
}
.crumbs {
  margin: 20px 0;
}
.relation-layout {
  min-width: 0;
}
button {
  min-height: 40px;
  padding: 8px 12px;
  cursor: pointer;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--paper);
  color: inherit;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
.nodes {
  padding: 0;
  list-style: none;
  margin: 0;
}
.nodes li {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  padding: 16px 0;
  border-bottom: 1px solid var(--line);
}
.nodes li > div {
  flex: 1;
  min-width: 100px;
  display: grid;
  gap: 6px;
}
.relation-detail {
  padding: 20px;
  background: var(--paper-deep);
}
.relation-detail ol {
  padding-left: 20px;
}
.relation-detail li {
  padding: 12px 0;
}
.relation-detail strong,
.relation-detail time {
  display: block;
}
.relation-detail p {
  line-height: 1.7;
  overflow-wrap: anywhere;
}
button[aria-pressed="true"] {
  background: #195e62;
  color: white;
}
@media (max-width: 800px) {
  .relation-layout {
    grid-template-columns: 1fr;
  }
  .relations-panel {
    padding: 16px;
  }
}
</style>
