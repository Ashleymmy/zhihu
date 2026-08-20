<template>
  <div class="z-page">
    <div class="pg-header">
      <div><h1 class="pg-title">盐选内容榜单</h1><p class="pg-sub">知乎盐选榜单内容与上新内容</p></div>
    </div>
    <a-tabs v-model:activeKey="tab" class="z-tabs" @change="(t: any) => onTabChange(t as string)">
      <a-tab-pane key="ranking" tab="盐选榜单">
        <div class="ranking-layout">
          <div class="label-list">
            <div class="label-title">榜单分类</div>
            <div v-for="lb in store.labels" :key="lb.id"
                 :class="['label-item', { active: store.currentRuleId === lb.id }]"
                 @click="selectLabel(lb)">
              <span class="lb-name">{{ lb.name }}</span>
              <span class="lb-type">{{ lb.type === 1 ? '常规' : '推荐' }}</span>
            </div>
          </div>
          <div class="content-area">
            <div class="table-card">
              <a-table :data-source="store.contents" :loading="store.contentsLoading" row-key="id" size="middle"
                :pagination="{ total: store.contentsTotal, pageSize: 20, current: store.contentsPage, onChange: (p: number) => store.fetchContents(store.currentRuleId, p) }"
                :locale="{ emptyText: '← 请在左侧选择榜单' }">
                <a-table-column title="标题">
                  <template #default="{ record }">
                    <a class="link-btn" @click="showDetail(record)">{{ record.title }}</a>
                  </template>
                </a-table-column>
                <a-table-column title="内容类型" data-index="content_type" :width="100" />
                <a-table-column title="分类"     data-index="category"     :width="120" />
                <a-table-column title="主题"     data-index="theme"        :width="100" />
              </a-table>
            </div>
          </div>
        </div>
      </a-tab-pane>

      <a-tab-pane key="new" tab="上新内容">
        <div class="table-card">
          <a-table :data-source="store.newContents" :loading="store.newLoading" row-key="section_title" size="middle">
            <a-table-column title="篇章标题">
              <template #default="{ record }">
                <span class="content-title">{{ record.section_title }}</span>
              </template>
            </a-table-column>
            <a-table-column title="合辑"     data-index="well_title"  :ellipsis="true" />
            <a-table-column title="作者"     data-index="author"      :width="100" />
            <a-table-column title="热度"     data-index="hot_value"   :width="80"  />
            <a-table-column title="主题"     data-index="topic"       :width="100" />
            <a-table-column title="上新时间" data-index="created_at"  :width="160" />
          </a-table>
        </div>
      </a-tab-pane>
    </a-tabs>

    <!-- 详情 Modal -->
    <a-modal v-model:open="detailVisible" title="内容详情" :footer="null" width="480">
      <div v-if="store.detailLoading" style="text-align:center;padding:24px">
        <a-spin />
      </div>
      <div v-else-if="store.detail" class="detail-body">
        <div class="detail-row"><span class="dr-k">标题</span><span class="dr-v">{{ store.detail.title }}</span></div>
        <div class="detail-row"><span class="dr-k">字数</span><span class="dr-v">{{ store.detail.word_count?.toLocaleString() }} 字</span></div>
        <div class="detail-row"><span class="dr-k">发布时间</span><span class="dr-v">{{ store.detail.public_at }}</span></div>
        <div class="detail-row"><span class="dr-k">链接</span><a :href="store.detail.section_url" target="_blank" class="link-btn">查看内容</a></div>
      </div>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useZRankingStore } from '@/stores/zRanking.store'
import type { RankingLabel, RankingContent } from '@/api/alliance'

const store = useZRankingStore()
const tab = ref('ranking'); const detailVisible = ref(false)

async function onTabChange(t: string) {
  if (t === 'new' && !store.newContents.length) await store.fetchNewContents()
}
async function selectLabel(lb: RankingLabel) {
  if (store.currentRuleId === lb.id) return
  await store.fetchContents(lb.id, 1, lb.type)
}
async function showDetail(record: RankingContent) {
  detailVisible.value = true
  await store.fetchDetail(record.id)
}
onMounted(async () => {
  await store.fetchLabels()
  if (store.labels.length) await store.fetchContents(store.labels[0].id, 1, store.labels[0].type)
})
</script>

<style scoped>
.z-page { padding-bottom: 16px; }
.pg-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 16px; }
.pg-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 4px; }
.pg-sub { font-size: 12.5px; color: var(--color-text-disabled); }
.z-tabs :deep(.ant-tabs-nav) { margin-bottom: 16px; }
.ranking-layout { display: grid; grid-template-columns: 200px 1fr; gap: 14px; }
.label-list { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow-y: auto; max-height: 500px; }
.label-title { padding: 12px 14px 8px; font-size: 11.5px; font-weight: 600; color: var(--color-text-disabled); text-transform: uppercase; letter-spacing: 0.08em; }
.label-item { display: flex; align-items: center; justify-content: space-between; padding: 9px 14px; cursor: pointer; transition: all var(--transition-fast); border-bottom: 1px solid var(--color-border); }
.label-item:hover { background: var(--color-bg-hover); }
.label-item.active { background: var(--color-accent-subtle); color: var(--color-accent); }
.lb-name { font-size: 13px; font-weight: 500; }
.lb-type { font-size: 11px; color: var(--color-text-disabled); }
.label-item.active .lb-type { color: var(--color-accent-hover); }
.content-area { min-width: 0; }
.table-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; }
.content-title { font-size: 13px; font-weight: 500; color: var(--color-text-primary); }
.link-btn { font-size: 12px; color: var(--color-accent); cursor: pointer; text-decoration: none; }
.link-btn:hover { text-decoration: underline; }
.detail-body { display: flex; flex-direction: column; gap: 12px; padding: 8px 0; }
.detail-row { display: flex; gap: 12px; align-items: baseline; }
.dr-k { font-size: 12px; color: var(--color-text-tertiary); min-width: 60px; flex-shrink: 0; }
.dr-v { font-size: 13px; color: var(--color-text-secondary); }
</style>
