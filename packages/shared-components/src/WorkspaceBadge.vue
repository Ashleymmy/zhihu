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
  padding: 2px 10px;
  border: 1px solid;
  border-radius: 999px;
  font-size: 12px;
  line-height: 20px;
  white-space: nowrap;
}
</style>
