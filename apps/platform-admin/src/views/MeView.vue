<script setup lang="ts">
import { useAuthStore } from '../stores/auth'
import { ROLE_LABELS } from '@zhihu-koc/shared-contracts/core'
const auth = useAuthStore()
</script>
<template><section class="page-stack"><header class="page-header"><div><h1>我的</h1><p>{{ auth.user?.displayName }} · {{ auth.user ? ROLE_LABELS[auth.user.role] : '' }}</p></div></header><div class="my-links panel"><router-link v-if="auth.user?.role === 'creator'" to="/profile">个人资料 <span>→</span></router-link><router-link v-if="auth.user?.role === 'creator'" to="/join-team">我的团队 <span>→</span></router-link><router-link v-else-if="auth.user?.role === 'leader'" to="/team">我的团队 <span>→</span></router-link><router-link v-if="auth.user?.permissions?.includes('team.create_member')" to="/invitations">邀请成员 <span>→</span></router-link><router-link to="/account/security">账号安全 <span>→</span></router-link></div></section></template>
<style scoped>.my-links{padding:8px 20px;max-width:700px}.my-links a{display:flex;justify-content:space-between;padding:20px 0;border-bottom:1px solid var(--line);text-decoration:none;color:inherit}.my-links a:last-child{border:0}</style>
