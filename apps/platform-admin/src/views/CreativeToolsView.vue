<script setup lang="ts">
</script>

<template>
  <div class="page-stack">
    <header class="page-header">
      <div>
        <p class="eyebrow">CREATIVE / TOOLS</p>
        <h1>创意工具坊</h1>
      </div>
    </header>
    <div class="workflow-grid" style="grid-template-columns: repeat(3, 1fr);">
      <article class="panel" style="padding: 24px; text-align: center;">
        <div style="display: grid; width: 44px; height: 44px; place-items: center; border-radius: 50%; color: var(--forest); background: #dbe9db; margin: 0 auto 14px; font-size: 20px;">🎨</div>
        <h3 style="margin: 0 0 6px; font-size: 15px;">AI Canvas</h3>
        <p style="margin: 0; font-size: 11px; color: var(--ink-soft);">AI 画布，智能生成推广素材</p>
      </article>
      <article class="panel" style="padding: 24px; text-align: center;">
        <div style="display: grid; width: 44px; height: 44px; place-items: center; border-radius: 50%; color: var(--clay); background: #f1ded9; margin: 0 auto 14px; font-size: 20px;">📝</div>
        <h3 style="margin: 0 0 6px; font-size: 15px;">AI 剧本助手</h3>
        <p style="margin: 0; font-size: 11px; color: var(--ink-soft);">智能生成推广文案和剧本</p>
      </article>
      <article class="panel" style="padding: 24px; text-align: center;">
        <div style="display: grid; width: 44px; height: 44px; place-items: center; border-radius: 50%; color: var(--sun); background: #f4e8c7; margin: 0 auto 14px; font-size: 20px;">🎬</div>
        <h3 style="margin: 0 0 6px; font-size: 15px;">AI 视频创作</h3>
        <p style="margin: 0; font-size: 11px; color: var(--ink-soft);">自动生成推广短视频</p>
      </article>
    </div>
    <div class="empty-panel" style="border: 1px solid var(--line); border-radius: var(--radius); background: var(--white);">
      <span>创意工具正在开发中，敬请期待。</span>
    </div>
  </div>
</template>
