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
  padding: 15px 20px;
  border: 1px solid var(--sun);
  border-radius: var(--radius);
  background: #f4e8c7;
  color: #8b5d1e;
  box-shadow: var(--shadow);
}
.finance-gate-banner__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
}
.finance-gate-banner__hint {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.7;
}
.finance-gate-banner__gates {
  margin: 10px 0 0;
  font-size: 11px;
  font-family: var(--font-mono);
}
.finance-gate-banner__gates code {
  margin-right: 8px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--white);
  font-size: 10px;
  letter-spacing: 0.05em;
}
</style>
