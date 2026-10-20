<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
/**
 * 详情面板：从右侧弹入的浮动面板，背景只轻微变暗，列表仍然看得见。
 * 传入 position 时，头部出现「上一条 / 下一条」，↑↓ 键也可以切换（输入框里不拦截）。
 */
const props = defineProps<{ open: boolean; title: string; position?: { index: number; total: number } }>();
const emit = defineEmits<{ close: []; prev: []; next: [] }>();
const dialog = ref<HTMLDialogElement>();
watch(
  () => props.open,
  async (open) => {
    await nextTick();
    if (open && !dialog.value?.open) dialog.value?.showModal();
    else if (!open && dialog.value?.open) dialog.value.close();
  },
  { immediate: true },
);
onBeforeUnmount(() => dialog.value?.close());
function onKey(event: KeyboardEvent) {
  if (!props.position || event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target as HTMLElement;
  if (target.closest("input, textarea, select, [contenteditable='true']")) return;
  if (event.key === "ArrowUp" && props.position.index > 0) { event.preventDefault(); emit("prev"); }
  if (event.key === "ArrowDown" && props.position.index < props.position.total - 1) { event.preventDefault(); emit("next"); }
}
</script>
<template>
  <Teleport to="body"
    ><dialog
      ref="dialog"
      class="detail-drawer"
      :aria-label="title"
      @cancel.prevent="emit('close')"
      @click="$event.target === dialog && emit('close')"
      @keydown="onKey"
    >
      <header>
        <h2>{{ title }}</h2>
        <div class="drawer-tools">
          <template v-if="position && position.total > 1">
            <span class="drawer-pos">{{ position.index + 1 }} / {{ position.total }}</span>
            <button type="button" class="drawer-step" aria-label="上一条" :disabled="position.index <= 0" @click="emit('prev')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m18 15-6-6-6 6" /></svg>
            </button>
            <button type="button" class="drawer-step" aria-label="下一条" :disabled="position.index >= position.total - 1" @click="emit('next')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>
          </template>
          <button type="button" class="drawer-close" aria-label="关闭详情" @click="emit('close')">×</button>
        </div>
      </header>
      <div class="drawer-body"><slot /></div></dialog
  ></Teleport>
</template>
<style scoped>
.detail-drawer {
  box-sizing: border-box;
  position: fixed;
  inset: 12px 12px 12px auto;
  margin: 0;
  width: min(520px, calc(100vw - 24px));
  height: calc(100dvh - 24px);
  max-width: 100vw;
  max-height: 100dvh;
  padding: 0;
  border: 0;
  border-radius: 24px;
  color: var(--ink, #141413);
  background: var(--white, #fff);
  box-shadow: 0 30px 70px -20px rgba(20, 20, 19, 0.32), 0 0 0 0.5px rgba(20, 20, 19, 0.06);
  overflow: auto;
  overscroll-behavior: contain;
}
.detail-drawer[open] { animation: drawer-in 0.5s var(--ease-out, cubic-bezier(0.32, 0.72, 0, 1)) both; }
.detail-drawer::backdrop { background: rgba(20, 20, 19, 0.14); animation: drawer-fade 0.3s ease both; }
@keyframes drawer-in { from { opacity: 0.4; transform: translateX(calc(100% + 24px)); } }
@keyframes drawer-fade { from { opacity: 0; } }
header {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  justify-content: space-between;
  padding: 20px 20px 16px 24px;
  border-bottom: 1px solid var(--line-soft, #f0eee6);
  position: sticky;
  top: 0;
  background: rgba(255, 255, 255, 0.92);
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
  z-index: 1;
}
h2 {
  font-family: var(--font-display, serif);
  font-size: 20px;
  font-weight: 600;
  line-height: 1.4;
  margin: 2px 0 0;
  overflow-wrap: anywhere;
}
.drawer-tools { display: flex; align-items: center; gap: 6px; flex: none; }
.drawer-pos { margin-right: 4px; color: var(--muted, #87867f); font-size: 12.5px; }
.drawer-step,
.drawer-close {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--ink-soft, #5e5d59);
  background: var(--paper-deep, #f3f1ea);
  font: inherit;
  cursor: pointer;
  transition: background 0.2s, color 0.2s, transform 0.36s var(--spring, ease);
}
.drawer-close { font-size: 20px; line-height: 1; }
.drawer-step:hover:not(:disabled),
.drawer-close:hover { color: var(--ink, #141413); background: var(--line, #e8e6dc); }
.drawer-step:active:not(:disabled),
.drawer-close:active { transform: scale(0.9); }
.drawer-step:disabled { opacity: 0.35; cursor: default; }
.drawer-step:focus-visible,
.drawer-close:focus-visible { outline: 2px solid var(--clay, #d46b45); outline-offset: 2px; }
.drawer-body {
  padding: 22px 24px 28px;
  min-width: 0;
  overflow-wrap: anywhere;
  line-height: 1.65;
}
@media (max-width: 600px) {
  .detail-drawer { inset: 0; width: 100vw; height: 100dvh; border-radius: 0; }
  header { padding: 16px 14px 12px 18px; }
  .drawer-body { padding: 18px; }
  .drawer-pos { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .detail-drawer[open], .detail-drawer::backdrop { animation: none; }
}
</style>
