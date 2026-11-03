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
/* 操作引导：与 v2 卡片语言统一（白卡大圆角柔影 + 浅底步骤卡 + btn 语言） */
.operation-guide {
  min-width: 0;
  border-radius: var(--r, 22px);
  background: var(--card, #fff);
  box-shadow: var(--sh);
  color: var(--ink, #141413);
}
.guide-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 22px;
}
.guide-header > div {
  min-width: 0;
}
.guide-audience {
  margin: 0 0 6px;
  color: var(--muted, #87867f);
  font-size: 12px;
}
.operation-guide h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 600;
}
.operation-guide h3,
.operation-guide h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  line-height: 1.5;
  font-family: inherit;
}
.operation-guide p {
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.guide-intro {
  margin: 6px 0 0;
  color: var(--ink-soft, #5e5d59);
  font-size: 13.5px;
}
.operation-guide .guide-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex-shrink: 0;
  height: 36px;
  padding: 0 14px;
  border: 0;
  border-radius: 12px;
  background: var(--hover, #f5f3ec);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: inherit;
  cursor: pointer;
  transition: background 0.2s, transform 0.35s var(--spring);
}
.guide-toggle:hover {
  background: var(--line-2, #f0eee6);
}
.guide-toggle:active {
  transform: scale(0.96);
}
.guide-toggle span {
  font-size: 18px;
  line-height: 1;
}
.guide-content {
  padding: 0 22px 22px;
}
.guide-steps,
.guide-management-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
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
  padding: 18px;
  border: 1px solid var(--line-2, #f0eee6);
  border-radius: var(--r-s, 14px);
  background: var(--card-2, #faf9f5);
  transition: transform 0.45s var(--spring), box-shadow 0.35s var(--ease);
}
.guide-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--sh);
}
.guide-card-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.guide-number {
  color: var(--clay-deep, #b5532f);
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 600;
}
.guide-card > p {
  margin: 10px 0;
  font-size: 13.5px;
  color: var(--ink-soft, #5e5d59);
}
.guide-instructions {
  margin: 0 0 14px;
  width: 100%;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--ink-soft, #5e5d59);
}
.guide-instructions summary {
  padding: 6px 0;
  cursor: pointer;
  color: var(--muted, #87867f);
}
.guide-instructions summary:hover {
  color: var(--ink, #141413);
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
  gap: 6px;
  min-height: 36px;
  color: var(--ink, #141413);
  font-size: 13.5px;
  font-weight: 600;
  text-decoration: none;
}
.guide-actions a:hover {
  text-decoration: underline;
  text-underline-offset: 4px;
}
.guide-actions .guide-primary {
  height: 36px;
  padding: 0 16px;
  border: 0;
  border-radius: 12px;
  background: var(--ink, #141413);
  color: var(--card-2, #faf9f5);
  transition: transform 0.35s var(--spring), background 0.2s;
}
.guide-primary:hover {
  background: #2b2b29;
  text-decoration: none;
}
.guide-primary:active {
  transform: scale(0.96);
}
.operation-guide :is(a, button, summary):focus-visible {
  outline: 2px solid var(--clay, #d46b45);
  outline-offset: 2px;
  border-radius: 8px;
}
.guide-management {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--line-2, #f0eee6);
}
.guide-management-intro {
  margin: 8px 0 16px;
  font-size: 13px;
  color: var(--muted, #87867f);
}
.guide-management-card {
  padding: 16px 18px;
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
