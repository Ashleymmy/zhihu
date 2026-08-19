<script setup lang="ts">
import { ref } from 'vue'
const q = ref('')
</script>

<template>
  <div class="page-stack">
    <header class="page-header">
      <div>
        <p class="eyebrow">ACCOUNTS / SUB</p>
        <h1>子账号管理</h1>
      </div>
    </header>
    <article class="panel" style="padding: 20px;">
      <p style="font-size: 12px; color: var(--ink-soft);">子账号管理用于创建、禁用和监控子账号访问权限。</p>
      <div style="display: flex; gap: 10px; margin-top: 16px;">
        <input v-model="q" placeholder="搜索子账号..." style="flex: 1; padding: 8px 12px; border: 1px solid var(--line); border-radius: var(--radius); font-size: 12px;" />
        <button class="primary-action">搜索</button>
      </div>
    </article>
    <div class="empty-panel" style="border: 1px solid var(--line); border-radius: var(--radius); background: var(--white);">
      <span>子账号管理功能即将上线。</span>
    </div>
  </div>
</template>
