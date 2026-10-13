<script setup lang="ts">
import {onMounted,onUnmounted,ref,watch} from 'vue'
import {errorText,type EngineContext} from './context'
import WorkDetail from './WorkDetail.vue'
import HistoricalWorks from './HistoricalWorks.vue'
import {upstreamReview,evidenceReview,type WorkStatus} from './work-status'
const props=defineProps<{context:EngineContext;filters?:Record<string,string>;heading?:string}>()
interface Work extends WorkStatus{id:string;bindingId:string|null;planId:string;keyword:string;workUrl:string;description:string;verificationStatus:string;executorId:string;executorName:string;reason:string;compositionId:string|null;canEdit?:boolean}
const selected=ref<Work|null>(null)
const canOperate=()=>props.context.adminDuty!=='finance'
let generation=0
const list=ref<Work[]>([]),page=ref(1),total=ref(0),busy=ref(false),error=ref('')
const search=ref(''),appliedSearch=ref('')
async function refresh(){const n=++generation;busy.value=true;error.value='';try{const r=await props.context.http.get<{list:Work[];total:number}>('/workbench/works',{...props.context.scope,...props.filters,search:appliedSearch.value||undefined,page:page.value,pageSize:25});if(n===generation){list.value=r.list;total.value=r.total}}catch(e){if(n===generation){error.value=errorText(e);list.value=[];total.value=0}}finally{if(n===generation)busy.value=false}}
function findWorks(){appliedSearch.value=search.value.trim();page.value=1;selected.value=null;void refresh()}
function clearSearch(){search.value='';findWorks()}
watch(()=>JSON.stringify([props.context.scope,props.context.userId,props.filters]),()=>{selected.value=null;list.value=[];page.value=1;search.value='';appliedSearch.value='';void refresh()})
let poll:ReturnType<typeof setInterval>|undefined
onMounted(()=>{void refresh();poll=setInterval(()=>{if(!document.hidden)void refresh()},15000)})
onUnmounted(()=>{generation++;if(poll)clearInterval(poll)})
</script>
<template>
  <section class="work-card">
    <HistoricalWorks v-if="canOperate()" :context="context" @changed="refresh" />
    <div class="section-heading"><div><h2>{{heading || '作品记录'}}</h2><p>查看已提交的作品及核验结果。</p></div><div class="engine-actions"><router-link v-if="canOperate()" class="engine-action-link" to="/modules/zhihu/works">登记推广作品</router-link><button :disabled="busy" @click="refresh">刷新</button></div></div>
    <form class="work-search" role="search" aria-label="搜索作品" @submit.prevent="findWorks"><label>搜索作品<input v-model="search" type="search" maxlength="200" placeholder="关键词、作品名称、提交人或链接" /></label><div class="engine-actions"><button type="submit" :disabled="busy">搜索</button><button v-if="search||appliedSearch" type="button" :disabled="busy" @click="clearSearch">清空</button></div></form>
    <p v-if="!error" class="work-count" role="status">{{busy?'正在读取作品…':`共 ${total} 条作品${appliedSearch?'符合搜索条件':''}`}}</p>
    <p v-if="error" role="alert" class="engine-error">{{error}}</p>
    <div class="engine-table works-table"><table>
      <thead><tr><th>关键词</th><th v-if="context.role!=='creator'">提交人</th><th>作品</th><th>提交与审核结果</th><th>操作</th></tr></thead>
      <tbody><tr v-for="w in list" :key="w.id">
        <td data-label="关键词">{{w.keyword}}</td><td v-if="context.role!=='creator'" data-label="提交人">{{w.executorName||context.options.users.find(u=>u.id===w.executorId)?.displayName||'项目成员'}}</td>
        <td data-label="作品"><a :href="w.workUrl" target="_blank" rel="noopener noreferrer">打开作品</a><p class="cell-note">{{w.description}}</p><small>{{w.source==='evidence'?'平台提交':'推广作品'}}</small></td>
        <td data-label="提交与审核结果">{{(w.compositionId?upstreamReview(w):evidenceReview(w)).label}}<p class="cell-note">{{(w.compositionId?upstreamReview(w):evidenceReview(w)).reason}}</p></td>
        <td data-label="操作"><button @click="selected=w">查看详情</button> <router-link v-if="canOperate() && w.canEdit && w.compositionId" :to="{path:'/modules/zhihu/works',query:{planId:w.planId,keyword:w.keyword,edit:w.compositionId}}">修改并重新提交</router-link><router-link v-else-if="canOperate() && w.planSyncStatus==='failed'" :to="{path:'/modules/zhihu/operations',query:{...context.scope,keyword:w.keyword,tab:'keywords'}}">修改关键词</router-link><p v-if="w.verificationStatus==='disputed'" class="cell-note">该作品存在归属争议，等待处理。</p></td>
      </tr></tbody>
    </table></div>
    <div class="empty-state" v-if="!list.length&&!busy&&!error"><template v-if="appliedSearch"><p>没有找到匹配的作品，换个搜索词试试。</p><button @click="clearSearch">查看全部作品</button></template><p v-else>{{canOperate()?'还没有作品，点击“登记推广作品”添加第一条。':'还没有作品，成员登记后会显示在这里。'}}</p></div>

    <div class="engine-actions" v-if="total>25"><button :disabled="page===1||busy" @click="page--;refresh()">上一页</button><span>第 {{page}} 页，共 {{total}} 条</span><button :disabled="page*25>=total||busy" @click="page++;refresh()">下一页</button></div>
  <WorkDetail :work="selected" :http="context.http" :scope="context.scope" @close="selected=null" />
  </section>
</template>

<style scoped>
.work-search{margin-top:20px}.work-search label{flex:0 1 440px;min-width:0}.work-count{font-size:13px;margin:12px 0 0}
.engine-action-link{display:inline-flex;align-items:center;min-height:40px;padding:0 15px;border-radius:8px;background:#195e62;color:#fff;text-decoration:none}
.engine-action-link:hover{background:#124b4e}
@media(max-width:700px){.work-card .works-table table{min-width:0}.works-table table,.works-table tbody,.works-table tr,.works-table td{display:block}.works-table thead{display:none}.works-table tr{padding:12px 0;border-bottom:1px solid var(--line,#dce3e5)}.work-card .works-table td{border:0;padding:6px 0;white-space:normal;overflow-wrap:anywhere}.works-table td::before{content:attr(data-label);display:block;font-size:12px;color:var(--ink-soft,#637078);margin-bottom:4px}.work-card .works-table td .cell-note{max-width:100%}}
</style>

