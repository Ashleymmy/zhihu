<script setup lang="ts">
import { ref,onMounted } from 'vue'
import type { MiniMonitor } from '@zhihu-koc/shared-contracts/core'
import { apis } from '../stores/auth'
import { miniFailureLabel } from '../mini-status'
const data=ref<MiniMonitor|null>(null),loading=ref(false),error=ref('')
const format=(date?:string|null)=>date?new Date(date).toLocaleString('zh-CN'):'暂无观测'
const envLabel=(env:string|null)=>env?({develop:'开发版',trial:'体验版',release:'正式版'}[env]||env):'未上报'
async function load(){if(loading.value)return;loading.value=true;error.value='';try{data.value=await apis.adminTools.miniMonitor()}catch(e:any){error.value=e?.message||'小程序状态读取失败'}finally{loading.value=false}}
onMounted(load)
</script>
<template>
  <section class="panel mini-monitor" aria-labelledby="mini-monitor-title">
    <header class="mini-heading"><div><p class="section-index">微信小程序</p><h2 id="mini-monitor-title">接入与业务状态</h2><p>双端共用账号与数据，分别检查绑定、登录和项目权限。</p></div><button class="row-action" :disabled="loading" @click="load">{{ loading?'检查中…':'刷新状态' }}</button></header>
    <p v-if="error" class="mini-error" role="alert">{{ error }}<span v-if="data"> 以下保留上次结果，请以检查时间为准。</span></p>
    <p v-if="!data&&loading" role="status">正在读取小程序状态…</p>
    <template v-if="data">
      <div class="mini-grid">
        <router-link class="mini-stat" to="/team?mini=bound"><span>已绑定微信</span><strong>{{ data.business.boundAccounts }}</strong><small>查看成员 →</small></router-link>
        <div class="mini-stat"><span>有有效小程序会话的账号</span><strong>{{ data.business.validMiniSessions }}</strong><small>有效会话不等于在线人数</small></div>
        <router-link class="mini-stat" to="/team?mini=no-project"><span>已绑定 · 待分配项目</span><strong>{{ data.business.boundNoProject }}</strong><small>启用中的达人 · 去分配 →</small></router-link>
        <router-link class="mini-stat" to="/team?mini=conflict"><span>近期绑定冲突</span><strong>{{ data.business.bindingConflicts }}</strong><small>近 7 天内、尚未再次成功登录 →</small></router-link>
      </div>
      <div class="mini-data-row"><p><strong>公共学院：</strong>已上架 {{ data.business.publishedCourses }} / {{ data.business.totalCourses }} 门<span v-if="!data.business.publishedCourses" class="mini-warning"> · 当前没有可展示的公共课程，请核对上架安排。</span></p><p><strong>业务项目：</strong>{{ data.business.enabledProjects }} 个启用项目 · 知乎模块{{ data.business.zhihuEnabled?'已启用':'未启用' }}</p><p>数据读取时间：{{ format(data.readAt) }}</p></div>
      <template v-if="data.technical">
        <h3>云函数到服务器</h3>
        <p>服务器接入{{ data.technical.configured?'已配置':'未配置完整' }} · 数据库可读取</p>
        <div class="mini-grid">
          <div class="mini-stat"><span>最近成功请求</span><strong class="mini-time">{{ format(data.technical.lastSuccessAt) }}</strong><small>最近 24 小时 · 无请求时无法判断链路状态</small></div>
          <div class="mini-stat"><span>已验证来源的请求</span><strong>{{ data.technical.requests }}</strong><small>近 24 小时</small></div>
          <div class="mini-stat"><span>服务器错误率</span><strong>{{ data.technical.failureRate===null?'暂无观测':(data.technical.failureRate*100).toFixed(1)+'%' }}</strong><small>{{ data.technical.serverErrors }} 次服务错误 · {{ data.technical.rejected }} 次登录、权限或业务拒绝</small></div>
          <div class="mini-stat"><span>平均业务处理耗时</span><strong>{{ data.technical.averageMs===null?'暂无观测':data.technical.averageMs+' ms' }}</strong><small>不含客户端网络与云函数请求耗时</small></div>
        </div>
        <p class="mini-note">仅统计已通过签名与来源校验、到达服务器的请求。到达前的网络或云函数故障需结合微信云日志排查；没有观测数据不会标记为正常。</p>
        <p v-if="data.technical.writer.dropped||data.technical.writer.failures" class="mini-error" role="alert">本次服务启动后监控记录曾丢失 {{ data.technical.writer.dropped }} 条，记录维护失败 {{ data.technical.writer.failures }} 次；统计可能不完整。最近失败：{{ format(data.technical.writer.lastFailureAt) }}</p>
        <dl class="mini-deployment"><dt>小程序 AppID</dt><dd>{{ data.technical.appId||'未配置' }}</dd><dt>最近观测云环境</dt><dd>{{ data.technical.deployment?.cloudEnv||'暂无观测' }}</dd><dt>云桥版本</dt><dd>{{ data.technical.deployment?.bridgeVersion||'暂无观测' }}</dd><dt>环境观测时间</dt><dd>{{ format(data.technical.deployment?.occurredAt) }}</dd></dl>
        <h3>最近访问版本</h3><p class="mini-note">客户端上报，供排查版本差异；不代表微信后台的审核或发布状态。</p>
        <ul v-if="data.technical.clientVersions.length" class="mini-versions"><li v-for="v in data.technical.clientVersions" :key="v.clientEnv+'-'+v.clientVersion">{{ envLabel(v.clientEnv) }} {{ v.clientVersion }} · {{ v.requests }} 次请求 · {{ format(v.lastSeenAt) }}</li></ul><p v-else>暂无版本上报，旧客户端仍可正常使用。</p>
        <h3>最近未完成请求</h3>
        <div v-if="data.technical.failures.length" class="mini-table"><table><thead><tr><th>时间 / 接口</th><th>结果</th><th>关联成员</th></tr></thead><tbody><tr v-for="f in data.technical.failures" :key="f.id"><td>{{ format(f.occurredAt) }}<small>{{ f.method }} {{ f.routeKey }}</small></td><td>{{ miniFailureLabel(f.resultCode,f.httpStatus) }}<small>HTTP {{ f.httpStatus }} · {{ f.resultCode }}</small></td><td><router-link v-if="f.userId" :to="{path:'/team',query:{member:f.userId}}">{{ f.displayName||'查看成员' }} →</router-link><span v-else>尚未识别账号</span></td></tr></tbody></table></div>
        <p v-else>{{ data.technical.requests?'最近 24 小时未记录到失败请求。':'暂无请求记录，尚不能判断。' }}</p>
      </template>
    </template>
  </section>
</template>
<style scoped>
.mini-monitor{padding:24px}.mini-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:20px}.mini-heading h2{margin:4px 0 8px}.mini-heading p{margin:0;color:var(--ink-soft,#64716b)}.mini-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:16px 0}.mini-stat{display:flex;flex-direction:column;gap:8px;border:1px solid var(--line,#dfe4e0);padding:16px;border-radius:8px;color:inherit;text-decoration:none}.mini-stat strong{font-size:26px;line-height:1.3}.mini-stat small,.mini-note{font-size:12px;color:var(--ink-soft,#64716b);line-height:1.6}.mini-stat .mini-time{font-size:16px}.mini-monitor h3{margin-top:26px}.mini-data-row{line-height:1.7}.mini-deployment{display:grid;grid-template-columns:160px 1fr;gap:8px}.mini-deployment dd{margin:0;overflow-wrap:anywhere}.mini-deployment dt{color:var(--ink-soft,#64716b)}.mini-error,.mini-warning{color:#964639}.mini-versions{padding-left:20px;line-height:1.8}.mini-table{overflow-x:auto}.mini-table table{border-collapse:collapse;width:100%}.mini-table td,.mini-table th{text-align:left;padding:12px 8px;border-bottom:1px solid var(--line,#dfe4e0)}.mini-table small{display:block;margin-top:5px;font-size:12px;color:var(--ink-soft,#64716b)}@media(max-width:1000px){.mini-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.mini-monitor{padding:16px}.mini-grid{grid-template-columns:1fr}.mini-deployment{grid-template-columns:1fr}.mini-deployment dd{margin-bottom:8px}.mini-heading{flex-wrap:wrap}}
</style>
