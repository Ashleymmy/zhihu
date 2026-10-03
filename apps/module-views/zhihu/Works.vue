<script setup lang="ts">
import {onMounted,onUnmounted,ref,watch} from 'vue'
import {errorText,type EngineContext} from './context'
import WorkDetail from './WorkDetail.vue'
import {upstreamReview,type WorkStatus} from './work-status'
const props=defineProps<{context:EngineContext;filters?:Record<string,string>;heading?:string}>()
interface Work extends WorkStatus{id:string;bindingId:string|null;planId:string;keyword:string;workUrl:string;description:string;verificationStatus:string;executorId:string;executorName:string;reason:string;compositionId:string|null;canEdit?:boolean}
const selected=ref<Work|null>(null)
const canOperate=()=>props.context.adminDuty!=='finance'
let generation=0
const list=ref<Work[]>([]),page=ref(1),total=ref(0),busy=ref(false),error=ref('')
async function refresh(){const n=++generation;busy.value=true;error.value='';try{const r=await props.context.http.get<{list:Work[];total:number}>('/workbench/works',{...props.context.scope,...props.filters,page:page.value,pageSize:25});if(n===generation){list.value=r.list;total.value=r.total}}catch(e){if(n===generation){error.value=errorText(e);list.value=[]}}finally{if(n===generation)busy.value=false}}
watch(()=>JSON.stringify([props.context.scope,props.context.userId,props.filters]),()=>{selected.value=null;list.value=[];page.value=1;void refresh()})
let poll:ReturnType<typeof setInterval>|undefined
onMounted(()=>{void refresh();poll=setInterval(()=>{if(!document.hidden)void refresh()},15000)})
onUnmounted(()=>{generation++;if(poll)clearInterval(poll)})
</script>
<template>
  <section class="work-card">
    <div class="section-heading"><div><h2>{{heading || '作品记录'}}</h2><p>登记后自动提交知乎，无需管理员逐条审核。需要修改时可直接打开原表单。</p></div><div class="engine-actions"><router-link v-if="canOperate()" class="engine-action-link" to="/modules/zhihu/works">登记推广作品</router-link><button :disabled="busy" @click="refresh">刷新</button></div></div>
    <p v-if="error" role="alert" class="engine-error">{{error}}</p>
    <div class="engine-table"><table>
      <thead><tr><th>关键词</th><th v-if="context.role!=='creator'">提交人</th><th>作品</th><th>提交与审核结果</th><th>操作</th></tr></thead>
      <tbody><tr v-for="w in list" :key="w.id">
        <td>{{w.keyword}}</td><td v-if="context.role!=='creator'">{{w.executorName||context.options.users.find(u=>u.id===w.executorId)?.displayName||'项目成员'}}</td>
        <td><a :href="w.workUrl" target="_blank" rel="noopener noreferrer">打开作品</a><p class="cell-note">{{w.description}}</p><small>{{w.source==='evidence'?'平台提交':'推广作品'}}</small></td>
        <td><template v-if="w.compositionId">{{upstreamReview(w).label}}<p class="cell-note">{{upstreamReview(w).reason}}</p></template><span v-else>尚未登记知乎推广作品</span></td>
        <td><button @click="selected=w">查看详情</button> <router-link v-if="canOperate() && w.canEdit && w.compositionId" :to="{path:'/modules/zhihu/works',query:{planId:w.planId,keyword:w.keyword,edit:w.compositionId}}">修改并重新提交</router-link><router-link v-else-if="canOperate() && w.planSyncStatus==='failed'" :to="{path:'/modules/zhihu/operations',query:{...context.scope,keyword:w.keyword,tab:'keywords'}}">修改关键词</router-link><p v-if="w.verificationStatus==='disputed'" class="cell-note">该作品存在归属争议，等待处理。</p></td>
      </tr></tbody>
    </table></div>
    <p class="empty-state" v-if="!list.length&&!busy">当前项目与账号下暂无作品。</p>

    <div class="engine-actions" v-if="total>25"><button :disabled="page===1||busy" @click="page--;refresh()">上一页</button><span>第 {{page}} 页，共 {{total}} 条</span><button :disabled="page*25>=total||busy" @click="page++;refresh()">下一页</button></div>
  <WorkDetail :work="selected" :http="context.http" :scope="context.scope" @close="selected=null" />
  </section>
</template>

<style scoped>
.engine-action-link{display:inline-flex;align-items:center;min-height:40px;padding:0 15px;border-radius:8px;background:#195e62;color:#fff;text-decoration:none}
.engine-action-link:hover{background:#124b4e}
</style>

