<script setup lang="ts">
import {onMounted,onUnmounted,ref} from 'vue'
import {errorText,requestKey,type EngineContext} from './context'
import {upstreamReview,type WorkStatus} from './work-status'
const props=defineProps<{context:EngineContext}>()
interface Work extends WorkStatus{id:string;bindingId:string|null;planId:string;keyword:string;workUrl:string;description:string;verificationStatus:string;executorId:string;executorName:string;reason:string;compositionId:string|null}
const list=ref<Work[]>([]),page=ref(1),total=ref(0),busy=ref(false),error=ref(''),notice=ref(''),selected=ref<Work|null>(null),reason=ref('')
const canReview=(w:Work)=>w.source==='evidence'&&(props.context.role==='admin'||props.context.role==='leader'&&w.executorId!==props.context.userId)
const syncLabels:Record<string,string>={local:'待提交知乎',syncing:'知乎提交中',synced:'已提交知乎',failed:'知乎提交失败',simulated:'联测作品'}
async function load(){const r=await props.context.http.get<{list:Work[];total:number}>('/workbench/works',{...props.context.scope,page:page.value,pageSize:25});list.value=r.list;total.value=r.total}
async function review(w:Work,accept:boolean){if(busy.value||!canReview(w))return;busy.value=true;error.value='';try{await props.context.http.post('/evidence/'+w.id+'/review',{...props.context.scope,requestKey:requestKey(),accept,reason:accept?'已核对作品链接及关键词使用情况':reason.value});selected.value=null;notice.value=accept?'作品已通过平台审核，相关账单可以继续处理。':'已退回作品，请提交人修改。';await load()}catch(e){error.value=errorText(e)}finally{busy.value=false}}
async function refresh(){if(busy.value)return;busy.value=true;error.value='';try{await load()}catch(e){error.value=errorText(e)}finally{busy.value=false}}
let poll:ReturnType<typeof setInterval>|undefined
onMounted(()=>{void refresh();poll=setInterval(()=>{if(!document.hidden&&!selected.value)void refresh()},15000)})
onUnmounted(()=>{if(poll)clearInterval(poll)})
</script>
<template>
  <section class="work-card">
    <div class="section-heading"><div><h2>{{context.role==='creator'?'作品审核进度':'作品审核'}}</h2><p>汇总平台提交与推广作品，分别显示平台核验和知乎审核结果。</p></div><div class="engine-actions"><router-link class="engine-action-link" to="/modules/zhihu/works">登记推广作品</router-link><button :disabled="busy" @click="refresh">刷新</button></div></div>
    <p v-if="error" role="alert" class="engine-error">{{error}}</p><p v-if="notice" role="status">{{notice}}</p>
    <div class="engine-table"><table>
      <thead><tr><th>关键词</th><th v-if="context.role!=='creator'">提交人</th><th>作品</th><th>平台核验</th><th>知乎审核</th><th>操作</th></tr></thead>
      <tbody><tr v-for="w in list" :key="w.id">
        <td>{{w.keyword}}</td><td v-if="context.role!=='creator'">{{w.executorName||context.options.users.find(u=>u.id===w.executorId)?.displayName||'项目成员'}}</td>
        <td><a :href="w.workUrl" target="_blank" rel="noopener noreferrer">打开作品</a><p class="cell-note">{{w.description}}</p><small>{{w.source==='evidence'?'平台提交':'推广作品'}}</small></td>
        <td>{{w.source==='composition'?'未提交平台核验':w.status==='passed'?'已通过':w.status==='rejected'?'请修改后重新提交':'待审核'}}<p v-if="w.source==='evidence'" class="cell-note">{{w.reason}}</p></td>
        <td><template v-if="w.compositionId">{{upstreamReview(w).label}}<small>{{syncLabels[w.syncStatus||'']||w.syncStatus}}</small><p class="cell-note">{{upstreamReview(w).reason}}</p></template><span v-else>尚未登记知乎推广作品</span></td>
        <td><div v-if="w.status==='pending'&&canReview(w)" class="engine-actions"><button class="primary" :disabled="busy" @click="review(w,true)">审核通过</button><button :disabled="busy" @click="selected=w;reason=''">退回修改</button></div><router-link v-if="w.compositionId" :to="{path:'/modules/zhihu/works',query:{planId:w.planId,keyword:w.keyword}}">管理推广作品</router-link></td>
      </tr></tbody>
    </table></div>
    <p class="empty-state" v-if="!list.length&&!busy">当前项目与账号下暂无作品。</p>
    <form v-if="selected" class="confirm-box" @submit.prevent="review(selected,false)"><h2>退回：{{selected.keyword}}</h2><label>需要修改什么<textarea v-model="reason" required maxlength="500" /></label><button :disabled="busy">确认退回</button><button type="button" @click="selected=null">取消</button></form>
    <div class="engine-actions" v-if="total>25"><button :disabled="page===1||busy" @click="page--;refresh()">上一页</button><span>第 {{page}} 页，共 {{total}} 条</span><button :disabled="page*25>=total||busy" @click="page++;refresh()">下一页</button></div>
  </section>
</template>

<style scoped>
.engine-action-link{display:inline-flex;align-items:center;min-height:40px;padding:0 15px;border-radius:8px;background:#195e62;color:#fff;text-decoration:none}
.engine-action-link:hover{background:#124b4e}
</style>

