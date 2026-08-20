<template>
  <div class="z-page">
    <div class="pg-header">
      <div><h1 class="pg-title">内容详情搜索</h1><p class="pg-sub">通过知乎内容链接查询标签、分类及内容详情</p></div>
    </div>

    <div class="search-card">
      <a-input-search
        v-model:value="url"
        placeholder="输入知乎内容链接（回答/文章/问题）https://www.zhihu.com/..."
        size="large"
        :loading="loading"
        enter-button="查询详情"
        @search="doSearch"
      />
      <div class="tag-types">
        <span class="tt-label">查询标签类型：</span>
        <a-checkbox-group v-model:value="tagTypes">
          <a-checkbox :value="1">兴趣标签</a-checkbox>
          <a-checkbox :value="2">一级领域</a-checkbox>
          <a-checkbox :value="3">内容等级</a-checkbox>
        </a-checkbox-group>
      </div>
    </div>

    <div v-if="loading" class="result-loading"><a-spin /> 查询中…</div>

    <div v-else-if="result" class="result-card animate-card">
      <div class="result-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        <span>查询成功</span>
        <code class="url-chip">{{ url }}</code>
      </div>
      <div class="result-body">
        <div v-for="(val, key) in result" :key="key" class="result-row">
          <span class="rr-key">{{ key }}</span>
          <div class="rr-val-wrap">
            <template v-if="Array.isArray(val)">
              <span v-for="v in (val as string[])" :key="v" class="tag-chip">{{ v }}</span>
            </template>
            <span v-else class="rr-val">{{ String(val) }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="searched" class="empty-hint">未找到该内容的标签信息，请确认链接是否正确</div>
    <div v-else class="help-card">
      <div class="help-title">如何使用？</div>
      <div class="help-item">① 复制知乎回答/文章/问题链接</div>
      <div class="help-item">② 粘贴到上方搜索框</div>
      <div class="help-item">③ 选择需要查询的标签类型后点击查询</div>
      <div class="help-item">④ 查看内容的兴趣标签、一级领域、内容等级</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { message } from 'ant-design-vue'
import { allianceContentTagApi } from '@/api/alliance'
import type { ContentTagResult } from '@/api/alliance'

const url      = ref('')
const tagTypes = ref<number[]>([1, 2, 3])
const loading  = ref(false)
const searched = ref(false)
const result   = ref<ContentTagResult | null>(null)

async function doSearch(val: string) {
  if (!val) { message.warning('请输入知乎内容链接'); return }
  if (!val.includes('zhihu.com')) { message.warning('请输入合法的知乎链接'); return }
  loading.value = true; searched.value = false; result.value = null
  try {
    result.value = await allianceContentTagApi.getTag(val, tagTypes.value)
    searched.value = true
  } finally { loading.value = false }
}
</script>

<style scoped>
.z-page { padding-bottom: 16px; }
.pg-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 16px; }
.pg-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 4px; }
.pg-sub { font-size: 12.5px; color: var(--color-text-disabled); }
.search-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 24px; margin-bottom: 20px; }
.tag-types { display: flex; align-items: center; gap: 10px; margin-top: 14px; font-size: 13px; color: var(--color-text-tertiary); }
.tt-label { flex-shrink: 0; }
.result-loading { display: flex; align-items: center; gap: 10px; padding: 24px; color: var(--color-text-tertiary); }
.result-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; }
.result-header { display: flex; align-items: center; gap: 8px; padding: 14px 20px; background: var(--color-success-bg); border-bottom: 1px solid var(--color-border); font-size: 13px; font-weight: 600; color: var(--color-success); }
.url-chip { font-family: var(--font-mono); font-size: 11px; color: var(--color-text-tertiary); background: var(--color-bg-active); padding: 2px 8px; border-radius: var(--radius-sm); max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.result-body { padding: 8px 0; }
.result-row { display: flex; align-items: flex-start; gap: 16px; padding: 10px 20px; border-bottom: 1px solid var(--color-border); }
.result-row:last-child { border-bottom: none; }
.rr-key { font-size: 12px; color: var(--color-text-tertiary); min-width: 80px; flex-shrink: 0; padding-top: 3px; }
.rr-val-wrap { display: flex; flex-wrap: wrap; gap: 6px; }
.rr-val { font-size: 13px; color: var(--color-text-secondary); }
.tag-chip { padding: 3px 10px; background: var(--color-accent-subtle); border: 1px solid var(--color-accent-border); border-radius: var(--radius-full); font-size: 12px; color: var(--color-accent); }
.help-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 28px 32px; }
.help-title { font-size: 14px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 14px; }
.help-item { font-size: 13px; color: var(--color-text-tertiary); padding: 5px 0; line-height: 1.6; }
.empty-hint { padding: 40px; text-align: center; color: var(--color-text-disabled); font-size: 14px; }
</style>
