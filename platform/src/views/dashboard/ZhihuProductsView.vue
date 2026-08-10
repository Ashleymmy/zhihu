<template>
  <div class="z-page">
    <div class="pg-header">
      <div><h1 class="pg-title">选品内容库</h1><p class="pg-sub">浏览可推广的任务与产品，选择合适的推广方向</p></div>
      <a-select v-model:value="ch.selectedId" placeholder="选择渠道" style="width:220px" @change="(val: any) => onChannelChange(val)">
        <a-select-option v-for="o in ch.channelOptions" :key="o.value" :value="o.value">{{ o.label }}</a-select-option>
      </a-select>
    </div>

    <!-- 筛选 -->
    <div class="filter-row">
      <a-input v-model:value="searchKw" placeholder="搜索任务名称…" style="width:200px" allow-clear @change="filterTasks" />
      <div class="filter-chips">
        <span v-for="f in statusOpts" :key="f.v" :class="['chip', { active: statusF === f.v }]" @click="statusF = f.v">{{ f.l }}</span>
      </div>
    </div>

    <!-- 卡片网格 -->
    <div v-if="filtered.length" class="product-grid">
      <div v-for="(t, i) in filtered" :key="t.id" class="product-card animate-card" :style="{ animationDelay: (i % 9) * 40 + 'ms' }">
        <div class="pc-header">
          <div class="pc-icon">{{ productIcon(t.product_name) }}</div>
          <span :class="['badge', t.status === '开启' ? 'badge-success' : 'badge-warning']"><span class="badge-dot"/>{{ t.status }}</span>
        </div>
        <div class="pc-name">{{ t.product_name }}</div>
        <div class="pc-task">{{ t.task_name }}</div>
        <div class="pc-meta-row">
          <span class="pc-meta-item"><span class="pm-k">结算</span><span class="pm-v">{{ t.pay_caliber }}</span></span>
          <span class="pc-meta-item"><span class="pm-k">有效期</span><span class="pm-v">{{ t.expiry_time?.slice(0, 10) || '长期' }}</span></span>
        </div>
        <div v-if="t.media_platform" class="pc-platforms">
          <span v-for="p in splitPlatforms(t.media_platform)" :key="p" class="platform-tag">{{ p.replace('KOC', '') }}</span>
        </div>
        <div class="pc-footer">
          <span class="pc-id mono-sm">ID: {{ t.id }}</span>
          <button class="btn-select" @click="selectTask(t)">选此任务</button>
        </div>
      </div>
    </div>
    <div v-else-if="!ch.selectedId" class="empty-hint">← 请先选择渠道</div>
    <div v-else class="empty-hint">暂无符合条件的任务</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { useZChannelStore } from '@/stores/zChannel.store'
import { useZTaskStore }    from '@/stores/zTask.store'
import type { PopularizeTask } from '@/api/alliance'

const ch = useZChannelStore(); const tk = useZTaskStore(); const router = useRouter()
const searchKw = ref(''); const statusF = ref('all')
const statusOpts = [{ v:'all',l:'全部' },{ v:'开启',l:'开启中' },{ v:'暂停',l:'暂停' }]

const filtered = computed(() => tk.tasks
  .filter(t => statusF.value === 'all' || t.status === statusF.value)
  .filter(t => !searchKw.value || t.task_name.includes(searchKw.value) || t.product_name.includes(searchKw.value)))

const ICONS: Record<string, string> = { '知乎': '🔵', '夸克': '🌊', '番茄': '🍅', '红果': '🎬', '得物': '👟' }
function productIcon(name: string) { for (const k of Object.keys(ICONS)) if (name?.includes(k)) return ICONS[k]; return '📦' }
function splitPlatforms(p: string) { return p?.split('、').slice(0, 4) ?? [] }
function filterTasks() {}
async function onChannelChange(id: string) { if (id) await tk.fetchTasks(id) }
function selectTask(t: PopularizeTask) {
  message.success(`已选择任务：${t.task_name}，跳转创建计划`)
  router.push({ path: '/dashboard/z-plans', query: { task_id: t.id, channelId: ch.selectedId } })
}
onMounted(async () => { await ch.fetchChannels(); if (ch.selectedId) await tk.fetchTasks(ch.selectedId) })
</script>

<style scoped>
.z-page { padding-bottom: 16px; }
.pg-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 16px; }
.pg-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 4px; }
.pg-sub { font-size: 12.5px; color: var(--color-text-disabled); }
.filter-row { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
.filter-chips { display: flex; gap: 6px; }
.chip { padding: 5px 12px; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-full); font-size: 12px; color: var(--color-text-tertiary); cursor: pointer; transition: all var(--transition-fast); }
.chip.active,.chip:hover { background: var(--color-accent-subtle); border-color: var(--color-accent-border); color: var(--color-accent); }
.product-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.product-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-xl); padding: 20px; display: flex; flex-direction: column; gap: 10px; cursor: default; transition: border-color var(--transition-base), transform var(--transition-base); opacity: 0; }
.product-card:hover { border-color: var(--color-border-hover); transform: translateY(-2px); }
.pc-header { display: flex; align-items: center; justify-content: space-between; }
.pc-icon { font-size: 28px; }
.pc-name { font-family: var(--font-display); font-size: 15px; font-weight: 700; color: var(--color-text-primary); }
.pc-task { font-size: 12.5px; color: var(--color-text-tertiary); line-height: 1.5; }
.pc-meta-row { display: flex; gap: 12px; flex-wrap: wrap; }
.pc-meta-item { display: flex; align-items: center; gap: 5px; }
.pm-k { font-size: 11px; color: var(--color-text-disabled); }
.pm-v { font-size: 12px; color: var(--color-text-secondary); font-family: var(--font-mono); }
.pc-platforms { display: flex; flex-wrap: wrap; gap: 5px; }
.platform-tag { padding: 2px 8px; background: var(--color-bg-active); border-radius: var(--radius-full); font-size: 11px; color: var(--color-text-tertiary); }
.pc-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; border-top: 1px solid var(--color-border); padding-top: 10px; }
.mono-sm { font-size: 11px; font-family: var(--font-mono); color: var(--color-text-disabled); }
.btn-select { padding: 5px 14px; background: var(--color-accent); border: none; border-radius: var(--radius-md); font-size: 12px; font-weight: 600; color: white; cursor: pointer; transition: all var(--transition-fast); }
.btn-select:hover { background: var(--color-accent-hover); box-shadow: var(--shadow-glow); }
.empty-hint { padding: 40px; text-align: center; color: var(--color-text-disabled); font-size: 14px; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); }
</style>
