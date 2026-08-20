<template>
  <div class="tools-view">
    <div class="page-header">
      <div>
        <h2 class="page-title">工具市场</h2>
        <p class="page-sub">专业推广工具，提升运营效率</p>
      </div>
      <div class="header-actions">
        <span class="installed-count">已安装 <b>{{ installedIds.size }}</b> 个工具</span>
      </div>
    </div>

    <!-- Category tabs -->
    <div class="cat-bar">
      <button
        v-for="cat in ['全部', ...toolCats]" :key="cat"
        class="cat-chip" :class="{ active: activeTab === cat }"
        @click="activeTab = cat"
      >{{ cat }}</button>
    </div>

    <!-- Grid -->
    <div class="tools-grid">
      <div v-for="t in filteredTools" :key="t.id" class="tool-card" @click="openDetail(t)">
        <div class="tool-top">
          <div class="tool-icon" :style="{ background: t.bgColor }">
            <span class="tool-emoji">{{ t.icon }}</span>
          </div>
          <div class="tool-badge-row">
            <span class="price-badge" :class="t.price === '免费' ? 'free' : 'paid'">{{ t.price }}</span>
            <span v-if="installedIds.has(t.id)" class="installed-dot">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              已安装
            </span>
          </div>
        </div>
        <div class="tool-name">{{ t.name }}</div>
        <p class="tool-desc">{{ t.desc }}</p>
        <div class="tool-footer">
          <span class="tool-cat-tag">{{ t.category }}</span>
          <div class="tool-actions" @click.stop>
            <button class="btn-ghost-sm" @click="openDetail(t)">详情</button>
            <button
              class="btn-use"
              :class="installedIds.has(t.id) ? 'installed' : t.price === '免费' ? '' : 'paid'"
              @click="handleUse(t)"
            >
              {{ installedIds.has(t.id) ? '打开' : t.price === '免费' ? '安装' : '购买' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Detail Modal -->
    <a-modal v-model:open="detailVisible" :title="currentTool?.name" :footer="null" width="500">
      <div v-if="currentTool" class="detail-body">
        <div class="detail-icon" :style="{ background: currentTool.bgColor }">
          <span style="font-size:40px">{{ currentTool.icon }}</span>
        </div>
        <div class="detail-meta">
          <div class="detail-row">
            <span class="dr-key">分类</span>
            <span class="dr-val">{{ currentTool.category }}</span>
          </div>
          <div class="detail-row">
            <span class="dr-key">定价</span>
            <span class="price-badge" :class="currentTool.price === '免费' ? 'free' : 'paid'">{{ currentTool.price }}</span>
          </div>
          <div class="detail-row">
            <span class="dr-key">描述</span>
            <span class="dr-val" style="flex:1">{{ currentTool.desc }}</span>
          </div>
        </div>
        <div class="detail-footer">
          <button class="btn-ghost-lg" @click="detailVisible = false">关闭</button>
          <button
            class="btn-primary-lg"
            :class="installedIds.has(currentTool.id) ? 'installed' : ''"
            @click="handleUse(currentTool); detailVisible = false"
          >
            {{ installedIds.has(currentTool.id) ? '打开工具' : currentTool.price === '免费' ? '立即安装' : '购买使用' }}
          </button>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { message } from 'ant-design-vue'

interface Tool {
  id: string; name: string; category: string; desc: string
  bgColor: string; icon: string; price: string
}

const TOOLS: Tool[] = [
  { id: 't1', name: '豹赞数据',   category: 'AI数据',   price: '免费试用', icon: '📊', bgColor: '#E84035', desc: '实时监控推广数据，AI智能分析趋势，自动推送收益异常预警。' },
  { id: 't2', name: '选品雷达',   category: '选品工具', price: '¥29/月',  icon: '🎯', bgColor: '#FF6B3D', desc: '基于大数据算法，扫描全网热门项目，提前3天预测爆款。' },
  { id: 't3', name: '文案魔方',   category: 'AI创作',   price: '¥19/月',  icon: '✍️', bgColor: '#9B59B6', desc: 'GPT驱动的推广文案生成，支持小红书/抖音/微信多平台风格。' },
  { id: 't4', name: '落地页工厂', category: '建站工具', price: '¥49/月',  icon: '🏗️', bgColor: '#2ECC71', desc: '无需代码，拖拽完成专业落地页。内置50+高转化模板，A/B测试一键启用。' },
  { id: 't5', name: '违规检测仪', category: '合规工具', price: '免费',    icon: '🛡️', bgColor: '#E74C3C', desc: '基于最新规则库，自动扫描内容中的违禁词、敏感词及诱导性表述。' },
]

const activeTab     = ref('全部')
const detailVisible = ref(false)
const currentTool   = ref<Tool | null>(null)
const installedIds  = ref<Set<string>>(new Set())

const toolCats     = computed(() => [...new Set(TOOLS.map(t => t.category))])
const filteredTools = computed(() => activeTab.value === '全部' ? TOOLS : TOOLS.filter(t => t.category === activeTab.value))

function openDetail(t: Tool) { currentTool.value = t; detailVisible.value = true }

function handleUse(t: Tool) {
  if (installedIds.value.has(t.id)) { message.info(`正在打开「${t.name}」`); return }
  if (t.price === '免费' || t.price === '免费试用') {
    installedIds.value = new Set([...installedIds.value, t.id])
    message.success(`「${t.name}」安装成功，已在工具栏中启用`)
  } else {
    message.info(`「${t.name}」需要付费，即将跳转购买页面`)
  }
}
</script>

<style scoped>
.tools-view { padding: 0; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.page-title { font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-text-primary); margin: 0 0 4px; }
.page-sub { font-size: 13px; color: var(--color-text-tertiary); margin: 0; }
.installed-count { font-size: 13px; color: var(--color-text-tertiary); }
.installed-count b { color: var(--color-accent); font-weight: 600; }

/* Category bar */
.cat-bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 28px; }
.cat-chip { padding: 6px 16px; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-full); font-size: 13px; color: var(--color-text-tertiary); cursor: pointer; transition: all var(--transition-fast); }
.cat-chip:hover { border-color: var(--color-border-hover); color: var(--color-text-primary); }
.cat-chip.active { background: var(--color-accent-subtle); border-color: var(--color-accent-border); color: var(--color-accent); font-weight: 500; }

/* Grid */
.tools-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }

/* Tool card */
.tool-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-xl); padding: 24px; cursor: pointer; display: flex; flex-direction: column; gap: 12px; transition: border-color var(--transition-base), transform var(--transition-base); }
.tool-card:hover { border-color: var(--color-border-hover); transform: translateY(-2px); }
.tool-top { display: flex; justify-content: space-between; align-items: flex-start; }
.tool-icon { width: 52px; height: 52px; border-radius: var(--radius-lg); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.tool-emoji { font-size: 26px; }
.tool-badge-row { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.price-badge { display: inline-block; padding: 2px 10px; border-radius: var(--radius-full); font-size: 11.5px; font-weight: 600; }
.price-badge.free { background: rgba(16,185,129,0.12); color: var(--color-success); border: 1px solid rgba(16,185,129,0.2); }
.price-badge.paid { background: rgba(245,158,11,0.12); color: var(--color-warning); border: 1px solid rgba(245,158,11,0.2); }
.installed-dot { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--color-success); }
.tool-name { font-size: 15px; font-weight: 600; color: var(--color-text-primary); }
.tool-desc { font-size: 13px; color: var(--color-text-tertiary); line-height: 1.65; margin: 0; flex: 1; }
.tool-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; }
.tool-cat-tag { font-size: 11.5px; color: var(--color-text-disabled); background: var(--color-bg-tertiary); padding: 3px 8px; border-radius: var(--radius-sm); }
.tool-actions { display: flex; gap: 8px; }
.btn-ghost-sm { height: 30px; padding: 0 12px; background: transparent; border: 1px solid var(--color-border); border-radius: var(--radius-sm); font-size: 12px; color: var(--color-text-tertiary); cursor: pointer; transition: all var(--transition-fast); }
.btn-ghost-sm:hover { border-color: var(--color-border-hover); color: var(--color-text-primary); }
.btn-use { height: 30px; padding: 0 14px; background: var(--color-accent); border: none; border-radius: var(--radius-sm); font-size: 12px; font-weight: 600; color: white; cursor: pointer; transition: all var(--transition-fast); }
.btn-use:hover { background: var(--color-accent-hover); }
.btn-use.installed { background: var(--color-bg-tertiary); color: var(--color-text-secondary); border: 1px solid var(--color-border); }
.btn-use.paid { background: rgba(245,158,11,0.15); color: var(--color-warning); }

/* Detail modal */
.detail-body { display: flex; flex-direction: column; gap: 20px; }
.detail-icon { width: 72px; height: 72px; border-radius: var(--radius-xl); display: flex; align-items: center; justify-content: center; margin: 0 auto; }
.detail-meta { display: flex; flex-direction: column; gap: 12px; background: var(--color-bg-secondary); border-radius: var(--radius-md); padding: 16px; }
.detail-row { display: flex; align-items: center; gap: 16px; }
.dr-key { font-size: 12px; color: var(--color-text-tertiary); width: 36px; flex-shrink: 0; }
.dr-val { font-size: 13px; color: var(--color-text-secondary); line-height: 1.6; }
.detail-footer { display: flex; gap: 12px; }
.btn-ghost-lg { flex: 1; height: 40px; background: transparent; border: 1px solid var(--color-border); border-radius: var(--radius-md); font-size: 14px; color: var(--color-text-secondary); cursor: pointer; transition: all var(--transition-fast); }
.btn-ghost-lg:hover { border-color: var(--color-border-hover); color: var(--color-text-primary); }
.btn-primary-lg { flex: 1; height: 40px; background: var(--color-accent); border: none; border-radius: var(--radius-md); font-size: 14px; font-weight: 600; color: white; cursor: pointer; transition: all var(--transition-fast); }
.btn-primary-lg:hover { background: var(--color-accent-hover); box-shadow: var(--shadow-glow); }
.btn-primary-lg.installed { background: var(--color-bg-tertiary); color: var(--color-text-secondary); border: 1px solid var(--color-border); }
</style>
