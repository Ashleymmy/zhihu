<script setup lang="ts">
import type { AnalysisComparison } from './analysis-run';
defineProps<{ rows: AnalysisComparison[] }>();
</script>
<template>
 <table class="value-comparison" aria-label="原值与新值">
  <thead><tr><th scope="col">核对项目</th><th scope="col">原值</th><th scope="col">新值</th></tr></thead>
  <tbody><tr v-for="row in rows" :key="row.label" :class="{changed:row.changed}"><th scope="row">{{row.label}}</th><td>{{row.previous}}</td><td>{{row.incoming}}<small v-if="row.changed">有变化</small></td></tr></tbody>
 </table>
</template>
<style scoped>
.value-comparison{width:100%;table-layout:fixed;border-collapse:collapse;font-size:13px;line-height:1.5;background:var(--paper,#fff)}.value-comparison th,.value-comparison td{padding:8px;border:1px solid var(--line,#dce3e5);white-space:normal;overflow-wrap:anywhere;text-align:left;vertical-align:top;font-variant-numeric:tabular-nums}.value-comparison thead{color:var(--muted,#53656c)}.value-comparison tbody th{font-weight:500}.value-comparison .changed td:last-child{background:var(--warning-soft,#fff4df)}.value-comparison small{display:block;color:#77540e;font-size:11px}
</style>
