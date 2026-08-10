<template>
  <div class="z-page">
    <div class="pg-header">
      <div><h1 class="pg-title">有声书内容库</h1><p class="pg-sub">知乎盐选有声书接口状态</p></div>
    </div>
    <div v-if="!apiAvailable" class="status-card">
      <a-result
        status="warning"
        title="有声书接口暂不可用"
        sub-title="当前知乎 OpenAPI 地址返回 HTTP 404。页面已停止自动请求，待确认官方接口路径或账号能力后再恢复。"
      />
    </div>
    <div v-else class="table-card">
      <a-table :data-source="store.items" :loading="store.loading" row-key="section_id" size="middle"
        :pagination="{ total: store.total, pageSize: 20, current: store.page, onChange: store.fetchList }">
        <a-table-column title="封面" :width="60">
          <template #default="{ record }">
            <div class="cover-thumb" :style="record.cover_url ? { backgroundImage: `url(${record.cover_url})` } : {}">
              <span v-if="!record.cover_url">🎧</span>
            </div>
          </template>
        </a-table-column>
        <a-table-column title="标题" :ellipsis="true">
          <template #default="{ record }">
            <span class="content-title">{{ record.title }}</span>
          </template>
        </a-table-column>
        <a-table-column title="类型"  data-index="content_type" :width="100" />
        <a-table-column title="集数"  data-index="episodes"     :width="70"  />
        <a-table-column title="主题"  data-index="topic"        :width="120" :ellipsis="true" />
        <a-table-column title="操作"  :width="90">
          <template #default="{ record }">
            <button class="play-btn" @click="play(record.section_id)">
              {{ store.playingId === record.section_id && store.urlLoading ? '加载…' : '播放' }}
            </button>
          </template>
        </a-table-column>
      </a-table>
    </div>

    <!-- 播放 Modal -->
    <a-modal v-model:open="playerVisible" title="有声书试听" :footer="null" width="420" @cancel="stopPlay">
      <div class="player-body">
        <div v-if="store.urlLoading" class="player-loading"><a-spin />获取播放链接…</div>
        <audio v-else-if="store.playUrl" :src="store.playUrl" controls autoplay class="audio-player" />
        <div v-else class="player-empty">暂无播放链接</div>
      </div>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useZAudiobookStore } from '@/stores/zAudiobook.store'

const store = useZAudiobookStore()
const playerVisible = ref(false)
const apiAvailable = false

async function play(sectionId: string) {
  playerVisible.value = true
  await store.fetchPlayUrl(sectionId)
}
function stopPlay() { playerVisible.value = false }
onMounted(() => { if (apiAvailable) store.fetchList() })
</script>

<style scoped>
.z-page { padding-bottom: 16px; }
.pg-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 16px; }
.pg-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 4px; }
.pg-sub { font-size: 12.5px; color: var(--color-text-disabled); }
.status-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); }
.table-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; }
.cover-thumb { width: 40px; height: 40px; border-radius: var(--radius-sm); background: var(--color-bg-active); background-size: cover; background-position: center; display: flex; align-items: center; justify-content: center; font-size: 18px; }
.content-title { font-size: 13px; font-weight: 500; color: var(--color-text-primary); }
.play-btn { padding: 4px 12px; background: var(--color-accent-subtle); border: 1px solid var(--color-accent-border); border-radius: var(--radius-sm); font-size: 12px; color: var(--color-accent); cursor: pointer; transition: all var(--transition-fast); }
.play-btn:hover { background: var(--color-accent); color: white; }
.player-body { padding: 8px 0; text-align: center; }
.player-loading { display: flex; align-items: center; gap: 10px; justify-content: center; padding: 24px; color: var(--color-text-tertiary); }
.audio-player { width: 100%; margin-top: 8px; }
.player-empty { color: var(--color-text-disabled); padding: 24px; }
</style>
