<script setup lang="ts">
import { ref, watch } from "vue";
import type { OperationGuideModel } from "./operation-guide";

const props = defineProps<{ guide: OperationGuideModel }>();
const collapsed = ref(false);
watch(
  () => props.guide.storageKey,
  (key) => {
    try {
      collapsed.value = localStorage.getItem(key) === "collapsed";
    } catch {
      collapsed.value = false;
    }
  },
  { immediate: true },
);

function toggle() {
  collapsed.value = !collapsed.value;
  try {
    localStorage.setItem(
      props.guide.storageKey,
      collapsed.value ? "collapsed" : "expanded",
    );
  } catch {
    /* Guidance remains usable when browser storage is unavailable. */
  }
}
</script>

<template>
  <section class="operation-guide" aria-label="操作引导">
    <header class="guide-header">
      <div>
        <p class="guide-audience">{{ guide.audience }}</p>
        <h2>操作引导</h2>
        <p class="guide-intro">{{ guide.description }}</p>
      </div>
      <button
        type="button"
        class="guide-toggle"
        :aria-expanded="!collapsed"
        @click="toggle"
      >
        {{ collapsed ? "展开引导" : "收起引导" }}
        <span aria-hidden="true">{{ collapsed ? "+" : "−" }}</span>
      </button>
    </header>
    <div v-if="!collapsed" class="guide-content">
      <ol class="guide-steps" aria-label="核心操作流程">
        <li
          v-for="(card, index) in guide.steps"
          :key="card.id"
          class="guide-card"
          :data-step="card.id"
        >
          <div class="guide-card-title">
            <span class="guide-number" aria-hidden="true">{{
              String(index + 1).padStart(2, "0")
            }}</span>
            <h3>{{ card.title }}</h3>
          </div>
          <p>{{ card.description }}</p>
          <details class="guide-instructions">
            <summary>{{ card.title }}怎么做</summary>
            <ol>
              <li v-for="instruction in card.instructions" :key="instruction">
                {{ instruction }}
              </li>
            </ol>
          </details>
          <div class="guide-actions">
            <router-link
              v-if="card.action"
              class="guide-primary"
              :to="card.action.to"
              >{{ card.action.label }}
              <span aria-hidden="true">→</span></router-link
            >
            <router-link
              v-if="card.secondaryAction"
              :to="card.secondaryAction.to"
              >{{ card.secondaryAction.label }}</router-link
            >
          </div>
        </li>
      </ol>
      <section
        v-if="guide.management.length"
        class="guide-management"
        aria-label="管理协作指南"
      >
        <h3>管理与协作</h3>
        <p class="guide-management-intro">
          先确认成员和项目权限，再分发关键词，后续沿用上方作品流程。
        </p>
        <div class="guide-management-grid">
          <article
            v-for="card in guide.management"
            :key="card.id"
            class="guide-card guide-management-card"
            :data-guide="card.id"
          >
            <h4>{{ card.title }}</h4>
            <p>{{ card.description }}</p>
            <details class="guide-instructions">
              <summary>{{ card.title }}怎么做</summary>
              <ol>
                <li v-for="instruction in card.instructions" :key="instruction">
                  {{ instruction }}
                </li>
              </ol>
            </details>
            <div class="guide-actions">
              <router-link v-if="card.action" :to="card.action.to"
                >{{ card.action.label }}
                <span aria-hidden="true">→</span></router-link
              >
              <router-link
                v-if="card.secondaryAction"
                :to="card.secondaryAction.to"
                >{{ card.secondaryAction.label }}</router-link
              >
            </div>
          </article>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.operation-guide {
  min-width: 0;
  border: 1px solid var(--line, #dce3e5);
  border-radius: 12px;
  background: var(--paper, #fff);
  color: var(--ink, #1b3035);
}
.guide-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 24px;
}
.guide-header > div {
  min-width: 0;
}
.guide-audience {
  margin: 0 0 6px;
  color: var(--ink-soft, #637078);
  font-size: 12px;
}
.operation-guide h2 {
  margin: 0;
  font-size: 21px;
}
.operation-guide h3,
.operation-guide h4 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.5;
  font-family: inherit;
}
.operation-guide p {
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.guide-intro {
  margin: 8px 0 0;
  color: var(--ink-soft, #637078);
  font-size: 14px;
}
.operation-guide .guide-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  flex-shrink: 0;
  padding: 8px 12px;
  min-height: 44px;
  border: 1px solid var(--line, #dce3e5);
  border-radius: 7px;
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: inherit;
  cursor: pointer;
}
.guide-toggle span {
  font-size: 20px;
  line-height: 1;
}
.guide-content {
  padding: 0 24px 24px;
}
.guide-steps,
.guide-management-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.guide-steps {
  margin: 0;
  padding: 0;
  list-style: none;
}
.guide-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
  padding: 20px;
  border: 1px solid var(--line, #dce3e5);
  border-radius: 8px;
}
.guide-card-title {
  display: flex;
  align-items: center;
  gap: 12px;
}
.guide-number {
  color: #195e62;
  font:
    600 14px/1.5 ui-monospace,
    monospace;
}
.guide-card > p {
  margin: 12px 0;
  font-size: 14px;
  color: var(--ink-soft, #637078);
}
.guide-instructions {
  margin: 0 0 16px;
  width: 100%;
  font-size: 13px;
  line-height: 1.7;
}
.guide-instructions summary {
  padding: 8px 0;
  cursor: pointer;
}
.guide-instructions ol {
  margin: 8px 0 0;
  padding-left: 20px;
}
.guide-instructions li {
  padding: 3px 0;
  overflow-wrap: anywhere;
}
.guide-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin-top: auto;
}
.guide-actions a {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  color: #195e62;
  font-size: 14px;
  text-underline-offset: 4px;
}
.guide-actions .guide-primary {
  padding: 8px 14px;
  border: 1px solid #195e62;
  border-radius: 7px;
  background: #195e62;
  color: #fff;
  text-decoration: none;
}
.guide-primary:hover {
  background: #124b4e;
}
.guide-actions a:hover {
  text-decoration: underline;
}
.guide-toggle:hover {
  border-color: #195e62;
}
.operation-guide :is(a, button, summary):focus-visible {
  outline: 2px solid #247c82;
  outline-offset: 3px;
}
.guide-management {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid var(--line, #dce3e5);
}
.guide-management-intro {
  margin: 8px 0 16px;
  font-size: 13px;
  color: var(--ink-soft, #637078);
}
.guide-management-card {
  padding: 16px 20px;
}
@media (max-width: 1000px) {
  .guide-steps,
  .guide-management-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 600px) {
  .guide-header {
    padding: 18px;
    gap: 12px;
    flex-wrap: wrap;
  }
  .guide-header > div {
    flex: 1 1 180px;
  }
  .guide-content {
    padding: 0 18px 18px;
  }
  .guide-card {
    padding: 16px;
  }
  .guide-toggle {
    margin-left: auto;
  }
}
</style>
