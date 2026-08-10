<template>
  <div class="ranking-view">
    <el-tabs v-model="activeTab">

      <!-- ── 盐选榜单 ── -->
      <el-tab-pane label="盐选榜单" name="ranking">
        <el-row :gutter="16" style="margin-top:12px">
          <!-- 左：榜单列表 -->
          <el-col :span="7">
            <el-card header="榜单" shadow="never">
              <el-skeleton :loading="rankingStore.labelsLoading" animated>
                <el-menu
                  :default-active="selectedLabel?.id"
                  @select="onLabelSelect"
                >
                  <el-menu-item
                    v-for="label in rankingStore.labels"
                    :key="label.id"
                    :index="label.id"
                  >
                    <el-tag :type="label.type === 2 ? 'warning' : ''" size="small" style="margin-right:6px">
                      {{ label.type === 2 ? '推荐' : '常规' }}
                    </el-tag>
                    {{ label.name }}
                  </el-menu-item>
                </el-menu>
              </el-skeleton>
            </el-card>
          </el-col>

          <!-- 右：内容列表 -->
          <el-col :span="17">
            <el-card shadow="never">
              <template #header>
                <span>{{ selectedLabel?.name ?? '请选择左侧榜单' }}</span>
              </template>

              <el-empty v-if="!selectedLabel" description="请先选择左侧榜单" :image-size="80" />
              <template v-else>
                <!-- 推荐书单特有字段提示 -->
                <el-alert
                  v-if="selectedLabel.type === 2"
                  title="推荐书单包含「内容等级、一级/二级领域、兴趣标签、消费价值」字段"
                  type="info"
                  :closable="false"
                  show-icon
                  style="margin-bottom:10px"
                />

                <el-table
                  :data="rankingStore.contents"
                  v-loading="rankingStore.contentsLoading"
                  border
                  empty-text="暂无内容"
                  @row-click="onRowClick"
                  row-style="cursor:pointer"
                >
                  <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip>
                    <template #default="{ row }">
                      <el-link :href="row.url" target="_blank" type="primary">{{ row.title }}</el-link>
                    </template>
                  </el-table-column>
                  <el-table-column prop="content_type" label="类型" width="100" />
                  <el-table-column prop="category" label="分类" width="80" />
                  <template v-if="selectedLabel.type === 2">
                    <el-table-column prop="bayes_first_category" label="一级领域" width="80" />
                    <el-table-column prop="bayes_second_category" label="二级领域" width="80" />
                    <el-table-column prop="theme" label="兴趣标签" min-width="80" show-overflow-tooltip />
                  </template>
                </el-table>

                <div class="pagination-bar">
                  <el-pagination
                    :total="rankingStore.contentsPagination.total"
                    :page-size="rankingStore.contentsPagination.limit"
                    layout="total, prev, pager, next"
                    @current-change="(p) => rankingStore.fetchContents(selectedLabel!.id, p, selectedLabel!.type)"
                  />
                </div>
              </template>
            </el-card>
          </el-col>
        </el-row>
      </el-tab-pane>

      <!-- ── 上新内容 ── -->
      <el-tab-pane label="上新内容" name="new">
        <div style="display:flex; justify-content:flex-end; margin:12px 0">
          <el-button :loading="rankingStore.newContentsLoading" @click="rankingStore.fetchNewContents()">
            刷新
          </el-button>
        </div>
        <el-table
          :data="sortedNew"
          v-loading="rankingStore.newContentsLoading"
          border
          empty-text="暂无数据，点击刷新加载"
        >
          <el-table-column prop="section_title" label="标题" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">
              <el-link :href="row.url" target="_blank" type="primary">{{ row.section_title }}</el-link>
            </template>
          </el-table-column>
          <el-table-column prop="well_title" label="专栏" min-width="160" show-overflow-tooltip />
          <el-table-column prop="author" label="作者" width="120" show-overflow-tooltip />
          <el-table-column label="热度值" width="80" align="right">
            <template #default="{ row }">
              {{ row.hot_value || '—' }}
            </template>
          </el-table-column>
          <el-table-column prop="topic" label="标签" min-width="120" show-overflow-tooltip />
          <el-table-column prop="created_at" label="发布时间" width="160" />
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- 内容详情弹窗 -->
    <el-dialog v-model="detailDialogVisible" title="内容详情" width="560px">
      <el-skeleton v-if="rankingStore.detailLoading" :rows="5" animated />
      <template v-else-if="rankingStore.detail">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="标题">{{ rankingStore.detail.title }}</el-descriptions-item>
          <el-descriptions-item label="字数">{{ rankingStore.detail.word_count?.toLocaleString() }} 字</el-descriptions-item>
          <el-descriptions-item label="发布时间">{{ rankingStore.detail.public_at }}</el-descriptions-item>
          <el-descriptions-item label="专栏">
            <el-link :href="rankingStore.detail.section_url" target="_blank">
              {{ rankingStore.detail.section_title }}
            </el-link>
          </el-descriptions-item>
        </el-descriptions>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRankingStore } from '@/stores/ranking.store'
import type { RankingLabel, RankingContent } from '@/types/models'

const rankingStore = useRankingStore()
const activeTab = ref('ranking')
const selectedLabel = ref<RankingLabel | null>(null)
const detailDialogVisible = ref(false)

function onLabelSelect(id: string) {
  const label = rankingStore.labels.find(l => l.id === id)
  if (!label) return
  selectedLabel.value = label
  rankingStore.fetchContents(id, 1, label.type)
}

async function onRowClick(row: RankingContent) {
  detailDialogVisible.value = true
  rankingStore.detail = null
  await rankingStore.fetchDetail(row.id)
}

/** 按热度值降序排序（空值排最后）*/
const sortedNew = computed(() =>
  [...rankingStore.newContents].sort((a, b) => {
    const va = parseFloat(a.hot_value) || 0
    const vb = parseFloat(b.hot_value) || 0
    return vb - va
  }),
)

onMounted(() => rankingStore.fetchLabels())
</script>

<style scoped>
.ranking-view { padding: 20px; }
.pagination-bar { display:flex; justify-content:flex-end; margin-top:12px; }
</style>
