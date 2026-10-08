<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
const props = defineProps<{ open: boolean; title: string }>();
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
onBeforeUnmount(() => dialog.value?.close());
</script>
<template>
  <Teleport to="body"
    ><dialog
      ref="dialog"
      class="detail-drawer"
      :aria-label="title"
      @cancel.prevent="emit('close')"
      @click="$event.target === dialog && emit('close')"
    >
      <header>
        <h2>{{ title }}</h2>
        <button type="button" aria-label="关闭详情" @click="emit('close')">
          ×
        </button>
      </header>
      <div class="drawer-body"><slot /></div></dialog
  ></Teleport>
</template>
<style scoped>
.detail-drawer {
  box-sizing: border-box;
  position: fixed;
  inset: 0 0 0 auto;
  margin: 0;
  width: min(540px, 100vw);
  height: 100dvh;
  max-width: 100vw;
  max-height: 100dvh;
  padding: 0;
  border: 0;
  border-left: 1px solid var(--line, #dce3e5);
  color: var(--ink, #243438);
  background: var(--paper, #fff);
  box-shadow: -16px 0 48px #10252720;
  overflow: auto;
}
.detail-drawer::backdrop {
  background: #10252760;
}
header {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  justify-content: space-between;
  padding: 22px 24px;
  border-bottom: 1px solid var(--line, #dce3e5);
  position: sticky;
  top: 0;
  background: var(--paper, #fff);
  z-index: 1;
}
h2 {
  font-size: 20px;
  line-height: 1.5;
  margin: 0;
  overflow-wrap: anywhere;
}
header button {
  flex: none;
  width: 44px;
  min-height: 44px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 26px;
  cursor: pointer;
}
header button:focus-visible {
  outline: 3px solid #195e62;
  outline-offset: 2px;
}
.drawer-body {
  padding: 24px;
  min-width: 0;
  overflow-wrap: anywhere;
  line-height: 1.65;
}
@media (max-width: 600px) {
  header,
  .drawer-body {
    padding: 18px;
  }
}
</style>
