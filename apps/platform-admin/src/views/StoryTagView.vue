<script setup lang="ts">
import { ref } from 'vue'
import { useAuthStore, apis } from '../stores/auth'

/** 内容标签查询（知乎 OpenApi §2.12.1）：输入回答/文章链接，返回兴趣/一级领域/内容等级 */
const url = ref('')
const loading = ref(false)
const error = ref('')
const result = ref<Record<string, string> | null>(null)

async function query() {
  error.value = ''
  result.value = null
  const target = url.value.trim()
  if (!/^https?:\/\/(www\.)?zhihu\.com\/(answer|question)|^https?:\/\/zhuanlan\.zhihu\.com\//.test(target)) {
    error.value = '仅支持知乎回答或文章链接（zhihu.com / zhuanlan.zhihu.com）'
    return
  }
  loading.value = true
  try {
    const resp: any = await apis.story.contentTag(target)
    result.value = resp?.data ?? null
    if (!result.value || !Object.keys(result.value).length) error.value = '未查询到该内容的标签数据'
  }
  catch (e: any) { error.value = e?.message ?? String(e) }
  finally { loading.value = false }
}
</script>

<template>
  <div class="page-stack">
    <router-link to="/zhihu-story" class="back-link">← 返回知乎故事</router-link>
    <header class="page-header">
      <div>
        <p class="section-index">08 / 内容标签</p>
        <h1>内容标签</h1>
        <p>查询知乎回答/文章的兴趣标签、一级领域与内容等级，辅助选题判断。</p>
      </div>
    </header>

    <article class="panel" style="padding: 24px;">
      <div class="form-field">
        <label>内容链接</label>
        <div style="display: flex; gap: 10px;">
          <input v-model="url" placeholder="https://www.zhihu.com/answer/... 或 https://zhuanlan.zhihu.com/p/..." style="flex: 1;" @keyup.enter="query" />
          <button class="primary-action" :disabled="loading" @click="query">{{ loading ? '查询中...' : '查询标签' }}</button>
        </div>
      </div>

      <div v-if="error" style="margin-top: 12px; padding: 12px 16px; background: #f1ded9; color: #964639; font-size: 13px; border-radius: var(--radius); border: 1px solid var(--clay);">{{ error }}</div>

      <div v-if="result" style="margin-top: 20px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px;">
        <div v-for="(value, key) in result" :key="key" class="panel" style="padding: 16px;">
          <p style="margin: 0; color: #737a80; font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.1em;">{{ key }}</p>
          <strong style="display: block; margin-top: 6px; font-size: 15px;">{{ value || '—' }}</strong>
        </div>
      </div>
    </article>
  </div>
</template>
