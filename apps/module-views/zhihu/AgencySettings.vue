<script setup lang="ts">
import {ref,watch} from 'vue'
import type {HttpClient} from '@zhihu-koc/shared-services/core'
import {DetailDrawer} from '@zhihu-koc/shared-components'
import {errorText,requestKey,type Scope} from './context'
const props=defineProps<{http:HttpClient;scope:Scope;open:boolean}>()
const emit=defineEmits<{close:[];saved:[]}>()
const name=ref(''),expected=ref<string|null>(null),reportedNames=ref<string[]>([]),busy=ref(false),loading=ref(false),loaded=ref(false),error=ref('')
let generation=0
async function load(){const ticket=++generation;loading.value=true;loaded.value=false;error.value='';try{const value=await props.http.get<{agencyName:string|null;reportedNames:string[]}>('/project-agency',props.scope);if(ticket!==generation)return;name.value=value.agencyName??'';expected.value=value.agencyName;reportedNames.value=value.reportedNames;loaded.value=true}catch(e){if(ticket===generation)error.value=errorText(e)}finally{if(ticket===generation)loading.value=false}}
watch(()=>[props.open,props.scope.projectId,props.scope.accountId],()=>{if(props.open)void load();else generation++},{immediate:true})
async function save(){if(busy.value||!loaded.value)return;busy.value=true;error.value='';try{await props.http.post('/project-agency',{...props.scope,name:name.value,expected:expected.value,requestKey:requestKey()});emit('saved')}catch(e){error.value=errorText(e)}finally{busy.value=false}}
</script>
<template><DetailDrawer :open="open" title="拉活代理名称" @close="!busy&&emit('close')"><form class="agency-settings" @submit.prevent="save">
<p v-if="loading" role="status">正在读取代理名称…</p><p v-if="error" role="alert">{{error}} <button type="button" :disabled="busy||loading" @click="load">重新读取</button></p>
<template v-if="loaded"><p>项目登记：<strong>{{expected??'尚未填写'}}</strong></p><div v-if="reportedNames.length"><p>未确认报表中的代理名称：</p><ul><li v-for="item in reportedNames" :key="item">{{item}}</li></ul></div>
<label>本项目的代理名称<input v-model="name" required maxlength="200" :disabled="busy" autocomplete="off" placeholder="填写实际签约的代理名称" /></label><p>保存后自动核对未确认的拉活报表。其他代理的报表请更换为本项目的报表。</p>
<button class="primary" :disabled="busy||!name.trim()">{{busy?'正在保存…':'保存并核对'}}</button></template></form></DetailDrawer></template>
<style scoped>.agency-settings{display:grid;gap:18px;overflow-wrap:anywhere}.agency-settings p{margin:0}.agency-settings label{display:grid;gap:8px}.agency-settings input{box-sizing:border-box;width:100%;min-width:0;padding:11px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;background:var(--paper,#fff);color:inherit}.agency-settings button{min-height:44px;padding:10px 16px;border:1px solid #195e62;border-radius:8px;font:inherit;cursor:pointer}.agency-settings .primary{background:#195e62;color:#fff;justify-self:start}.agency-settings button:disabled{opacity:.5;cursor:wait}</style>
