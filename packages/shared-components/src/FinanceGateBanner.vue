<script setup lang="ts">
defineProps<{
  /** 财务门禁标题文案（由应用层传入，组件不依赖 i18n）。 */
  title: string
  hint: string
  gatesLabel: string
  failedGates?: string[]
}>()
</script>

<template>
  <div class="finance-gate-banner" role="alert">
    <strong class="finance-gate-banner__title">{{ title }}</strong>
    <p class="finance-gate-banner__hint">{{ hint }}</p>
    <p v-if="failedGates?.length" class="finance-gate-banner__gates">
      {{ gatesLabel }}：<code v-for="gate in failedGates" :key="gate">{{ gate }}</code>
    </p>
  </div>
</template>

<style scoped>
.finance-gate-banner {
  padding: 12px 16px;
  border: 1px solid #ffd591;
  border-radius: 8px;
  background: #fffbe6;
  color: #613400;
}
.finance-gate-banner__title {
  font-size: 14px;
}
.finance-gate-banner__hint {
  margin: 4px 0 0;
  font-size: 13px;
}
.finance-gate-banner__gates {
  margin: 8px 0 0;
  font-size: 12px;
}
.finance-gate-banner__gates code {
  margin-right: 8px;
  padding: 1px 6px;
  border-radius: 4px;
  background: #fff1b8;
}
</style>
