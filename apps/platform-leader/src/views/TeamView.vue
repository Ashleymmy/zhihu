<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { CreateMemberResp, TeamMember } from '@zhihu-koc/shared-contracts'
import { DEFAULT_LOCALE, createTranslator } from '@zhihu-koc/shared-i18n'
import { isApiError } from '@zhihu-koc/shared-services'
import { formatDateTime } from '@zhihu-koc/shared-utils'
import { APP_ROLE } from '../app-config'
import { apis } from '../stores/auth'

const t = createTranslator(DEFAULT_LOCALE)

const members = ref<TeamMember[]>([])
const errorMessage = ref('')
const created = ref<CreateMemberResp | null>(null)
const resetResult = ref<{ id: string; temporaryPassword: string } | null>(null)

const username = ref('')
const displayName = ref('')
const role = ref<'leader' | 'creator'>('creator')
const submitting = ref(false)

// admin 可选建团长/达人；leader 端只能建达人（服务端同样强制）
const roleOptions = APP_ROLE === 'admin' ? (['leader', 'creator'] as const) : (['creator'] as const)

function captureError(error: unknown) {
  errorMessage.value = isApiError(error) ? error.message : String(error)
}

async function load() {
  try {
    members.value = await apis.team.listMembers()
  } catch (error) {
    captureError(error)
  }
}

async function create() {
  if (!username.value.trim() || !displayName.value.trim() || submitting.value) return
  submitting.value = true
  errorMessage.value = ''
  created.value = null
  try {
    created.value = await apis.team.createMember({
      username: username.value.trim(),
      displayName: displayName.value.trim(),
      role: role.value,
    })
    username.value = ''
    displayName.value = ''
    await load()
  } catch (error) {
    captureError(error)
  } finally {
    submitting.value = false
  }
}

async function resetPassword(id: string) {
  errorMessage.value = ''
  resetResult.value = null
  try {
    const result = await apis.team.resetPassword(id)
    resetResult.value = { id, temporaryPassword: result.temporaryPassword }
  } catch (error) {
    captureError(error)
  }
}

async function disable(id: string) {
  errorMessage.value = ''
  try {
    await apis.team.disableMember(id)
    await load()
  } catch (error) {
    captureError(error)
  }
}

onMounted(load)
</script>

<template>
  <section>
    <h1 class="page-title">{{ t('nav.team') }}</h1>
    <p v-if="errorMessage" class="page-error" role="alert">{{ errorMessage }}</p>

    <form class="team-form" @submit.prevent="create">
      <input v-model="username" :placeholder="t('auth.username')" data-testid="team-username" />
      <input v-model="displayName" :placeholder="t('team.displayName')" data-testid="team-display-name" />
      <select v-model="role" data-testid="team-role">
        <option v-for="option in roleOptions" :key="option" :value="option">
          {{ t(`workspace.${option}`) }}
        </option>
      </select>
      <button type="submit" :disabled="submitting || !username.trim() || !displayName.trim()">
        {{ t('team.create') }}
      </button>
    </form>

    <p v-if="created" class="team-secret" data-testid="temporary-password">
      {{ t('team.temporaryPassword') }}：<code>{{ created.temporaryPassword }}</code>（{{ created.username }}）
    </p>
    <p v-if="resetResult" class="team-secret">
      {{ t('team.temporaryPassword') }}：<code>{{ resetResult.temporaryPassword }}</code>
    </p>

    <p v-if="!members.length" class="page-placeholder">{{ t('team.empty') }}</p>
    <table v-else class="team-table">
      <thead>
        <tr>
          <th>{{ t('auth.username') }}</th>
          <th>{{ t('team.displayName') }}</th>
          <th>{{ t('team.role') }}</th>
          <th>{{ t('team.lastLogin') }}</th>
          <th>{{ t('plans.status') }}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="member in members" :key="member.id">
          <td>{{ member.username }}</td>
          <td>{{ member.displayName }}</td>
          <td>{{ t(`workspace.${member.role}`) }}</td>
          <td>{{ formatDateTime(member.lastLoginAt) }}</td>
          <td>{{ member.isActive ? t('team.statusActive') : t('team.statusDisabled') }}</td>
          <td class="team-actions">
            <button type="button" @click="resetPassword(member.id)">{{ t('team.resetPwd') }}</button>
            <button v-if="member.isActive" type="button" class="team-actions__danger" @click="disable(member.id)">
              {{ t('team.disable') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.page-title {
  margin: 0 0 12px;
  font-size: 18px;
}
.page-error {
  margin: 0 0 12px;
  color: #cf1322;
  font-size: 13px;
}
.page-placeholder {
  color: rgba(0, 0, 0, 0.45);
}
.team-form {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.team-form input,
.team-form select {
  padding: 6px 10px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  font-size: 13px;
}
.team-form button {
  padding: 6px 14px;
  border: none;
  border-radius: 6px;
  background: #1677ff;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
.team-form button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.team-secret {
  margin: 0 0 12px;
  padding: 8px 12px;
  border: 1px solid #ffd591;
  border-radius: 6px;
  background: #fffbe6;
  font-size: 13px;
}
.team-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  background: #fff;
  border: 1px solid #f0f0f0;
}
.team-table th,
.team-table td {
  padding: 8px 12px;
  border-bottom: 1px solid #f5f5f5;
  text-align: left;
}
.team-actions {
  display: flex;
  gap: 8px;
}
.team-actions button {
  padding: 4px 10px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  cursor: pointer;
}
.team-actions__danger {
  border-color: #ffa39e !important;
  color: #cf1322;
}
</style>
