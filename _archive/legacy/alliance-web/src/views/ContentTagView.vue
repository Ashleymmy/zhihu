<template>
  <div class="content-tag-view">
    <el-tabs v-model="activeTab">

      <!-- ── 单个查询 ── -->
      <el-tab-pane label="单个标签查询" name="single">
        <el-form
          :model="singleForm"
          label-width="100px"
          style="max-width:640px; margin-top:12px"
        >
          <el-form-item label="内容链接">
            <el-input
              v-model="singleForm.url"
              placeholder="仅支持知乎回答/文章链接"
            />
          </el-form-item>
          <el-form-item label="查询标签">
            <el-checkbox-group v-model="singleForm.tagTypes">
              <el-checkbox :value="1">兴趣</el-checkbox>
              <el-checkbox :value="2">一级领域</el-checkbox>
              <el-checkbox :value="3">内容等级</el-checkbox>
            </el-checkbox-group>
          </el-form-item>
          <el-form-item>
            <el-button
              type="primary"
              :loading="contentTagStore.singleLoading"
              :disabled="!singleForm.url || !singleForm.tagTypes.length"
              @click="doSingleQuery"
            >查询</el-button>
          </el-form-item>
        </el-form>

        <el-card v-if="contentTagStore.singleResult" shadow="never" style="max-width:480px">
          <template #header><span>查询结果</span></template>
          <el-descriptions :column="1" border>
            <el-descriptions-item
              v-if="contentTagStore.singleResult['兴趣'] !== undefined"
              label="兴趣"
            >{{ contentTagStore.singleResult['兴趣'] || '—' }}</el-descriptions-item>
            <el-descriptions-item
              v-if="contentTagStore.singleResult['一级领域'] !== undefined"
              label="一级领域"
            >{{ contentTagStore.singleResult['一级领域'] || '—' }}</el-descriptions-item>
            <el-descriptions-item
              v-if="contentTagStore.singleResult['内容等级'] !== undefined"
              label="内容等级"
            >{{ contentTagStore.singleResult['内容等级'] || '—' }}</el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-tab-pane>

      <!-- ── 批量查询 ── -->
      <el-tab-pane label="批量查询" name="batch">
        <div style="max-width:640px; margin-top:12px">
          <el-alert
            title="批量内容标签查询（模板 3）"
            type="info"
            :closable="false"
            style="margin-bottom:16px"
          >
            ① 使用模板 3 填写内容链接（仅支持回答/文章）→ ② 上传 Excel →
            ③ 自动轮询下载含标签的结果文件
          </el-alert>

          <el-upload
            :auto-upload="false"
            :show-file-list="true"
            accept=".xlsx,.xls"
            :limit="1"
            :on-change="(f: UploadFile) => batchFile = f.raw ?? null"
          >
            <el-button>选择文件（模板 3）</el-button>
          </el-upload>

          <div style="margin-top:16px">
            <el-button
              type="primary"
              :loading="contentTagStore.batchLoading || contentTagStore.batchPolling"
              :disabled="!batchFile"
              @click="doBatch"
            >
              {{ contentTagStore.batchPolling ? '等待结果...' : '上传并查询' }}
            </el-button>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import type { UploadFile } from 'element-plus'
import { useContentTagStore } from '@/stores/content-tag.store'
import { ContentTagType } from '@/constants/enums'

const contentTagStore = useContentTagStore()
const activeTab = ref('single')

const singleForm = reactive({
  url: '',
  tagTypes: [ContentTagType.Interest, ContentTagType.FirstCategory, ContentTagType.ContentLevel] as ContentTagType[],
})

async function doSingleQuery() {
  await contentTagStore.querySingle(singleForm.url, singleForm.tagTypes)
}

const batchFile = ref<File | null>(null)
async function doBatch() {
  if (!batchFile.value) return
  await contentTagStore.submitBatch(batchFile.value)
}
</script>

<style scoped>
.content-tag-view { padding: 20px; }
</style>
