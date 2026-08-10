<template>
  <div class="z-page">
    <div class="pg-header">
      <div><h1 class="pg-title">素材管理</h1><p class="pg-sub">上传并管理推广所需的图片素材，获取 file_token 用于举报截图</p></div>
      <label class="btn-accent-sm upload-label">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        上传素材
        <input type="file" accept="image/jpeg,image/png" multiple style="display:none" @change="onUpload" />
      </label>
    </div>

    <div class="alert-info" style="margin-bottom:16px">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      仅支持 jpeg/png 格式，单文件不超过 2MB；file_token 可用于截流举报截图参数
    </div>

    <div v-if="uploading" class="upload-progress">
      <a-spin /> 上传中，请稍候…
    </div>

    <div v-if="materials.length" class="materials-grid">
      <div v-for="(m, i) in materials" :key="m.token" class="material-card animate-card" :style="{ animationDelay: i * 40 + 'ms' }">
        <div class="mat-img-wrap">
          <img :src="m.url" :alt="m.name" class="mat-img" @error="(e: any) => e.target.style.display='none'" />
        </div>
        <div class="mat-info">
          <div class="mat-name">{{ m.name }}</div>
          <div class="mat-token mono-sm">{{ m.token }}</div>
        </div>
        <button class="mat-copy-btn" @click="copyToken(m.token)">复制 Token</button>
      </div>
    </div>
    <div v-else-if="!uploading" class="empty-hint">暂无素材，点击右上角上传图片</div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { message } from 'ant-design-vue'
import { allianceInterceptApi } from '@/api/alliance'

interface MaterialItem { name: string; token: string; url: string }

const materials = ref<MaterialItem[]>([])
const uploading = ref(false)

async function onUpload(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files ?? [])
  if (!files.length) return
  uploading.value = true
  try {
    for (const file of files) {
      if (file.size > 2 * 1024 * 1024) { message.error(`${file.name} 超过 2MB，已跳过`); continue }
      const res = await allianceInterceptApi.uploadImage(file)
      materials.value.unshift({ name: file.name, token: res.file_token, url: res.file_url })
    }
    message.success('上传完成')
  } finally { uploading.value = false }
}

async function copyToken(token: string) {
  await navigator.clipboard.writeText(token)
  message.success('已复制 file_token')
}
</script>

<style scoped>
.z-page { padding-bottom: 16px; }
.pg-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 12px; }
.pg-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 4px; }
.pg-sub { font-size: 12.5px; color: var(--color-text-disabled); }
.btn-accent-sm { padding: 8px 16px; background: var(--color-accent); border: none; border-radius: var(--radius-md); font-size: 13px; font-weight: 600; color: white; cursor: pointer; transition: all var(--transition-fast); display: inline-flex; align-items: center; gap: 7px; }
.btn-accent-sm:hover { background: var(--color-accent-hover); box-shadow: var(--shadow-glow); }
.upload-label { cursor: pointer; }
.alert-info { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: var(--color-info-bg); border: 1px solid rgba(59,130,246,0.2); border-radius: var(--radius-md); font-size: 12.5px; color: var(--color-info); }
.upload-progress { display: flex; align-items: center; gap: 10px; padding: 20px; color: var(--color-text-tertiary); }
.materials-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.material-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; display: flex; flex-direction: column; transition: border-color var(--transition-fast); opacity: 0; }
.material-card:hover { border-color: var(--color-border-hover); }
.mat-img-wrap { height: 140px; background: var(--color-bg-tertiary); display: flex; align-items: center; justify-content: center; overflow: hidden; }
.mat-img { width: 100%; height: 100%; object-fit: cover; }
.mat-info { padding: 10px 12px 4px; }
.mat-name { font-size: 12.5px; font-weight: 500; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 4px; }
.mat-token { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mono-sm { font-size: 10.5px; font-family: var(--font-mono); color: var(--color-text-disabled); }
.mat-copy-btn { margin: 8px 12px 12px; padding: 5px; background: var(--color-accent-subtle); border: 1px solid var(--color-accent-border); border-radius: var(--radius-sm); font-size: 11.5px; color: var(--color-accent); cursor: pointer; transition: all var(--transition-fast); }
.mat-copy-btn:hover { background: var(--color-accent); color: white; }
.empty-hint { padding: 40px; text-align: center; color: var(--color-text-disabled); font-size: 14px; background: var(--color-bg-elevated); border: 1px dashed var(--color-border); border-radius: var(--radius-lg); }
</style>
