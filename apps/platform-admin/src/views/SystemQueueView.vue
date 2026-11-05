<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { http } from '../stores/auth'

/** 任务队列：收益计算 / 回传 / 通知等后台任务的执行流水（demo mock 契约） */
interface QueueRow { task: string; type: string; at: string; status: string; duration: string }
interface QueueData { backlog: number; successRate: string; rows: QueueRow[] }

const data = ref<QueueData | null>(null)
const loading = ref(true)

const unwrap = <T,>(r: unknown): T => {
  const o = r as { data?: T } | null
  return o && typeof o === 'object' && 'data' in o && o.data !== undefined ? o.data : (r as T)
}

async function load() {
  loading.value = true
  try { data.value = unwrap(await http.get<{ code: number; data: QueueData }>('/insights/dev-queue')) }
  catch { data.value = null }
  finally { loading.value = false }
}
onMounted(load)
</script>

<template>
  <div class="page-stack queue-page">
    <div class="bento enter">
      <article class="card" style="--s:12;--i:0" aria-labelledby="queue-title">
        <div class="card-h">
          <h3 id="queue-title">任务队列</h3>
          <span class="muted r" style="font-size:12px">收益计算 / 回传 / 通知</span>
        </div>
        <div v-if="data" class="queue-summary">
          <span class="chip" :class="data.backlog ? 'clay' : 'soft'">{{ data.backlog ? `${data.backlog} 条积压` : '队列当前无积压' }}</span>
          <span class="muted" style="font-size:12.5px">近 24 小时成功率 <b style="color:var(--ink)">{{ data.successRate }}</b></span>
        </div>
        <div v-if="data?.rows.length" class="queue-table" role="table" aria-label="任务执行流水">
          <div class="queue-tr queue-th" role="row">
            <span>任务</span><span>类型</span><span>提交时间</span><span>状态</span><span style="text-align:right">耗时</span>
          </div>
          <div v-for="(r, i) in data.rows" :key="i" class="queue-tr" role="row">
            <b>{{ r.task }}</b>
            <span class="muted">{{ r.type }}</span>
            <span class="muted num">{{ r.at }}</span>
            <span><i class="queue-dot" :data-warn="r.status !== '完成'" />{{ r.status }}</span>
            <span class="num muted" style="text-align:right">{{ r.duration }}</span>
          </div>
        </div>
        <div v-else-if="!loading" class="bento-empty home-empty"><b>队列为空</b><p>同步、回传和通知任务执行后会出现在这里。</p></div>
        <p v-else role="status" class="muted" style="font-size:13px">正在读取队列…</p>
      </article>
    </div>
  </div>
</template>

<style scoped>
.queue-page { min-width: 0; }
.queue-summary { display: flex; align-items: center; gap: 14px; margin-bottom: 12px; }
.queue-table { display: grid; }
.queue-tr { display: grid; grid-template-columns: 1fr 64px 80px 120px 70px; gap: 10px; align-items: center; padding: 11px 4px; font-size: 13px; border-top: 1px solid var(--line-2); }
.queue-tr:first-child { border-top: 0; }
.queue-th { padding: 0 4px 10px; border-top: 0; color: var(--muted); font-size: 12px; }
.queue-dot { display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 50%; background: #4e9a4a; }
.queue-dot[data-warn="true"] { background: var(--clay); }
@media (max-width: 720px) {
  .queue-tr { grid-template-columns: 1fr 100px; }
  .queue-tr > :nth-child(2), .queue-tr > :nth-child(3), .queue-tr > :nth-child(5) { display: none; }
}
</style>
