<template>
  <div class="comic-view">
    <el-row :gutter="16">
      <!-- 左：剧目搜索 + 列表 -->
      <el-col :span="10">
        <el-card shadow="never">
          <template #header>
            <el-input
              v-model="comicStore.searchTitle"
              placeholder="搜索剧目名称"
              clearable
              @keyup.enter="comicStore.fetchDramas(1)"
              @clear="comicStore.fetchDramas(1)"
            >
              <template #append>
                <el-button :loading="comicStore.dramasLoading" @click="comicStore.fetchDramas(1)">
                  搜索
                </el-button>
              </template>
            </el-input>
          </template>

          <el-table
            :data="comicStore.dramas"
            v-loading="comicStore.dramasLoading"
            highlight-current-row
            @current-change="onDramaSelect"
            height="480"
            empty-text="暂无数据"
          >
            <el-table-column label="封面" width="60">
              <template #default="{ row }">
                <el-image
                  :src="row.tab_artwork"
                  fit="cover"
                  style="width:44px;height:44px;border-radius:4px"
                />
              </template>
            </el-table-column>
            <el-table-column prop="title" label="剧目名称" show-overflow-tooltip />
          </el-table>

          <div class="pagination-bar">
            <el-pagination
              :total="comicStore.dramasPagination.total"
              :page-size="comicStore.dramasPagination.limit"
              layout="prev, pager, next"
              small
              @current-change="comicStore.fetchDramas"
            />
          </div>
        </el-card>
      </el-col>

      <!-- 右：剧集列表 -->
      <el-col :span="14">
        <el-card shadow="never">
          <template #header>
            <span>{{ comicStore.selectedDrama?.title ?? '请选择左侧剧目' }}</span>
          </template>

          <el-empty v-if="!comicStore.selectedDrama" description="请先选择左侧剧目" :image-size="80" />
          <template v-else>
            <el-table
              :data="comicStore.episodes"
              v-loading="comicStore.episodesLoading"
              height="480"
              border
              empty-text="暂无剧集"
            >
              <el-table-column prop="title" label="剧集" min-width="120" />
              <el-table-column label="类型" width="70">
                <template #default="{ row }">
                  <el-tag :type="row.is_pay ? 'warning' : 'success'" size="small">
                    {{ row.is_pay ? '付费' : '免费' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="视频" width="80">
                <template #default="{ row }">
                  <el-link
                    v-if="isValidUrl(row.video_url)"
                    :href="row.video_url"
                    target="_blank"
                    type="primary"
                  >观看</el-link>
                  <span v-else class="muted">无</span>
                </template>
              </el-table-column>
              <el-table-column label="抖音" width="80">
                <template #default="{ row }">
                  <el-link
                    v-if="isValidUrl(row.douyin_video_url)"
                    :href="row.douyin_video_url"
                    target="_blank"
                    type="primary"
                  >观看</el-link>
                  <!-- ⚠️ 官方：「不保证有值或值有效」 -->
                  <span v-else class="muted">无</span>
                </template>
              </el-table-column>
            </el-table>

            <div class="pagination-bar">
              <el-pagination
                :total="comicStore.episodesPagination.total"
                :page-size="comicStore.episodesPagination.limit"
                layout="prev, pager, next"
                small
                @current-change="(p) => comicStore.fetchEpisodes(comicStore.selectedDrama!, p)"
              />
            </div>
          </template>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useComicStore } from '@/stores/comic.store'
import type { ComicDrama } from '@/types/models'

const comicStore = useComicStore()

function onDramaSelect(row: ComicDrama | null) {
  if (row) comicStore.fetchEpisodes(row, 1)
}

/** 过滤无效 URL（官方注明 douyin_video_url 可能无效，示例值为 'httsp://'） */
function isValidUrl(url: string): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

onMounted(() => comicStore.fetchDramas(1))
</script>

<style scoped>
.comic-view { padding: 20px; }
.pagination-bar { display:flex; justify-content:flex-end; margin-top:8px; }
.muted { color: #c0c4cc; font-size:12px; }
</style>
