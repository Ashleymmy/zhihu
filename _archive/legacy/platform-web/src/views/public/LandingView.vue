<template>
  <div class="landing">
    <!-- Hero -->
    <section class="hero">
      <div class="hero-glow" />
      <div class="container hero-inner">
        <div class="hero-content">
          <div class="hero-badge">
            <span class="badge-pulse" /><span>知乎 OCE 绑词回传 · 正式上线</span>
          </div>
          <h1 class="hero-title">
            知乎推广<br>
            <span class="gradient-text">绑词回传，精准归因</span>
          </h1>
          <p class="hero-sub">
            全链路词条绑定 · 实时转化回传 · 多维数据分析<br>
            让每一分推广预算都精准可溯，助力ROI持续提升。
          </p>
          <div class="hero-actions">
            <router-link to="/login" class="cta-solid">免费开始使用</router-link>
            <router-link to="/dashboard/overview" class="cta-ghost">查看演示 →</router-link>
          </div>
          <div class="hero-proof">
            <div class="proof-avatars">
              <div v-for="(c, i) in avatarColors" :key="i" class="mini-av" :style="{ background: c, marginLeft: i ? '-7px' : '0' }">{{ chars[i] }}</div>
            </div>
            <span class="proof-txt">已有 <b>50万+</b> 运营者在使用</span>
          </div>
        </div>
        <!-- Visual -->
        <div class="hero-visual">
          <div class="dash-frame">
            <div class="frame-bar"><span/><span/><span/></div>
            <div class="frame-body">
              <div class="frame-sidebar">
                <div v-for="n in 5" :key="n" class="sb-item" :class="{ active: n === 1 }"/>
              </div>
              <div class="frame-content">
                <div class="frame-kpis">
                  <div v-for="(c, i) in frameKpis" :key="i" class="f-kpi" :style="{ borderColor: c.border }">
                    <div class="fk-v" :style="{ color: c.color }">{{ c.v }}</div>
                    <div class="fk-l">{{ c.l }}</div>
                  </div>
                </div>
                <div class="frame-chart">
                  <svg viewBox="0 0 260 80" fill="none" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#6366f1" stop-opacity="0.3"/>
                        <stop offset="100%" stop-color="#6366f1" stop-opacity="0"/>
                      </linearGradient>
                    </defs>
                    <path d="M0,65 C30,55 50,45 80,35 C110,25 130,40 160,25 C190,12 220,18 260,8 L260,80 L0,80 Z" fill="url(#cg)"/>
                    <path d="M0,65 C30,55 50,45 80,35 C110,25 130,40 160,25 C190,12 220,18 260,8" stroke="#6366f1" stroke-width="2" fill="none"/>
                  </svg>
                </div>
                <div class="frame-table">
                  <div v-for="n in 4" :key="n" class="ft-row"><div class="ft-c w40"/><div class="ft-c w20"/><div class="ft-c w20"/><div class="ft-c w10"/></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Stats bar -->
    <section class="stats-bar">
      <div class="container stats-inner">
        <div v-for="s in stats" :key="s.label" class="stat-item">
          <div class="stat-v">{{ s.val }}</div>
          <div class="stat-l">{{ s.label }}</div>
        </div>
      </div>
    </section>

    <!-- Features -->
    <section class="features section" id="features">
      <div class="container">
        <div class="sec-header">
          <div class="sec-badge">核心功能</div>
          <h2 class="sec-title">一站式推广运营管理</h2>
          <p class="sec-sub">从词条绑定到转化回传，完整覆盖知乎推广全链路</p>
        </div>
        <div class="features-grid">
          <div v-for="f in features" :key="f.title" class="feat-card">
            <div class="feat-icon" :style="{ background: f.bg }"><span v-html="f.icon"/></div>
            <h3 class="feat-title">{{ f.title }}</h3>
            <p class="feat-desc">{{ f.desc }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Core flow -->
    <section class="flow-section section-sm" id="core">
      <div class="container">
        <div class="sec-header"><div class="sec-badge">推广流程</div><h2 class="sec-title">三步完成绑词回传配置</h2></div>
        <div class="flow-steps">
          <div v-for="(step, i) in steps" :key="step.title" class="flow-step">
            <div class="step-num">{{ String(i + 1).padStart(2, '0') }}</div>
            <h4 class="step-title">{{ step.title }}</h4>
            <p class="step-desc">{{ step.desc }}</p>
          </div>
          <div class="flow-connector" />
        </div>
      </div>
    </section>

    <!-- CTA -->
    <section class="cta-section">
      <div class="container cta-inner">
        <h2 class="cta-title">准备好提升推广效率了吗？</h2>
        <p class="cta-sub">免费注册，5分钟完成首个推广计划配置</p>
        <router-link to="/login" class="cta-solid lg">立即免费注册</router-link>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
const avatarColors = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6']
const chars = ['王','李','张','赵','陈']
const stats = [
  { val: '50万+', label: '活跃运营者' }, { val: '98.5%', label: '回传成功率' },
  { val: '¥2亿+', label: '累计转化金额' }, { val: '1200+', label: '合作品牌' },
]
const frameKpis = [
  { v: '902K', l: '曝光', color: '#6366f1', border: 'rgba(99,102,241,0.3)' },
  { v: '35.2K', l: '点击', color: '#10b981', border: 'rgba(16,185,129,0.3)' },
  { v: '3,852', l: '转化', color: '#f59e0b', border: 'rgba(245,158,11,0.3)' },
]
const features = [
  { title: '绑词回传配置', desc: '一键配置知乎词条与转化回传接口，支持 install / register / purchase 等多类型事件追踪。', icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`, bg: 'rgba(99,102,241,0.15)' },
  { title: '词条精细化管理', desc: '批量导入关键词，实时追踪每个词条的绑定状态、曝光、点击与转化数据。', icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="13" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`, bg: 'rgba(16,185,129,0.15)' },
  { title: '推广计划管理', desc: '创建和管理知乎信息流推广计划，智能预算分配，实时监控消耗与投放进度。', icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`, bg: 'rgba(245,158,11,0.15)' },
  { title: '多维数据分析', desc: 'ECharts 可视化趋势图，CTR / CVR / CPC / ROI 多指标交叉分析，助力精准决策。', icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`, bg: 'rgba(59,130,246,0.15)' },
  { title: '实时日志告警', desc: '毫秒级回传日志记录，自动检测失败请求并告警，确保每次转化数据完整回传。', icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`, bg: 'rgba(239,68,68,0.15)' },
  { title: '安全签名验签', desc: '后端 BFF 计算 HMAC 签名，私钥不落前端，回传接口全程 HTTPS 加密保障。', icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`, bg: 'rgba(139,92,246,0.15)' },
]
const steps = [
  { title: '创建推广计划', desc: '在平台创建知乎信息流推广计划，设置目标应用、推广预算与投放周期。' },
  { title: '绑定词条', desc: '导入关键词并关联知乎内容 URL，平台自动完成词条与计划的绑定配置。' },
  { title: '配置回传接口', desc: '填写回传 URL 与事件类型，平台将转化事件实时推送至您的服务端并自动签名验证。' },
]
</script>

<style scoped>
.landing { background: var(--color-bg-primary); overflow-x: hidden; }
/* Hero */
.hero { position: relative; min-height: 100vh; display: flex; align-items: center; overflow: hidden; }
.hero-glow { position: absolute; top: -200px; right: -200px; width: 700px; height: 700px; background: radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 65%); pointer-events: none; }
.hero-inner { padding-top: 80px; padding-bottom: 80px; display: flex; align-items: center; gap: 64px; }
.hero-content { flex: 1; max-width: 520px; }
.hero-badge { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; background: var(--color-accent-subtle); border: 1px solid var(--color-accent-border); border-radius: var(--radius-full); font-size: 12.5px; color: var(--color-accent); font-weight: 500; margin-bottom: 24px; }
.badge-pulse { width: 6px; height: 6px; border-radius: 50%; background: var(--color-accent); animation: pulse 2s infinite; flex-shrink: 0; }
@keyframes pulse { 0%,100% { opacity:1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(1.3); } }
.hero-title { font-family: var(--font-display); font-size: 52px; font-weight: 700; line-height: 1.15; color: var(--color-text-primary); margin-bottom: 20px; }
.hero-sub { font-size: 15px; color: var(--color-text-tertiary); line-height: 1.75; margin-bottom: 32px; }
.hero-actions { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; }
.cta-solid { height: 44px; padding: 0 24px; background: var(--color-accent); border-radius: var(--radius-md); font-size: 14px; font-weight: 600; color: white; display: inline-flex; align-items: center; transition: all var(--transition-fast); }
.cta-solid:hover { background: var(--color-accent-hover); box-shadow: var(--shadow-glow); transform: translateY(-1px); }
.cta-solid.lg { height: 48px; padding: 0 32px; font-size: 15px; }
.cta-ghost { height: 44px; padding: 0 20px; border: 1px solid var(--color-border-hover); border-radius: var(--radius-md); font-size: 14px; color: var(--color-text-secondary); display: inline-flex; align-items: center; transition: all var(--transition-fast); }
.cta-ghost:hover { border-color: var(--color-accent); color: var(--color-accent); }
.hero-proof { display: flex; align-items: center; gap: 12px; }
.proof-avatars { display: flex; }
.mini-av { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: white; border: 2px solid var(--color-bg-primary); }
.proof-txt { font-size: 13px; color: var(--color-text-tertiary); }
.proof-txt b { color: var(--color-text-primary); }
/* Dashboard visual */
.hero-visual { flex: 1; max-width: 540px; }
.dash-frame { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-xl); overflow: hidden; box-shadow: var(--shadow-xl); }
.frame-bar { display: flex; gap: 6px; padding: 12px 16px; border-bottom: 1px solid var(--color-border); background: var(--color-bg-secondary); }
.frame-bar span { width: 10px; height: 10px; border-radius: 50%; background: var(--color-bg-active); }
.frame-body { display: flex; height: 320px; }
.frame-sidebar { width: 48px; background: var(--color-bg-secondary); border-right: 1px solid var(--color-border); padding: 12px 8px; display: flex; flex-direction: column; gap: 8px; }
.sb-item { height: 28px; background: var(--color-bg-active); border-radius: 5px; }
.sb-item.active { background: var(--color-accent-subtle); }
.frame-content { flex: 1; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.frame-kpis { display: flex; gap: 8px; }
.f-kpi { flex: 1; padding: 10px; background: var(--color-bg-tertiary); border: 1px solid; border-radius: 8px; }
.fk-v { font-family: var(--font-display); font-size: 15px; font-weight: 700; margin-bottom: 2px; }
.fk-l { font-size: 10px; color: var(--color-text-disabled); }
.frame-chart { flex: 1; background: var(--color-bg-tertiary); border-radius: 8px; overflow: hidden; }
.frame-chart svg { width: 100%; height: 100%; }
.frame-table { display: flex; flex-direction: column; gap: 6px; }
.ft-row { display: flex; gap: 8px; align-items: center; }
.ft-c { height: 7px; background: var(--color-bg-active); border-radius: 99px; }
.w40 { flex: 2; } .w20 { flex: 1; } .w10 { flex: 0.5; }
/* Stats bar */
.stats-bar { background: var(--color-bg-secondary); border-top: 1px solid var(--color-border); border-bottom: 1px solid var(--color-border); }
.stats-inner { display: flex; justify-content: center; gap: 0; padding: 28px 40px; }
.stat-item { flex: 1; text-align: center; }
.stat-item + .stat-item { border-left: 1px solid var(--color-border); }
.stat-v { font-family: var(--font-display); font-size: 26px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 4px; }
.stat-l { font-size: 12.5px; color: var(--color-text-disabled); }
/* Features */
.sec-header { text-align: center; margin-bottom: 56px; }
.sec-badge { display: inline-block; padding: 4px 14px; background: var(--color-accent-subtle); border: 1px solid var(--color-accent-border); border-radius: var(--radius-full); font-size: 12px; color: var(--color-accent); font-weight: 500; margin-bottom: 16px; }
.sec-title { font-family: var(--font-display); font-size: 34px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 12px; }
.sec-sub { font-size: 15px; color: var(--color-text-tertiary); }
.features-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.feat-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-xl); padding: 28px; transition: border-color var(--transition-base), transform var(--transition-base); }
.feat-card:hover { border-color: var(--color-border-hover); transform: translateY(-2px); }
.feat-icon { width: 44px; height: 44px; border-radius: var(--radius-lg); display: flex; align-items: center; justify-content: center; margin-bottom: 16px; }
.feat-title { font-size: 15px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 8px; }
.feat-desc { font-size: 13px; color: var(--color-text-tertiary); line-height: 1.65; }
/* Flow */
.flow-section { background: var(--color-bg-secondary); border-top: 1px solid var(--color-border); border-bottom: 1px solid var(--color-border); }
.flow-steps { display: flex; gap: 0; position: relative; }
.flow-connector { position: absolute; top: 28px; left: 56px; right: 56px; height: 1px; background: var(--gradient-accent); opacity: 0.3; }
.flow-step { flex: 1; padding: 28px 32px; position: relative; z-index: 1; }
.step-num { font-family: var(--font-display); font-size: 28px; font-weight: 700; color: var(--color-accent); margin-bottom: 12px; opacity: 0.7; }
.step-title { font-size: 15px; font-weight: 600; color: var(--color-text-primary); margin-bottom: 8px; }
.step-desc { font-size: 13px; color: var(--color-text-tertiary); line-height: 1.65; }
/* CTA */
.cta-section { padding: 96px 0; }
.cta-inner { text-align: center; }
.cta-title { font-family: var(--font-display); font-size: 36px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 14px; }
.cta-sub { font-size: 15px; color: var(--color-text-tertiary); margin-bottom: 32px; }
</style>
