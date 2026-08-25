<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useAuthStore, apis } from '../stores/auth'

interface AudioContent { title: string; contentType?: string; author?: string; topic?: { name: string }[] | string; audioBookUrl?: string; episodes?: number }
interface ComicDrama { title: string; dramaId: string; storyUrl?: string; tab_artwork?: string }

const tab = ref<'audio' | 'comic'>('audio')
const audios = ref<AudioContent[]>([])
const comics = ref<ComicDrama[]>([])
const loading = ref(true)
const error = ref('')

function unwrap(resp: any): any[] {
  if (Array.isArray(resp)) return resp
  return resp?.data ?? []
}

function topicText(topic: AudioContent['topic']) {
  if (!topic) return '—'
  if (typeof topic === 'string') return topic || '—'
  return topic.map((t) => t.name).join(' / ') || '—'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    if (tab.value === 'audio') audios.value = unwrap(await apis.story.audioContents({ limit: 50 }))
    else comics.value = unwrap(await apis.story.comicDramas({ limit: 50 }))
  }
  catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}

function switchTab(next: 'audio' | 'comic') {
  if (tab.value === next) return
  tab.value = next
  load()
}

onMounted(load)
</script>

<template>
  <div class="page-stack">
    <router-link to="/zhihu-story" class="back-link">← 返回知乎故事</router-link>
    <header class="page-header">
      <div>
        <p class="section-index">07 / 有声书 / 漫画</p>
        <h1>有声书 / 漫画</h1>
        <p>知乎盐选有声书与漫剧剧目，实时来自知乎开放平台。</p>
      </div>
      <div class="page-actions">
        <button :class="tab === 'audio' ? 'primary-action' : 'row-action'" @click="switchTab('audio')">有声书</button>
        <button :class="tab === 'comic' ? 'primary-action' : 'row-action'" @click="switchTab('comic')">漫剧</button>
      </div>
    </header>

    <div v-if="error" style="padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 13px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

    <article class="panel data-panel" style="min-height: 300px;">
      <div class="list-toolbar">
        <span class="toolbar-title">{{ tab === 'audio' ? '有声书列表' : '漫剧剧目' }}</span>
        <span class="toolbar-count">{{ tab === 'audio' ? audios.length : comics.length }}</span>
      </div>
      <div v-if="loading" class="skeleton-row" aria-label="加载中"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
      <template v-else-if="tab === 'audio'">
        <div v-if="!audios.length" class="empty-panel"><span>暂无有声书内容。</span></div>
        <div v-else class="responsive-table">
          <table>
            <thead><tr><th>标题</th><th>类型</th><th>话题标签</th><th>集数</th><th>链接</th></tr></thead>
            <tbody>
              <tr v-for="(a, i) in audios" :key="i">
                <td><strong>{{ a.title }}</strong></td>
                <td style="font-size: 13px;">{{ a.contentType || '—' }}</td>
                <td style="font-size: 13px;">{{ topicText(a.topic) }}</td>
                <td style="font-family: var(--font-mono); font-size: 12px;">{{ a.episodes ?? '—' }}</td>
                <td><a v-if="a.audioBookUrl" :href="a.audioBookUrl" target="_blank" class="row-action" style="text-decoration: none;">打开</a></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <template v-else>
        <div v-if="!comics.length" class="empty-panel"><span>暂无漫剧剧目。</span></div>
        <div v-else class="responsive-table">
          <table>
            <thead><tr><th>剧目</th><th>剧目 ID</th><th>链接</th></tr></thead>
            <tbody>
              <tr v-for="c in comics" :key="c.dramaId">
                <td><strong>{{ c.title }}</strong></td>
                <td style="font-family: var(--font-mono); font-size: 12px;">{{ c.dramaId }}</td>
                <td><a v-if="c.storyUrl" :href="c.storyUrl" target="_blank" class="row-action" style="text-decoration: none;">打开</a></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </article>
  </div>
</template>
