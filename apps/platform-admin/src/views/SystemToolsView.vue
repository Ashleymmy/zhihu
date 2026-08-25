<script setup lang="ts">
const tools = [
  { path: '/system/data', code: '01', title: '数据处理与授权', desc: '渠道/任务/指标同步状态与手动触发，知乎接口授权状态，收益数据导出。' },
  { path: '/system/monitor', code: '02', title: '子账号监控', desc: '各账号的登录时间、近 7 日操作量与最近动作。' },
  { path: '/system/db', code: '03', title: '数据库维护', desc: '表行数与体积概览，历史操作日志清理。' },
  { path: '/system/announcements', code: '04', title: '系统公告', desc: '发布与下线面向三端的系统公告。' },
  { path: '/system/site', code: '05', title: '站点维护', desc: '运行时信息、知乎接口模式与项目结算参数。' },
  { path: '/audit-log', code: '06', title: '操作日志', desc: '全量操作与审计记录查询。' },
]
</script>

<template>
  <div class="page-stack">
    <header class="page-header">
      <div>
        <p class="section-index">01 / 系统工具</p>
        <h1>系统工具</h1>
        <p>平台级运维入口：数据同步、账号监控、公告与站点配置。</p>
      </div>
    </header>

    <div class="tools-grid">
      <router-link v-for="(t, i) in tools" :key="t.path" v-reveal="i * 45" :to="t.path" class="tool-card">
        <p class="tool-code">{{ t.code }}</p>
        <h3>{{ t.title }}</h3>
        <p class="tool-desc">{{ t.desc }}</p>
      </router-link>
    </div>
  </div>
</template>

<style scoped>
.tools-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
.tool-card {
  display: block;
  padding: 22px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--white);
  transition: border-color 0.15s ease, transform 0.15s ease;
}
.tool-card:hover { border-color: var(--ink); transform: translateY(-1px); }
.tool-code { margin: 0 0 10px; color: var(--clay); font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.16em; }
.tool-card h3 { margin: 0 0 8px; font-family: var(--font-display); font-size: 17px; }
.tool-desc { margin: 0; color: var(--ink-soft); font-size: 12px; line-height: 1.7; }
@media (max-width: 900px) { .tools-grid { grid-template-columns: 1fr; } }
</style>
