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
  gap: 8px;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--white);
  box-shadow: var(--shadow);
  min-height: 118px;
  transition: all 0.16s ease;
}
.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 6px 6px 0 rgba(32, 41, 35, 0.13);
}
.stat-card__label {
  font-size: 10px;
  color: var(--ink-soft);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-family: var(--font-mono);
}
.stat-card__value {
  font-size: 29px;
  font-weight: 600;
  font-family: var(--font-display);
  letter-spacing: -0.065em;
  color: var(--ink);
}
.stat-card__hint {
  font-size: 11px;
  color: var(--moss);
}
</style>
