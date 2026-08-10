<template>
  <div class="upload-btn-wrap">
    <!-- 已上传的图片预览 -->
    <div v-if="tokens.length" class="preview-list">
      <div v-for="(item, idx) in previewList" :key="idx" class="preview-item">
        <el-image :src="item.url" fit="cover" style="width:80px;height:80px;border-radius:4px" />
        <el-button
          class="remove-btn"
          circle
          size="small"
          :icon="Close"
          @click="removeItem(idx)"
        />
      </div>
    </div>

    <!-- 上传按钮（未达到最大数量时显示）-->
    <el-upload
      v-if="tokens.length < maxCount"
      :auto-upload="false"
      :show-file-list="false"
      accept="image/jpeg,image/png"
      :on-change="onFileChange"
    >
      <el-button :loading="uploading" :disabled="uploading">
        <el-icon><Plus /></el-icon>
        上传截图
      </el-button>
    </el-upload>

    <div class="upload-hint">jpeg / png，2 MB 以内，最多 {{ maxCount }} 张</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import type { UploadFile } from 'element-plus'
import { Close, Plus } from '@element-plus/icons-vue'
import { uploadFile, validateImageFile } from '@/services/basic.service'

const props = withDefaults(defineProps<{
  maxCount?: number
}>(), {
  maxCount: 3,
})

/**
 * v-model: 逗号分隔的 token 字符串（直接传给接口的 image_tokens 参数）
 */
const tokens = defineModel<string>({ default: '' })

interface PreviewItem { token: string; url: string }
const previewList = ref<PreviewItem[]>([])

const tokenArray = computed(() =>
  tokens.value ? tokens.value.split(',').filter(Boolean) : [],
)

const uploading = ref(false)

async function onFileChange(file: UploadFile) {
  const raw = file.raw
  if (!raw) return

  const err = validateImageFile(raw)
  if (err) { ElMessage.error(err); return }

  uploading.value = true
  try {
    const res = await uploadFile(raw)
    previewList.value.push({ token: res.file_token, url: res.file_url })
    tokens.value = [...tokenArray.value, res.file_token].join(',')
    ElMessage.success('上传成功')
  } catch {
    // 错误已由响应拦截器弹窗
  } finally {
    uploading.value = false
  }
}

function removeItem(idx: number) {
  const removed = previewList.value.splice(idx, 1)[0]
  tokens.value = tokenArray.value.filter(t => t !== removed.token).join(',')
}
</script>

<style scoped>
.upload-btn-wrap { display: flex; flex-direction: column; gap: 8px; }
.preview-list { display: flex; flex-wrap: wrap; gap: 8px; }
.preview-item { position: relative; }
.remove-btn {
  position: absolute; top: -8px; right: -8px;
  background: #f56c6c !important;
  border-color: #f56c6c !important;
  color: #fff !important;
}
.upload-hint { font-size: 12px; color: #909399; }
</style>
