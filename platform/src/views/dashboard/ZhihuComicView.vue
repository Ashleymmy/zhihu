<template>
  <div class="z-page">
    <div class="pg-header">
      <div><h1 class="pg-title">漫剧内容库</h1><p class="pg-sub">知乎漫剧剧目与集数列表</p></div>
    </div>
    <div class="comic-layout">
      <!-- 左栏：剧目 -->
      <div class="drama-panel">
        <div class="panel-head">
          <a-input v-model:value="store.searchTitle" placeholder="搜索剧名…" allow-clear
                   @change="onSearch" @pressEnter="onSearch" />
        </div>
        <div class="drama-list">
          <div v-if="store.dramasLoading" class="list-loading"><a-spin /></div>
          <div v-for="d in store.dramas" :key="d.drama_id"
               :class="['drama-item', { active: store.selectedDrama?.drama_id === d.drama_id }]"
               @click="store.fetchEpisodes(d)">
            <div class="drama-cover" v-if="d.tab_artwork">
              <img :src="d.tab_artwork" :alt="d.title" />
            </div>
            <span class="drama-title">{{ d.title }}</span>
          </div>
        </div>
        <a-pagination v-if="store.dramasTotal > 20" :total="store.dramasTotal" :page-size="20"
                      :current="store.dramasPage" size="small" @change="store.fetchDramas" style="padding:10px 12px" />
      </div>

      <!-- 右栏：集数 -->
      <div class="episodes-panel">
        <div v-if="!store.selectedDrama" class="episodes-empty">← 请在左侧选择剧目</div>
        <div v-else class="table-card">
          <a-table :data-source="store.episodes" :loading="store.episodesLoading" row-key="id" size="middle"
            :pagination="{ total: store.episodesTotal, pageSize: 20, current: store.episodesPage, onChange: (p: number) => store.selectedDrama && store.fetchEpisodes(store.selectedDrama, p) }">
            <a-table-column title="标题" :ellipsis="true">
              <template #default="{ record }">
                <a v-if="record.video_url" :href="record.video_url" target="_blank" class="link-btn">{{ record.title }}</a>
                <span v-else>{{ record.title }}</span>
              </template>
            </a-table-column>
            <a-table-column title="付费" :width="70">
              <template #default="{ record }">
                <span :class="['badge', record.is_pay ? 'badge-warning' : 'badge-success']">{{ record.is_pay ? '付费' : '免费' }}</span>
              </template>
            </a-table-column>
            <a-table-column title="抖音链接" :width="90">
              <template #default="{ record }">
                <a v-if="record.douyin_video_url" :href="record.douyin_video_url" target="_blank" class="link-btn">抖音</a>
                <span v-else style="color:var(--color-text-disabled);font-size:12px">—</span>
              </template>
            </a-table-column>
          </a-table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useZComicStore } from '@/stores/zComic.store'

const store = useZComicStore()
let searchTimer: ReturnType<typeof setTimeout> | null = null
function onSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => store.fetchDramas(1), 300)
}
onMounted(() => store.fetchDramas())
</script>

<style scoped>
.z-page { padding-bottom: 16px; }
.pg-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 16px; }
.pg-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 4px; }
.pg-sub { font-size: 12.5px; color: var(--color-text-disabled); }
.comic-layout { display: grid; grid-template-columns: 220px 1fr; gap: 14px; }
.drama-panel { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); display: flex; flex-direction: column; max-height: 620px; }
.panel-head { padding: 12px; border-bottom: 1px solid var(--color-border); }
.drama-list { flex: 1; overflow-y: auto; }
.items-loading { display: flex; justify-content: center; padding: 24px; }
.drama-item { display: flex; align-items: center; gap: 8px; padding: 9px 12px; cursor: pointer; border-bottom: 1px solid var(--color-border); transition: all var(--transition-fast); }
.drama-item:hover { background: var(--color-bg-hover); }
.drama-item.active { background: var(--color-accent-subtle); }
.drama-cover { width: 32px; height: 32px; border-radius: var(--radius-sm); overflow: hidden; flex-shrink: 0; }
.drama-cover img { width: 100%; height: 100%; object-fit: cover; }
.drama-title { font-size: 12.5px; color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.drama-item.active .drama-title { color: var(--color-accent); }
.episodes-panel { min-width: 0; }
.episodes-empty { display: flex; align-items: center; justify-content: center; height: 200px; color: var(--color-text-disabled); font-size: 13px; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); }
.table-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; }
.link-btn { font-size: 12px; color: var(--color-accent); text-decoration: none; }
.link-btn:hover { text-decoration: underline; }
</style>
