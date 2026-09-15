<script setup lang="ts">
import {onMounted,reactive,ref} from 'vue'
interface Http{get<T>(p:string):Promise<T>;post<T>(p:string,b:object):Promise<T>;patch<T>(p:string,b:object):Promise<T>}
const props=defineProps<{http:Http}>()
interface Staff{id:string;username:string;displayName:string;adminDuty:string;isActive:boolean}
const list=ref<Staff[]>([]),busy=ref(false),error=ref(''),notice=ref(''),form=reactive({username:'',displayName:'',duty:'operations'})
async function load(){list.value=await props.http.get<Staff[]>('/staff')}
async function run(fn:()=>Promise<unknown>){busy.value=true;error.value='';try{await fn()}catch(e){error.value=e instanceof Error?e.message:'操作失败'}finally{busy.value=false}}
async function create(){const result=await props.http.post<{username:string;temporaryPassword:string}>('/staff',form);notice.value='账号：'+result.username+'；临时密码：'+result.temporaryPassword+'。请告知对应使用人并修改密码。';form.username='';form.displayName='';await load()}
onMounted(()=>run(load))
</script>
<template><section class="work-card"><h2>运营与财务岗位</h2><p>运营管理业务资料，财务处理账单和付款。岗位调整会让该账号重新登录。</p><p v-if="error" class="engine-error" role="alert">{{error}}</p><p v-if="notice" role="status">{{notice}}</p><form @submit.prevent="run(create)"><label>登录账号<input v-model="form.username" required minlength="2" maxlength="64" /></label><label>姓名<input v-model="form.displayName" required maxlength="64" /></label><label>岗位<select v-model="form.duty"><option value="operations">运营</option><option value="finance">财务</option></select></label><button class="primary" :disabled="busy">创建岗位账号</button></form><div class="engine-table"><table><thead><tr><th>姓名</th><th>账号</th><th>岗位</th></tr></thead><tbody><tr v-for="u in list" :key="u.id"><td>{{u.displayName}}</td><td>{{u.username}}</td><td><select :value="u.adminDuty" :disabled="busy" :aria-label="u.displayName+'的岗位'" @change="run(async()=>{await http.patch('/staff/'+u.id,{duty:($event.target as HTMLSelectElement).value});await load()})"><option value="all">完整管理员</option><option value="operations">运营</option><option value="finance">财务</option></select></td></tr></tbody></table></div></section></template>

