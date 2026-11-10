<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { http } from '../stores/auth'

/** 巡检中心：归属/金额/关系的一致性检查结果（demo mock 契约，正式巡检接口同路径替换） */
interface InspectionCard { name: string; diffs: number; unit: string; note: string }
interface InspectionRecord { time: string; item: string; duration: string; result: string; diffs: string }
interface Inspections { cards: InspectionCard[]; records: InspectionRecord[] }

const data = ref<Inspections | null>(null)
const loading = ref(true)
const running = ref(false)
const notice = ref('')

const unwrap = <T,>(r: unknown): T => {
  const o = r as { data?: T } | null
  return o && typeof o === 'object' && 'data' in o && o.data !== undefined ? o.data : (r as T)
}

async function load() {
  loading.value = true
  try { data.value = unwrap(await http.get<{ code: number; data: Inspections }>('/insights/dev-inspections')) }
  catch { data.value = null }
  finally { loading.value = false }
}
async function runAll() {
  if (running.value) return
  running.value = true
  notice.value = ''
  try {
    const r = unwrap<{ records: InspectionRecord[] }>(await http.post('/insights/dev-inspections/run', {}))
    if (data.value) data.value.records = r.records
    notice.value = '巡检已重跑，结果已更新。'
  } catch { notice.value = '重跑失败，请稍后再试。' }
  finally { running.value = false }
}
onMounted(load)
</script>

<template>
  <div class="page-stack inspect-page">
    <div class="bento enter">
      <article v-for="(c, i) in data?.cards ?? []" :key="c.name" class="card lift" :style="{ '--s': 4, '--i': i }">
        <div class="card-h"><h3>{{ c.name }}</h3><span class="chip r" :class="c.diffs ? 'clay' : 'soft'">{{ c.diffs ? '有差异' : '正常' }}</span></div>
        <div class="big num" style="font-size:30px">{{ c.diffs }}<small>{{ c.unit }}</small></div>
        <p class="muted" style="font-size:12.5px;margin-top:4px">{{ c.note }}</p>
      </article>

      <section class="card" style="--s:12;--i:3" aria-labelledby="inspect-records">
        <div class="card-h">
          <h3 id="inspect-records">巡检记录</h3>
          <button class="btn ink" style="height:30px;padding:0 12px;font-size:12.5px" :disabled="running" @click="runAll">{{ running ? '正在重跑…' : '立即重跑' }}</button>
        </div>
        <p v-if="notice" class="inspect-notice" role="status">{{ notice }}</p>
        <div v-if="data?.records.length" class="inspect-table" role="table" aria-label="巡检记录">
          <div class="inspect-tr inspect-th" role="row">
            <span>时间</span><span>巡检项</span><span>耗时</span><span>结果</span><span style="text-align:right">差异</span>
          </div>
          <div v-for="(r, i) in data.records" :key="i" class="inspect-tr" role="row">
            <span class="muted">{{ r.time }}</span>
            <b>{{ r.item }}</b>
            <span class="muted num">{{ r.duration }}</span>
            <span><i class="inspect-dot" :data-ok="r.result === '通过'" />{{ r.result }}</span>
            <span class="num" style="text-align:right">{{ r.diffs }}</span>
          </div>
        </div>
        <div v-else-if="!loading" class="bento-empty home-empty"><b>还没有巡检记录</b><p>点击「立即重跑」生成第一轮结果。</p></div>
        <p v-else role="status" class="muted" style="font-size:13px">正在读取巡检记录…</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.inspect-page { min-width: 0; }
.inspect-notice { margin: 0 0 10px; font-size: 12.5px; color: var(--clay-deep); }
.inspect-table { display: grid; }
.inspect-tr { display: grid; grid-template-columns: 72px 1fr 70px 110px 80px; gap: 10px; align-items: center; padding: 11px 4px; font-size: 13px; border-top: 1px solid var(--line-2); }
.inspect-tr:first-child { border-top: 0; }
.inspect-th { padding: 0 4px 10px; border-top: 0; color: var(--muted); font-size: 12px; }
.inspect-dot { display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 50%; background: var(--clay); }
.inspect-dot[data-ok="true"] { background: #4e9a4a; }
@media (max-width: 720px) {
  .inspect-tr { grid-template-columns: 60px 1fr 90px; }
  .inspect-tr > :nth-child(3), .inspect-tr > :nth-child(5) { display: none; }
}
</style>
