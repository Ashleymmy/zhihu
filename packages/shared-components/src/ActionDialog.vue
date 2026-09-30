<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
const props = defineProps<{ open: boolean; title: string; busy?: boolean }>();
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
      :aria-label="title"
      @cancel.prevent="close"
      @click="$event.target === dialog && close()"
    >
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
.action-dialog {
  width: min(660px, calc(100vw - 32px));
  max-height: calc(100dvh - 48px);
  overflow: auto;
  padding: 0;
  color: var(--ink, #243438);
  background: var(--paper, #fff);
  border: 1px solid var(--line, #dce3e5);
  border-radius: 14px;
  box-shadow: 0 24px 80px #0003;
}
.action-dialog::backdrop {
  background: #10252770;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px;
  border-bottom: 1px solid var(--line, #dce3e5);
}
h2 {
  margin: 0;
  font-size: 20px;
}
.dialog-dismiss {
  font-size: 24px;
  width: 40px;
  min-height: 40px;
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
}
.action-dialog-content {
  padding: 24px;
}
.action-dialog :deep(form) {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 18px;
}
.action-dialog :deep(form > *),
.action-dialog-content {
  min-width: 0;
}
.action-dialog :deep(p) {
  overflow-wrap: anywhere;
  line-height: 1.6;
}
.action-dialog :deep(label) {
  display: grid;
  gap: 8px;
  font-size: 14px;
}
.action-dialog :deep(input),
.action-dialog :deep(select) {
  width: 100%;
  box-sizing: border-box;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid var(--line, #dce3e5);
  border-radius: 8px;
  background: var(--paper, #fff);
  color: inherit;
}
.action-dialog :deep(button) {
  min-height: 42px;
  padding: 8px 14px;
  border-radius: 7px;
  border: 1px solid var(--line, #dce3e5);
  color: inherit;
  background: var(--paper, #fff);
  cursor: pointer;
}
.action-dialog :deep(button.primary) {
  background: #195e62;
  border-color: #195e62;
  color: white;
}
.action-dialog :deep(button:disabled) {
  opacity: 0.55;
  cursor: default;
}
.action-dialog :deep(.dialog-actions) {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}
.action-dialog :deep([role="alert"]) {
  color: #a02f39;
  line-height: 1.6;
}
.action-dialog :deep(small) {
  color: var(--ink-soft, #637078);
}
@media (max-width: 550px) {
  header {
    padding: 16px;
  }
  .action-dialog-content {
    padding: 18px;
  }
  .action-dialog :deep(input),
  .action-dialog :deep(select) {
    font-size: 16px;
  }
}
</style>
