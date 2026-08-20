<template>
  <div class="pub-layout">
    <header class="pub-nav" :class="{ scrolled: scrolled }">
      <div class="nav-inner">
        <router-link to="/" class="nav-logo">
          <div class="logo-hex"><svg width="14" height="14" viewBox="0 0 24 24" fill="white"><polygon points="12 2 22 8 22 16 12 22 2 16 2 8"/></svg></div>
          <span>OPC <em>Platform</em></span>
        </router-link>
        <nav class="nav-links">
          <a href="#features">功能介绍</a>
          <a href="#core">核心能力</a>
          <a href="#how">合作流程</a>
        </nav>
        <div class="nav-actions">
          <router-link to="/login" class="nav-btn-ghost">登录</router-link>
          <router-link to="/login" class="nav-btn-solid">免费开始</router-link>
        </div>
      </div>
    </header>

    <main><router-view /></main>

    <footer class="pub-footer">
      <div class="footer-inner">
        <div class="footer-brand">
          <div class="footer-logo"><div class="logo-hex sm"><svg width="12" height="12" viewBox="0 0 24 24" fill="white"><polygon points="12 2 22 8 22 16 12 22 2 16 2 8"/></svg></div> OPC Platform</div>
          <p>知乎推广运营一体化平台</p>
          <div class="footer-socials"><span>微信</span><span>微博</span><span>抖音</span></div>
        </div>
        <div class="footer-links">
          <div class="fc"><b>产品</b><a href="#">推广计划</a><a href="#">词条管理</a><a href="#">绑词回传</a><a href="#">数据分析</a></div>
          <div class="fc"><b>合作</b><a href="#">品牌入驻</a><a href="#">MCN合作</a><a href="#">API接入</a><a href="#">联系我们</a></div>
          <div class="fc"><b>帮助</b><a href="#">新手指南</a><a href="#">结算规则</a><a href="#">常见问题</a><a href="#">违规说明</a></div>
          <div class="fc"><b>关于</b><a href="#">关于我们</a><a href="#">用户协议</a><a href="#">隐私政策</a><a href="#">廉洁举报</a></div>
        </div>
      </div>
      <div class="footer-bottom"><span>© 2026 OPC 运营平台 · 保留所有权利</span><span>浙ICP备XXXXXXXX号</span></div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
const scrolled = ref(false)
const onScroll = () => { scrolled.value = window.scrollY > 50 }
onMounted(() => window.addEventListener('scroll', onScroll))
onUnmounted(() => window.removeEventListener('scroll', onScroll))
</script>

<style scoped>
.pub-layout { min-height: 100vh; display: flex; flex-direction: column; background: var(--color-bg-primary); }
.pub-nav {
  position: fixed; top: 0; left: 0; right: 0; z-index: 100;
  height: 64px; transition: background var(--transition-base), border-color var(--transition-base);
  border-bottom: 1px solid transparent;
}
.pub-nav.scrolled { background: rgba(7,8,12,0.92); backdrop-filter: blur(16px); border-color: var(--color-border); }
.nav-inner { max-width: var(--content-max-width); margin: 0 auto; padding: 0 40px; height: 64px; display: flex; align-items: center; gap: 40px; }
.nav-logo { display: flex; align-items: center; gap: 10px; font-family: var(--font-display); font-size: 16px; font-weight: 700; color: var(--color-text-primary); }
.nav-logo em { font-style: normal; color: var(--color-accent); }
.logo-hex { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: var(--color-accent); border-radius: 7px; flex-shrink: 0; }
.logo-hex.sm { width: 22px; height: 22px; border-radius: 5px; }
.nav-links { display: flex; gap: 32px; flex: 1; }
.nav-links a { font-size: 13.5px; color: var(--color-text-tertiary); font-weight: 500; transition: color var(--transition-fast); }
.nav-links a:hover { color: var(--color-text-primary); }
.nav-actions { display: flex; align-items: center; gap: 8px; }
.nav-btn-ghost { height: 34px; padding: 0 16px; border: 1px solid var(--color-border-hover); border-radius: var(--radius-md); font-size: 13px; color: var(--color-text-secondary); display: inline-flex; align-items: center; transition: all var(--transition-fast); }
.nav-btn-ghost:hover { border-color: var(--color-accent); color: var(--color-accent); }
.nav-btn-solid { height: 34px; padding: 0 18px; background: var(--color-accent); border-radius: var(--radius-md); font-size: 13px; font-weight: 600; color: white; display: inline-flex; align-items: center; transition: all var(--transition-fast); }
.nav-btn-solid:hover { background: var(--color-accent-hover); box-shadow: var(--shadow-glow); transform: translateY(-1px); }
.pub-footer { background: var(--color-bg-secondary); border-top: 1px solid var(--color-border); margin-top: auto; }
.footer-inner { max-width: var(--content-max-width); margin: 0 auto; padding: 48px 40px 40px; display: flex; gap: 64px; align-items: flex-start; }
.footer-brand { flex-shrink: 0; min-width: 180px; }
.footer-logo { display: flex; align-items: center; gap: 8px; font-family: var(--font-display); font-size: 15px; font-weight: 700; color: var(--color-text-primary); margin-bottom: 8px; }
.footer-brand p { font-size: 12.5px; color: var(--color-text-disabled); margin-bottom: 14px; }
.footer-socials { display: flex; gap: 6px; }
.footer-socials span { padding: 3px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-full); font-size: 11.5px; color: var(--color-text-tertiary); cursor: pointer; transition: all var(--transition-fast); }
.footer-socials span:hover { border-color: var(--color-accent); color: var(--color-accent); }
.footer-links { flex: 1; display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; }
.fc { display: flex; flex-direction: column; gap: 9px; }
.fc b { font-size: 12.5px; font-weight: 600; color: var(--color-text-secondary); margin-bottom: 2px; }
.fc a { font-size: 12.5px; color: var(--color-text-disabled); transition: color var(--transition-fast); }
.fc a:hover { color: var(--color-text-secondary); }
.footer-bottom { border-top: 1px solid var(--color-border); padding: 14px 40px; display: flex; justify-content: space-between; font-size: 11.5px; color: var(--color-text-disabled); max-width: var(--content-max-width); margin: 0 auto; }
</style>
