<script setup lang="ts">
import {inject,onMounted,ref} from 'vue'
import type {PeriodState} from '../composables/usePeriodState'
import {errorText,requestKey} from '../../context'
import Modal from './Modal.vue'
const state=inject<PeriodState>('financeState')!,emit=defineEmits<{resume:[batch:Batch];analyze:[id:string]}>()
interface Batch{id:string;fileName:string;reportKind:string;status:string;createdAt:string;archivedAt:string|null}
interface Removal{id:string;fileName:string;reviewHash:string;rows:number;corrections:number}
const list=ref<Batch[]>([]),page=ref(1),total=ref(0),archived=ref(false),error=ref(''),notice=ref(''),busy=ref(false),target=ref<Removal|null>(null)
let key=requestKey()
async function run(fn:()=>Promise<void>){if(busy.value)return;busy.value=true;error.value='';try{await fn()}catch(e){error.value=errorText(e)}finally{busy.value=false}}
async function load(){const r=await state.context.http.get<{list:Batch[];total:number}>('/imports',{...state.context.scope,page:page.value,pageSize:10,archived:String(archived.value)});list.value=r.list;total.value=r.total}
async function download(b:Batch){const blob=await state.api.getImportFile(b.id),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=b.fileName;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function previewRemoval(b:Batch){target.value=await state.context.http.get<Removal>('/imports/'+b.id+'/withdrawal',state.context.scope);key=requestKey()}
async function remove(){if(!target.value)return;await state.context.http.post('/imports/'+target.value.id+'/withdrawal',{...state.context.scope,reviewHash:target.value.reviewHash,requestKey:key});target.value=null;notice.value='已撤销并移除上传记录；已确认的金额通过更正退回。';await load();await state.loadPeriod()}
async function archive(b:Batch){await state.context.http.post('/imports/'+b.id+'/archive',{...state.context.scope,archived:!archived.value,requestKey:requestKey()});notice.value=archived.value?'已恢复记录。':'已隐藏记录，金额保留，可在已隐藏记录中恢复。';await load()}
defineExpose({reload:()=>run(load)})
onMounted(()=>run(load))
</script>
<template><details class="card import-history"><summary>上传记录（全部日期）· 查看或撤销</summary><div class="row-actions"><button :disabled="busy" @click="archived=!archived;page=1;run(load)">{{archived?'返回上传记录':'已隐藏记录'}}</button><button :disabled="busy" @click="run(load)">刷新记录</button></div><p v-if="error&&!target" role="alert">{{error}}</p><p v-if="notice" role="status">{{notice}}</p><ul class="import-history-list"><li v-for="b in list" :key="b.id"><div><b>{{b.fileName}}</b><p class="small muted">{{b.reportKind==='activation'?'拉活':'拉新'}} · {{b.status==='preview'?'待确认导入':b.status==='committed'?'处理中':'已读取'}} · {{new Date(b.createdAt).toLocaleString('zh-CN')}}</p></div><div class="row-actions"><button v-if="b.status==='preview'" :disabled="busy" @click="emit('resume',b)">继续预览</button><button v-else :disabled="busy" @click="emit('analyze',b.id)">查看处理结果</button><details class="more-actions"><summary>更多</summary><div class="menu-actions"><button :disabled="busy" @click="run(()=>download(b))">下载原文件</button><button :disabled="busy" @click="run(()=>previewRemoval(b))">撤销导入</button><button :disabled="busy" @click="run(()=>archive(b))">{{archived?'恢复记录':'隐藏记录'}}</button></div></details></div></li></ul><p v-if="!busy&&!list.length" class="empty">还没有上传记录，请先选择报表。</p><div v-if="total>10" class="row-actions"><button :disabled="busy||page===1" @click="page--;run(load)">上一页</button><span>第 {{page}} 页</span><button :disabled="busy||page*10>=total" @click="page++;run(load)">下一页</button></div><Modal :open="!!target" :busy="busy" title="撤销这份报表" @close="target=null"><h3>撤销这份报表</h3><p>{{target?.fileName}} · {{target?.rows}} 行</p><p>撤回这份报表产生的业绩和未确认金额，已确认金额生成更正；其他仍有效的报表会保留。撤销后可以重新上传。</p><p v-if="error" role="alert">{{error}}</p><div class="footer"><button :disabled="busy" @click="target=null">取消</button><button class="primary" :disabled="busy" @click="run(remove)">确认撤销</button></div></Modal></details></template>
<style scoped>
summary{cursor:pointer}ul{list-style:none;padding:0}li{display:flex;gap:16px;justify-content:space-between;align-items:center;flex-wrap:wrap;padding:16px 0;border-bottom:1px solid var(--line)}li>div{min-width:0}b{overflow-wrap:anywhere}.more-actions{position:relative}.more-actions>summary{padding:8px 12px}.menu-actions{display:grid;gap:6px;position:absolute;right:0;z-index:3;background:white;border:1px solid var(--line);padding:8px;border-radius:8px;min-width:120px}.import-history>.row-actions{margin:14px 0}[role=alert]{color:var(--danger)}
</style>
