<template>
  <div class="audiobook-view">
    <div class="page-header">
      <h2>有声书内容库</h2>
      <el-button :loading="audiobookStore.loading" @click="audiobookStore.fetchList(1)">刷新</el-button>
    </div>

    <el-table
      :data="audiobookStore.items"
      v-loading="audiobookStore.loading"
      border
      empty-text="暂无数据，点击刷新加载"
      @row-click="onRowClick"
      row-style="cursor:pointer"
    >
      <el-table-column label="封面" width="80">
        <template #default="{ row }">
          <el-image
            v-if="row.topic?.length"
            style="width:48px;height:48px;border-radius:4px"
            src="" fit="cover"
          />
          <el-icon v-else><Headset /></el-icon>
        </template>
      </el-table-column>
      <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip>
        <template #default="{ row }">
          <el-link :href="row.paid_column_url" target="_blank" type="primary">{{ row.title }}</el-link>
        </template>
      </el-table-column>
      <el-table-column prop="content_type" label="类型" width="80" />
      <el-table-column prop="episodes" label="集数" width="70" align="center" />
      <el-table-column label="标签" min-width="120">
        <template #default="{ row }">
          <el-tag
            v-for="t in row.topic"
            :key="t.name"
            size="small"
            style="margin-right:4px"
          >{{ t.name }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button
            link
            type="primary"
            :loading="audiobookStore.urlLoading && audiobookStore.playingSectionId === row.section_id"
            @click.stop="playAudio(row.section_id)"
          >播放/下载</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pagination-bar">
      <el-pagination
        :total="audiobookStore.pagination.total"
        :page-size="audiobookStore.pagination.limit"
        layout="total, prev, pager, next"
        @current-change="audiobookStore.fetchList"
      />
    </div>

    <!-- 音频播放器 -->
    <el-dialog v-model="playerVisible" title="有声书试听" width="500px" @close="stopAudio">
      <el-alert
        title="音频链接有时效性，请勿保存链接，每次播放前重新获取"
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom:12px"
      />
      <div v-if="audiobookStore.urlLoading" style="text-align:center;padding:20px">
        <el-icon class="is-loading"><Loading /></el-icon> 获取音频地址中...
      </div>
      <audio
        v-else-if="audiobookStore.playingUrl"
        :src="audiobookStore.playingUrl"
        controls
        style="width:100%"
      />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Headset, Loading } from '@element-plus/icons-vue'
import { useAudiobookStore } from '@/stores/audiobook.store'
import type { AudioBook } from '@/types/models'

const audiobookStore = useAudiobookStore()
const playerVisible = ref(false)

async function onRowClick(row: AudioBook) {
  await playAudio(row.section_id)
}

async function playAudio(sectionId: string) {
  playerVisible.value = true
  await audiobookStore.fetchPlayUrl(sectionId)
}

function stopAudio() {
  audiobookStore.playingUrl = ''
  audiobookStore.playingSectionId = ''
}

onMounted(() => audiobookStore.fetchList(1))
</script>

<style scoped>
.audiobook-view { padding: 20px; }
.page-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; }
.page-header h2 { margin:0; }
.pagination-bar { display:flex; justify-content:flex-end; margin-top:12px; }
</style>
