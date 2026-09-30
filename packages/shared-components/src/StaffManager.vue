<script setup lang="ts">
import {computed,onMounted,reactive,ref} from 'vue'
import { ROLE_LABELS, type GlobalRole } from '@zhihu-koc/shared-contracts/core'
interface Http{get<T>(p:string):Promise<T>;post<T>(p:string,b:object):Promise<T>;patch<T>(p:string,b:object):Promise<T>}
const props=defineProps<{http:Http;actorRole?:string}>()
interface Staff{id:string;username:string;displayName:string;role:GlobalRole;adminDuty:string;isActive:boolean;canManage:boolean}
const list=ref<Staff[]>([]),busy=ref(false),error=ref(''),notice=ref('')
const form=reactive({username:'',displayName:'',role:'operator',duty:'all'})
const roles=computed<GlobalRole[]>(()=>props.actorRole==='developer'?['operator','admin','developer']:['operator'])
async function load(){list.value=await props.http.get<Staff[]>('/staff')}
async function run(fn:()=>Promise<unknown>){busy.value=true;error.value='';try{await fn()}catch(e:any){error.value=e?.message||'操作失败'}finally{busy.value=false}}
async function create(){const result=await props.http.post<{username:string;temporaryPassword:string}>('/staff',form);notice.value='账号：'+result.username+'；临时密码：'+result.temporaryPassword+'。请妥善保存，首次登录后修改密码。';form.username='';form.displayName='';await load()}
async function update(u:Staff,patch:object){await props.http.patch('/staff/'+u.id,patch);await load()}
onMounted(()=>run(load))
</script>
<template>
<section class="staff-panel">
  <h2>管理角色与账号</h2>
  <p>开发者拥有最高权限，管理员管理账号与配置，运营管理员处理业务运营。除开发者外，每个账号限 1 个 Web 客户端和 1 个移动客户端。</p>
  <p v-if="error" class="error" role="alert">{{error}}</p>
  <p v-if="notice" class="notice" role="status">{{notice}} <button type="button" @click="notice=''">收起密码</button></p>
  <form @submit.prevent="run(create)">
    <label>登录账号<input v-model="form.username" required minlength="2" maxlength="64" pattern="[a-zA-Z0-9_-]+" autocomplete="off" /></label>
    <label>显示名称<input v-model="form.displayName" required maxlength="64" /></label>
    <label>角色<select v-model="form.role"><option v-for="r in roles" :key="r" :value="r">{{ROLE_LABELS[r]}}</option></select></label>
    <label v-if="form.role==='admin'">职责<select v-model="form.duty"><option value="all">完整管理员</option><option value="finance">财务管理员</option></select></label>
    <button class="primary" :disabled="busy">创建账号</button>
  </form>
  <div class="staff-table"><table><thead><tr><th>名称 / 账号</th><th>角色</th><th>职责</th><th>状态</th><th>操作</th></tr></thead><tbody>
    <tr v-for="u in list" :key="u.id"><td>{{u.displayName}}<small>{{u.username}}</small></td>
      <td><select v-if="u.canManage" :value="u.role" :disabled="busy" :aria-label="u.displayName+'的角色'" @change="run(()=>update(u,{role:($event.target as HTMLSelectElement).value}))"><option v-for="r in roles" :key="r" :value="r">{{ROLE_LABELS[r]}}</option></select><span v-else>{{ROLE_LABELS[u.role]}}</span></td>
      <td><select v-if="u.role==='admin'&&u.canManage" :value="u.adminDuty" :disabled="busy" :aria-label="u.displayName+'的职责'" @change="run(()=>update(u,{duty:($event.target as HTMLSelectElement).value}))"><option value="all">完整管理</option><option value="operations">运营（原岗位）</option><option value="finance">财务</option></select><span v-else>{{u.role==='operator'?'业务运营':u.role==='developer'?'全部权限':u.adminDuty==='finance'?'财务':'管理'}}</span></td>
      <td>{{u.isActive?'启用':'停用'}}</td><td><button v-if="u.canManage" :disabled="busy" @click="run(()=>update(u,{isActive:!u.isActive}))">{{u.isActive?'停用':'启用'}}</button><span v-else>—</span></td>
    </tr>
  </tbody></table></div>
  <p>调整角色或停用账号后，该账号原有登录会话立即失效。</p>
</section>
</template>
<style scoped>
.staff-panel{padding:24px;background:var(--paper,#fff);border:1px solid var(--line,#ddd);border-radius:12px}.staff-panel p{color:var(--ink-soft,#52616b);line-height:1.6}.staff-panel form{display:flex;gap:16px;align-items:end;flex-wrap:wrap}.staff-panel label{display:grid;gap:8px;flex:1;min-width:160px}.staff-panel input,.staff-panel select,.staff-panel button{min-height:42px;padding:8px 12px;border:1px solid var(--line,#ccc);border-radius:8px;background:var(--paper,#fff);color:inherit}.staff-panel button{cursor:pointer}.staff-panel button:disabled{opacity:.5;cursor:wait}.staff-panel .primary{background:#195e62;color:white}.staff-table{overflow:auto;margin-top:24px}.staff-panel table{width:100%;border-collapse:collapse;text-align:left}.staff-panel th,.staff-panel td{padding:12px;border-bottom:1px solid var(--line,#ddd);white-space:nowrap}.staff-panel small{display:block;color:var(--ink-soft,#52616b)}.staff-panel .error{color:#a02f39}.staff-panel .notice{padding:16px;background:#f2f7f5;overflow-wrap:anywhere}
</style>
