<script setup lang="ts">
defineProps<{
  label: string
  value: string
  hint?: string
}>()
</script>

<template>
  <div class="stat-card">
    <span class="stat-card__label">{{ label }}</span>
    <strong class="stat-card__value">{{ value }}</strong>
    <small v-if="hint" class="stat-card__hint">{{ hint }}</small>
  </div>
</template>

<style scoped>
.stat-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  background: #fff;
}
.stat-card__label {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.45);
}
.stat-card__value {
  font-size: 22px;
  font-weight: 600;
}
.stat-card__hint {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
