<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
const props = defineProps<{ open: boolean; title: string; busy?: boolean; wide?: boolean }>();
const emit = defineEmits<{ close: [] }>();
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
function close() {
  if (!props.busy) emit("close");
}
onBeforeUnmount(() => dialog.value?.close());
</script>
<template>
  <Teleport to="body"
    ><dialog
      ref="dialog"
      class="action-dialog"
      :class="{ 'action-dialog-wide': wide }"
      :aria-label="title"
      @cancel.prevent="close"
      @click="$event.target === dialog && close()"
    >
      <span class="sheet-grabber" aria-hidden="true" />
      <header>
        <h2>{{ title }}</h2>
        <button
          type="button"
          class="dialog-dismiss"
          :disabled="busy"
          aria-label="关闭"
          @click="close"
        >
          ×
        </button>
      </header>
      <div class="action-dialog-content"><slot /></div></dialog
  ></Teleport>
</template>
<style scoped>
/* 对话面板：桌面居中、弹性浮现，背后页面轻微后退；手机从底部升起 */
.action-dialog {
  width: min(600px, calc(100vw - 32px));
  max-height: calc(100dvh - 48px);
  overflow: auto;
  padding: 0;
  color: var(--ink, #141413);
  background: var(--white, #fff);
  border: 0;
  border-radius: 24px;
  box-shadow: 0 40px 80px -20px rgba(20, 20, 19, 0.35), 0 0 0 0.5px rgba(20, 20, 19, 0.06);
}
.action-dialog[open] { animation: sheet-in 0.5s var(--spring, cubic-bezier(0.34, 1.36, 0.64, 1)) both; }
.action-dialog::backdrop { background: rgba(20, 20, 19, 0.26); animation: backdrop-in 0.3s ease both; }
@keyframes sheet-in { from { opacity: 0; transform: translateY(16px) scale(0.96); } }
@keyframes backdrop-in { from { opacity: 0; } }
.action-dialog-wide { width: min(880px, calc(100vw - 32px)); }
.sheet-grabber { display: none; }
.action-dialog :deep(input[type="checkbox"]),
.action-dialog :deep(input[type="radio"]) { width: 18px; min-height: 18px; flex: 0 0 18px; accent-color: #141413; }
header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 22px 14px;
  background: var(--white, #fff);
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
}
h2 { margin: 0; font-size: 18px; font-weight: 650; }
.action-dialog-content { padding: 6px 22px 22px; }
.action-dialog :deep(form) { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; }
.action-dialog :deep(form > *), .action-dialog-content { min-width: 0; }
.action-dialog :deep(p) { overflow-wrap: anywhere; line-height: 1.6; }
.action-dialog :deep(label) { display: grid; gap: 8px; font-size: 14px; }
.action-dialog :deep(input),
.action-dialog :deep(select) {
  width: 100%;
  box-sizing: border-box;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid var(--line, #e8e6dc);
  border-radius: 12px;
  background: var(--white, #fff);
  color: inherit;
}
.action-dialog :deep(input:focus-visible), .action-dialog :deep(select:focus-visible) { outline: none; border-color: var(--clay, #d46b45); box-shadow: 0 0 0 3px var(--clay-soft, #f6e5dc); }
.action-dialog :deep(button) {
  min-height: 42px;
  padding: 8px 16px;
  border-radius: 12px;
  border: 1px solid var(--line, #e8e6dc);
  color: inherit;
  background: var(--white, #fff);
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s, transform 0.36s var(--spring, ease);
}
.action-dialog :deep(button:hover) { background: var(--hover, #f5f3ec); }
.action-dialog :deep(button:active) { transform: scale(0.97); }
.action-dialog :deep(button.primary) { background: #141413; border-color: #141413; color: white; }
.action-dialog :deep(button.primary:hover) { background: #2b2b29; }
.action-dialog :deep(button:disabled) { opacity: 0.5; cursor: default; transform: none; }
.action-dialog .dialog-dismiss {
  display: grid;
  width: 32px;
  min-height: 32px;
  height: 32px;
  flex: none;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--ink-soft, #5e5d59);
  background: var(--paper-deep, #f3f1ea);
  font-size: 20px;
  font-weight: 400;
  line-height: 1;
}
.action-dialog .dialog-dismiss:hover { background: var(--line, #e8e6dc); color: var(--ink, #141413); }
.action-dialog .dialog-dismiss:active { transform: scale(0.9); }
.action-dialog :deep(.dialog-actions) { display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
.action-dialog :deep([role="alert"]) { color: #b4402e; line-height: 1.6; }
.action-dialog :deep(small) { color: var(--ink-soft, #5e5d59); }
@media (max-width: 550px) {
  .action-dialog,
  .action-dialog-wide {
    width: 100vw;
    max-width: 100vw;
    max-height: 92dvh;
    margin: auto 0 0;
    border-radius: 24px 24px 0 0;
    padding-bottom: env(safe-area-inset-bottom);
  }
  .action-dialog[open] { animation: sheet-up 0.45s var(--ease-out, cubic-bezier(0.32, 0.72, 0, 1)) both; }
  @keyframes sheet-up { from { transform: translateY(100%); } }
  .sheet-grabber { display: block; width: 38px; height: 5px; margin: 8px auto 0; border-radius: 3px; background: var(--line, #e8e6dc); }
  header { padding: 10px 16px 12px; }
  .action-dialog-content { padding: 4px 16px 18px; }
  .action-dialog :deep(input), .action-dialog :deep(select) { font-size: 16px; }
  .action-dialog :deep(.dialog-actions) { flex-direction: column-reverse; }
  .action-dialog :deep(.dialog-actions button) { width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .action-dialog[open], .action-dialog::backdrop { animation: none; }
}
</style>
