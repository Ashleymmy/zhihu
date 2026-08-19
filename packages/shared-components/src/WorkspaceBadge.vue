<script setup lang="ts">
import type { GlobalRole } from '@zhihu-koc/shared-contracts'
import { computed } from 'vue'
import { roleTone } from './role-tone'

const props = defineProps<{
  role: GlobalRole | null
  label: string
}>()

const tone = computed(() => roleTone(props.role))
</script>

<template>
  <span
    class="workspace-badge"
    :style="{ backgroundColor: `${tone}1a`, color: tone, borderColor: `${tone}66` }"
  >
    {{ label }}
  </span>
</template>

<style scoped>
.workspace-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  font-size: 11px;
  font-weight: 600;
  line-height: 20px;
  white-space: nowrap;
  font-family: var(--font-sans);
  background: var(--white);
  color: var(--ink);
}
</style>
