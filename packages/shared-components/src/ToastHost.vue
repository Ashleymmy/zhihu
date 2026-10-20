<script setup lang="ts">
import { toastState } from './toast'
/** 底部居中的提示栈；撤销类带 5 秒倒计时环 */
</script>

<template>
  <div class="toast-host" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="item in toastState.items" :key="item.id" class="toast" :class="item.tone" role="status">
        <svg v-if="item.tone === 'undo'" class="toast-ring" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="8" class="track" />
          <circle cx="10" cy="10" r="8" class="left" :style="{ animationDuration: (item.timeout ?? 5000) + 'ms' }" />
        </svg>
        <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path :d="item.tone === 'error' ? 'M12 8v5M12 16h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z' : 'M20 6 9 17l-5-5'" />
        </svg>
        <span>{{ item.message }}</span>
        <button v-if="item.undo" type="button" @click="item.undo()">撤销</button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host { position: fixed; left: 50%; bottom: calc(24px + env(safe-area-inset-bottom)); z-index: 10000; display: grid; justify-items: center; gap: 8px; transform: translateX(-50%); pointer-events: none; }
.toast { display: flex; align-items: center; gap: 12px; max-width: min(92vw, 520px); padding: 11px 12px 11px 16px; border-radius: 16px; color: #fff; background: var(--ink, #141413); box-shadow: 0 16px 40px rgba(20, 20, 19, 0.3); font-size: 14px; pointer-events: auto; }
.toast.ok svg { color: #8fd3a8; }
.toast.error svg { color: #f2a493; }
.toast button { flex: none; padding: 4px 10px; border: 0; border-radius: 9px; color: #f0b49b; background: transparent; font: inherit; font-weight: 700; cursor: pointer; }
.toast button:hover { background: rgba(255, 255, 255, 0.1); }
.toast-ring { width: 18px; height: 18px; flex: none; transform: rotate(-90deg); }
.toast-ring circle { fill: none; stroke-width: 2.5; }
.toast-ring .track { stroke: rgba(255, 255, 255, 0.22); }
.toast-ring .left { stroke: #f0b49b; stroke-dasharray: 50.3; stroke-dashoffset: 0; animation: ring-left linear forwards; }
@keyframes ring-left { to { stroke-dashoffset: 50.3; } }
.toast-enter-active { transition: transform 0.5s var(--spring, cubic-bezier(0.34, 1.36, 0.64, 1)), opacity 0.25s; }
.toast-leave-active { transition: transform 0.25s ease, opacity 0.2s; }
.toast-enter-from { opacity: 0; transform: translateY(24px) scale(0.96); }
.toast-leave-to { opacity: 0; transform: translateY(8px); }
@media (max-width: 700px) { .toast-host { bottom: calc(92px + env(safe-area-inset-bottom)); } }
@media (prefers-reduced-motion: reduce) { .toast-enter-active, .toast-leave-active { transition: none; } .toast-ring .left { animation: none; } }
</style>
