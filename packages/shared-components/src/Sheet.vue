<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'

/**
 * 面板（Sheet）：承载需要专注完成的单个动作（提现、审批、打款）。
 * v2 基线：桌面端居中弹层 + 背景后退变暗；移动端底部升起；Esc/遮罩关闭。
 * 按钮文字写具体动作（「确认提现 ¥500.00」），不写「确定」。
 */
const props = withDefaults(defineProps<{ open: boolean; title?: string }>(), { title: '' })
const emit = defineEmits<{ close: [] }>()

watch(() => props.open, v => { document.body.classList.toggle('sheet-on', v) }, { immediate: true })
function onKey(event: KeyboardEvent) { if (event.key === 'Escape' && props.open) emit('close') }
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  document.body.classList.remove('sheet-on')
})
</script>

<template>
  <Teleport to="body">
    <div class="scrim" aria-hidden="true" @click="emit('close')" />
    <div v-if="open" class="sheet" role="dialog" aria-modal="true" :aria-label="title || '面板'">
      <div class="sheet-head">
        <h3>{{ title }}</h3>
        <button type="button" class="more" aria-label="关闭" @click="emit('close')">✕</button>
      </div>
      <div class="sheet-body"><slot /></div>
      <div v-if="$slots.footer" class="sheet-foot"><slot name="footer" /></div>
    </div>
  </Teleport>
</template>

<style scoped>
.sheet-head { display: flex; align-items: center; }
.sheet-head .more { margin-left: auto; }
.sheet-body { margin-top: 8px; }
.sheet-foot { display: flex; gap: 8px; margin-top: 20px; }
.sheet-foot > * { flex: 1; }
@media (prefers-reduced-motion: reduce) { .sheet { transition: none; } }
</style>
