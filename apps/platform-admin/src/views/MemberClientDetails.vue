<script setup lang="ts">
import type { TeamMember } from '@zhihu-koc/shared-contracts/core'
import { bindingLabel, clientLabel, sessionLabel } from '../mini-status'
defineProps<{member:TeamMember}>()
const format=(date:string|null)=>date?new Date(date).toLocaleString('zh-CN'):'—'
</script>
<template>
  <section class="client-detail">
    <h3>小程序与双端账号</h3>
    <p>统一账号 ID {{ member.id }}。网站与小程序共用此账号及业务数据。</p>
    <template v-if="member.miniProgram">
      <dl>
        <dt>微信绑定</dt><dd>{{ bindingLabel(member.miniProgram) }}<small v-if="member.miniProgram.maskedIdentity">微信标识 {{ member.miniProgram.maskedIdentity }}</small></dd>
        <dt>绑定时间</dt><dd>{{ format(member.miniProgram.boundAt) }}</dd>
        <dt>最近小程序登录</dt><dd>{{ format(member.miniProgram.lastLoginAt) }}</dd>
        <dt>最近小程序访问</dt><dd>{{ format(member.miniProgram.lastActivityAt) }}<small>最近 7 天内已记录的请求；无记录不表示账号异常。</small></dd>
        <dt>身份核验</dt><dd>未接入实名认证及手机号真实性核验；微信绑定与这两项核验分别管理。</dd>
      </dl>
      <p v-if="member.miniProgram.recentBindingConflict" class="client-warning">最近出现绑定冲突：{{ format(member.miniProgram.lastConflictAt) }}。请核对本人使用的微信和网站账号。</p>
      <table>
        <thead><tr><th>登录端</th><th>会话状态</th><th>最近登录</th><th>会话期限</th></tr></thead>
        <tbody><tr v-for="s in member.miniProgram.sessions" :key="s.type">
          <td>{{ clientLabel[s.type] }}</td><td>{{ member.isActive?sessionLabel[s.state]:'账号已停用' }}<small v-if="member.isActive&&s.activeCount>1">{{ s.activeCount }} 个有效会话</small></td>
          <td>{{ format(s.lastLoginAt) }}</td><td>{{ format(s.expiresAt) }}</td>
        </tr></tbody>
      </table>
      <p class="client-note">会话有效不代表此刻在线。小程序登录独立于网站；修改密码、账号权限或停用账号后需重新登录。</p>
    </template>
    <p v-else>暂无绑定与会话信息，请刷新后重试。</p>
  </section>
</template>
<style scoped>
.client-detail{border-top:1px solid var(--line,#dfe4e0);margin-top:24px;padding-top:10px}.client-detail p{line-height:1.65}.client-detail dl{display:grid;grid-template-columns:140px 1fr;gap:10px}.client-detail dd{margin:0;overflow-wrap:anywhere}.client-detail dt,.client-note,.client-detail small{color:var(--ink-soft,#64716b)}.client-detail small{display:block;font-size:12px;margin-top:4px}.client-detail table{width:100%;border-collapse:collapse;font-size:13px}.client-detail td,.client-detail th{padding:10px 6px;border-bottom:1px solid var(--line,#dfe4e0);text-align:left}.client-warning{color:#964639}.client-note{font-size:12px}@media(max-width:600px){.client-detail dl{grid-template-columns:1fr;gap:4px}.client-detail dd{margin-bottom:10px}.client-detail table{font-size:11px}}
</style>
