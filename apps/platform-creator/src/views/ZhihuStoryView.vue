<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useAuthStore, apis } from '../stores/auth'

interface HubCard {
  index: string
  title: string
  desc: string
  path: string
  count: number | null
}

const cards = ref<HubCard[]>([
  { index: '01', title: '推广计划', desc: '管理推广关键词', path: '/zhihu-story/plans', count: null },
  { index: '02', title: '作品管理', desc: '管理推广作品', path: '/zhihu-story/works', count: null },
  { index: '03', title: '任务列表', desc: '查看推广任务', path: '/zhihu-story/tasks', count: null },
  { index: '04', title: '盐选榜单', desc: '查看盐选排行', path: '/zhihu-story/salt', count: null },
  { index: '05', title: '评论截流', desc: '监控和管理评论区推广', path: '/zhihu-story/comments', count: null },
  { index: '06', title: '风险举报', desc: '处理风险内容举报', path: '/zhihu-story/risk', count: null },
  { index: '07', title: '有声书 / 漫画', desc: '管理有声书和漫画内容', path: '/zhihu-story/media', count: null },
  { index: '08', title: '内容标签', desc: '管理内容分类标签', path: '/zhihu-story/tags', count: null },
  { index: '09', title: '产品库', desc: '管理推广产品', path: '/zhihu-story/products', count: null },
  { index: '10', title: '素材库', desc: '管理推广素材', path: '/zhihu-story/assets', count: null },
])

onMounted(async () => {
  // 知乎实时接口的模块（盐选/截流/举报/有声书/标签/产品）不提供廉价计数，保持 '—'
  const loaders: Array<Promise<number | null>> = [
    apis.plans.list({ page: 1, pageSize: 1 }).then((d) => d.total).catch(() => null),
    apis.story.listWorks({ page: 1, pageSize: 1 }).then((d) => d.total).catch(() => null),
    apis.story.listTasks({ page: 1, pageSize: 1 }).then((d) => d.total).catch(() => null),
    apis.story.listItems('asset').then((list) => list.length).catch(() => null),
  ]
  const counts = await Promise.all(loaders)
  const countMap: Record<string, number | null> = { '01': counts[0] ?? null, '02': counts[1] ?? null, '03': counts[2] ?? null, '10': counts[3] ?? null }
  cards.value.forEach((card) => { card.count = countMap[card.index] ?? null })
})
</script>

<template>
  <div class="page-stack">
    <header class="page-header">
      <div>
        <p class="section-index">01 / 知乎故事</p>
        <h1>知乎故事</h1>
        <p>知乎推广的全部子功能聚合在这里：计划、作品、任务与内容资产。</p>
      </div>
    </header>

    <section class="hub-grid">
      <router-link v-for="card in cards" :key="card.path" :to="card.path" class="hub-card">
        <div class="hub-card-head">
          <span class="hub-index">{{ card.index }}</span>
          <strong v-if="card.count !== null" class="hub-count">{{ card.count }}</strong>
        </div>
        <h3>{{ card.title }}</h3>
        <p>{{ card.desc }}</p>
        <span class="hub-enter">进入 →</span>
      </router-link>
    </section>
  </div>
</template>

<style scoped>
.hub-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }

.hub-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--white);
  transition: border-color 0.15s ease, transform 0.15s ease;
}

.hub-card:hover { border-color: var(--ink); transform: translateY(-1px); }

.hub-card-head { display: flex; align-items: baseline; justify-content: space-between; }
.hub-index { color: var(--clay); font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.16em; }
.hub-count { font-family: var(--font-display); font-size: 26px; letter-spacing: -0.03em; }
.hub-card h3 { margin: 0; font-size: 15px; font-weight: 600; }
.hub-card p { margin: 0; flex: 1; color: var(--ink-soft); font-size: 13px; line-height: 1.6; }
.hub-enter { margin-top: 6px; color: var(--ink-soft); font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.08em; }
.hub-card:hover .hub-enter { color: var(--clay); }
</style>
