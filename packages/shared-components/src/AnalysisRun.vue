<script setup lang="ts">
import { computed } from "vue";
import ValueComparison from './ValueComparison.vue';
import type { AnalysisRunModel, AnalysisStepStatus } from "./analysis-run";
const props = defineProps<{
  run: AnalysisRunModel;
  busyAskId?: string;
  errors?: Record<string, string>;
  busyAction?: string;
}>();
const emit = defineEmits<{
  answer: [answer: { askId: string; option: string }];
  action: [key: string];
}>();
const statusText = computed(
  () =>
    ({
      running: "正在处理",
      needs_input: "有事项需要确认",
      done: "处理完成",
      failed: "处理未完成",
    })[props.run.status],
);
const stepText: Record<AnalysisStepStatus, string> = {
  pending: "等待处理",
  running: "正在处理",
  done: "已完成",
  ask: "需要确认",
  failed: "需要处理",
  skipped: "已跳过",
};
const icon: Record<AnalysisStepStatus, string> = {
  pending: "·",
  running: "…",
  done: "✓",
  ask: "?",
  failed: "!",
  skipped: "—",
};
const progress = computed(() =>
  props.run.progress && props.run.progress.total > 0
    ? Math.min(
        100,
        Math.max(0, (props.run.progress.done / props.run.progress.total) * 100),
      )
    : null,
);
</script>
<template>
  <section class="analysis-run" aria-label="处理进度">
    <header>
      <span class="file-mark" aria-hidden="true">文</span>
      <div>
        <h2>{{ run.fileName }}</h2>
        <p v-if="run.source || run.createdAt">
          {{ [run.source, run.createdAt].filter(Boolean).join(" · ") }}
        </p>
      </div>
    </header>
    <div class="run-state" role="status" aria-live="polite">
      <strong>{{ statusText }}</strong
      ><span v-if="run.progress"
        >{{ run.progress.done }} / {{ run.progress.total }}</span
      >
    </div>
    <progress
      v-if="progress !== null"
      :value="progress"
      max="100"
      aria-label="处理进度"
    ></progress>
    <ol class="steps">
      <li
        v-for="step in run.steps"
        :key="step.key"
        :class="['step', step.status]"
      >
        <span class="step-icon" aria-hidden="true">{{
          icon[step.status]
        }}</span>
        <div class="step-content">
          <div class="step-heading">
            <h3>{{ step.title }}</h3>
            <span>{{ stepText[step.status] }}</span>
          </div>
          <p>{{ step.summary }}</p>
          <div
            v-for="ask in step.asks"
            :key="ask.id"
            class="ask-box"
            role="group"
            :aria-label="ask.text"
            :aria-busy="busyAskId === ask.id"
          >
            <p>{{ ask.text }}</p>
            <ValueComparison v-if="ask.comparison?.length" :rows="ask.comparison" />
            <div class="actions">
              <button
                v-for="option in ask.options"
                :key="option.key"
                type="button"
                :class="{ primary: option.tone === 'primary' }"
                :disabled="Boolean(busyAskId || busyAction) || option.disabled"
                @click="emit('answer', { askId: ask.id, option: option.key })"
              >
                {{ option.label }}
              </button>
            </div>
            <p v-if="busyAskId === ask.id" role="status">正在保存选择…</p>
            <p v-if="errors?.[ask.id]" class="error" role="alert">
              {{ errors[ask.id] }}
            </p>
          </div>
        </div>
      </li>
    </ol>
    <footer v-if="run.conclusion" class="conclusion">
      <h3>{{ run.conclusion.title }}</h3>
      <strong class="conclusion-value">{{ run.conclusion.value }}</strong>
      <p>{{ run.conclusion.summary }}</p>
      <p v-if="run.conclusion.pendingText" class="pending-text">
        {{ run.conclusion.pendingText }}
      </p>
      <div class="actions">
        <button
          v-for="action in run.conclusion.actions"
          :key="action.key"
          type="button"
          :class="{ primary: action.tone === 'primary' }"
          :disabled="Boolean(busyAction) || action.disabled"
          @click="emit('action', action.key)"
        >
          {{ action.label }}
        </button>
      </div>
    </footer>
    <slot name="footer" />
  </section>
</template>
<style scoped>
.analysis-run {
  min-width: 0;
  border: 1px solid var(--line, #e8e6dc);
  border-radius: 12px;
  background: var(--paper, #fff);
  color: var(--ink, #2b2b29);
  overflow: hidden;
  font-size: 14px;
  line-height: 1.6;
}
header {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid var(--line, #e8e6dc);
}
header > div,
.step-content {
  min-width: 0;
}
.file-mark {
  display: grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 44px;
  border-radius: 8px;
  background: #e3efe5;
  color: #2f7d4f;
  font-weight: 700;
}
h2 {
  font-size: 16px;
  margin: 0;
  overflow-wrap: anywhere;
}
h3 {
  font-size: 14px;
  margin: 0;
  font-weight: 650;
}
p {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
}
header p {
  color: var(--ink-soft, #6f6e68);
  font-size: 12px;
}
.run-state {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 20px 4px;
  color: #5e5d59;
  font-size: 12px;
}
.run-state strong {
  font-weight: 500;
}
progress {
  display: block;
  width: calc(100% - 40px);
  height: 5px;
  margin: 8px 20px 4px;
  border: 0;
  accent-color: #141413;
}
progress::-webkit-progress-bar {
  background: #f0eee6;
  border-radius: 6px;
}
progress::-webkit-progress-value {
  background: #141413;
  border-radius: 6px;
}
progress::-moz-progress-bar {
  background: #141413;
  border-radius: 6px;
}
.steps {
  list-style: none;
  padding: 2px 20px 12px;
  margin: 0;
}
.step {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 10px;
  padding: 16px 0;
  border-bottom: 1px dashed var(--line, #e8e6dc);
}
.step:last-child {
  border-bottom: 0;
}
.step-icon {
  display: grid;
  place-items: center;
  width: 23px;
  height: 23px;
  border-radius: 50%;
  background: #f0eee6;
  color: #5e5d59;
  font-weight: 700;
}
.step.done .step-icon {
  background: #e3efe5;
  color: #2f7d4f;
}
.step.ask .step-icon {
  background: #f5ead3;
  color: #a86a12;
}
.step.failed .step-icon {
  background: #f6e1dc;
  color: #b4402e;
}
.step.running .step-icon {
  background: #f0eee6;
  color: #141413;
}
.step-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: baseline;
  flex-wrap: wrap;
}
.step-heading > span {
  font-size: 11px;
  color: #6f6e68;
}
.step-content > p {
  color: #5e5d59;
}
.ask-box {
  margin-top: 12px;
  border: 1px solid #ead9b4;
  border-radius: 8px;
  background: #f5ead3;
  padding: 12px;
  color: #a86a12;
}
.ask-box > p:first-child {
  margin: 0;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
button {
  font: inherit;
  line-height: 1.5;
  min-height: 42px;
  padding: 8px 12px;
  border-radius: 7px;
  border: 1px solid #d6d3c7;
  background: var(--paper, #fff);
  color: #2b2b29;
  cursor: pointer;
  overflow-wrap: anywhere;
}
button.primary {
  background: #141413;
  border-color: #141413;
  color: white;
}
button:disabled {
  opacity: 0.55;
  cursor: default;
}
button:focus-visible {
  outline: 3px solid #141413;
  outline-offset: 3px;
}
.error {
  color: #b4402e;
  font-weight: 500;
}
.conclusion {
  margin: 0 20px 20px;
  padding: 16px;
  border: 1px solid #d6d3c7;
  border-radius: 10px;
  background: #f5f3ec;
}
.conclusion-value {
  display: block;
  font-size: 27px;
  line-height: 1.3;
  margin: 8px 0;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.pending-text {
  color: #a86a12;
}
@media (max-width: 600px) {
  header {
    padding: 16px;
  }
  .steps {
    padding: 0 16px 10px;
  }
  .conclusion {
    margin: 0 16px 16px;
  }
  .run-state {
    padding-left: 16px;
    padding-right: 16px;
  }
  button {
    min-height: 44px;
  }
}
</style>
