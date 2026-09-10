<script setup lang="ts">
import { inject, onMounted, ref } from 'vue'
import type { CoreWorkspace } from './core-workspace'
const workspace = inject<CoreWorkspace>('opc')!
const message = ref('正在读取财务状态…')
onMounted(async () => {
  try {
    const result = await workspace.http.get<{ message: string }>('/finance')
    message.value = result.message
  } catch {
    message.value = '财务状态暂时不可用，请稍后重试'
  }
})
</script>
<template>
  <section class="page-stack">
    <header class="page-header">
      <div>
        <p class="eyebrow">OPC / FINANCE</p>
        <h1>财务中心</h1>
      </div>
    </header>
    <article class="panel" style="padding: 28px">
      <h2>公共财务尚未接入</h2>
      <p>{{ message }}</p>
      <p>已接入业务的历史账目可从对应业务模块查看。</p>
    </article>
  </section>
</template>
