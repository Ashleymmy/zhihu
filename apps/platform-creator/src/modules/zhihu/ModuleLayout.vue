<script setup lang="ts">
import {computed} from 'vue'
import {useAuthStore} from '../../stores/auth'
import {modulePages} from './routes'
const auth=useAuthStore()
const available=computed(()=>modulePages.filter(p=>{
 if(auth.user?.role!=='admin')return true
 if((auth.user.adminDuty??'all')==='all')return p.path!=='wallet'
 const duty=auth.user.adminDuty
 return p.path==='dashboard'||(duty==='finance'?['finance','data-import','settlements','earnings','withdrawals','appeals','orders'].includes(p.path):!['finance','wallet','settlements','earnings','withdrawals','appeals','data-import'].includes(p.path))
}))
const daily=computed(()=>available.value.filter(p=>['dashboard','operations','plans','finance','wallet'].includes(p.path)))
const more=computed(()=>available.value.filter(p=>!daily.value.includes(p)&&p.path!=='keywords'))
function label(path:string,title:unknown){return path==='operations'?(auth.user?.role==='creator'?'我的关键词':'关键词与团队'):String(title)}
</script>
<template><section class="zhihu-module page-stack">
<nav class="module-toolbar" aria-label="知乎业务导航">
 <router-link v-for="p in daily" :key="p.path" :to="'/modules/zhihu/'+p.path">{{label(p.path,p.meta?.title)}}</router-link>
 <router-link class="back" to="/dashboard">OPC 工作台</router-link>
 <details v-if="more.length"><summary>更多功能</summary><div class="history-links"><router-link v-for="p in more" :key="p.path" :to="'/modules/zhihu/'+p.path">{{p.meta?.title}}</router-link></div></details>
</nav><router-view /></section></template>
<style scoped>
.module-toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 16px;border:1px solid var(--line);border-radius:12px;background:var(--paper)}
.module-toolbar>a{padding:8px 12px;border-radius:7px;font-size:14px;text-decoration:none}
.module-toolbar .router-link-active{background:#195e62;color:white}.module-toolbar .back{margin-left:auto}
.module-toolbar details{position:relative;font-size:12px}.module-toolbar summary{cursor:pointer}
.history-links{position:absolute;right:0;top:28px;z-index:20;width:min(280px,80vw);max-height:400px;overflow:auto;box-shadow:0 8px 30px #0002;padding:18px;background:var(--paper);border:1px solid var(--line);border-radius:10px}.history-links a{display:block;padding:7px}

.zhihu-module { min-width: 0; grid-template-columns: minmax(0, 1fr); }
.zhihu-module > :deep(*) { min-width: 0; }
@media (max-width: 700px) {
  .module-toolbar { gap: 6px; padding: 10px; }
  .module-toolbar > a { flex: 1 1 auto; padding: 10px 8px; text-align: center; }
  .module-toolbar .back { margin-left: 0; }
  .module-toolbar details { flex: 1 1 100%; }
  .module-toolbar summary { padding: 12px 8px; text-align: center; }
  .history-links { position: static; width: 100%; max-height: min(400px, 60dvh); margin-top: 6px; padding: 8px; box-shadow: none; }
  .history-links a { min-height: 44px; padding: 12px 8px; }
}

</style>
