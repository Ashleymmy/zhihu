<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Project, ProjectCourse, ProjectDetail, ProjectMember, TeamMember } from '@zhihu-koc/shared-contracts'
import { DEFAULT_LOCALE, createTranslator } from '@zhihu-koc/shared-i18n'
import { isApiError } from '@zhihu-koc/shared-services'
import { formatDate } from '@zhihu-koc/shared-utils'
import { apis } from '../stores/auth'

const t = createTranslator(DEFAULT_LOCALE)

const projects = ref<Project[]>([])
const selected = ref<ProjectDetail | null>(null)
const members = ref<ProjectMember[]>([])
const courses = ref<ProjectCourse[]>([])
const teamMembers = ref<TeamMember[]>([])
const loading = ref(false)
const errorMessage = ref('')

// ── 新建项目表单 ───────────────────────────────────────────────
const showCreate = ref(false)
const createForm = ref({ name: '', slug: '', apiBaseUrl: '', signMethod: 'hmac_sha256' as 'hmac_sha256' | 'oauth2' })
const creating = ref(false)

// ── 编辑项目表单 ───────────────────────────────────────────────
const showEdit = ref(false)
const editForm = ref({ name: '', apiBaseUrl: '', signMethod: 'hmac_sha256' as 'hmac_sha256' | 'oauth2' })
const editing = ref(false)

const newMemberId = ref('')
const newCourseName = ref('')
const newCourseUrl = ref('')

const candidateUsers = computed(() =>
  teamMembers.value.filter((user) => user.isActive && !members.value.some((m) => m.userId === user.id)),
)

function captureError(error: unknown) {
  errorMessage.value = isApiError(error) ? error.message : String(error)
}

async function loadProjects() {
  loading.value = true
  errorMessage.value = ''
  try {
    projects.value = await apis.projects.list()
    if (projects.value.length && !selected.value) await select(projects.value[0]!)
  } catch (error) {
    captureError(error)
  } finally {
    loading.value = false
  }
}

async function select(project: Project) {
  errorMessage.value = ''
  try {
    const detail = await apis.projects.update(project.id, {}) as ProjectDetail
    selected.value = detail
    showEdit.value = false
    ;[members.value, courses.value] = await Promise.all([
      apis.projects.listMembers(project.id),
      apis.projects.listCourses(project.id),
    ])
  } catch (error) {
    // update with empty body returns current data; treat any error as a plain select
    selected.value = project as unknown as ProjectDetail
    captureError(error)
  }
}

// ── 新建项目 ──────────────────────────────────────────────────
function openCreate() {
  createForm.value = { name: '', slug: '', apiBaseUrl: '', signMethod: 'hmac_sha256' }
  showCreate.value = true
}

async function submitCreate() {
  if (!createForm.value.name.trim() || !createForm.value.slug.trim() || !createForm.value.apiBaseUrl.trim()) return
  creating.value = true
  errorMessage.value = ''
  try {
    const created = await apis.projects.create({
      name: createForm.value.name.trim(),
      slug: createForm.value.slug.trim(),
      apiBaseUrl: createForm.value.apiBaseUrl.trim(),
      signMethod: createForm.value.signMethod,
    })
    showCreate.value = false
    projects.value = await apis.projects.list()
    await selectDetail(created)
  } catch (error) {
    captureError(error)
  } finally {
    creating.value = false
  }
}

// ── 编辑项目 ──────────────────────────────────────────────────
function openEdit() {
  if (!selected.value) return
  editForm.value = {
    name: selected.value.name,
    apiBaseUrl: selected.value.apiBaseUrl ?? '',
    signMethod: selected.value.signMethod ?? 'hmac_sha256',
  }
  showEdit.value = true
}

async function submitEdit() {
  if (!selected.value) return
  editing.value = true
  errorMessage.value = ''
  try {
    const updated = await apis.projects.update(selected.value.id, {
      name: editForm.value.name.trim(),
      apiBaseUrl: editForm.value.apiBaseUrl.trim(),
      signMethod: editForm.value.signMethod,
    })
    selected.value = updated
    projects.value = await apis.projects.list()
    showEdit.value = false
  } catch (error) {
    captureError(error)
  } finally {
    editing.value = false
  }
}

// ── 禁用项目 ──────────────────────────────────────────────────
async function disableProject() {
  if (!selected.value || !confirm(t('projects.confirmDisable'))) return
  errorMessage.value = ''
  try {
    await apis.projects.disable(selected.value.id)
    projects.value = await apis.projects.list()
    selected.value = null
  } catch (error) {
    captureError(error)
  }
}

async function selectDetail(project: Project | ProjectDetail) {
  selected.value = project as ProjectDetail
  showEdit.value = false
  errorMessage.value = ''
  try {
    ;[members.value, courses.value] = await Promise.all([
      apis.projects.listMembers(project.id),
      apis.projects.listCourses(project.id),
    ])
  } catch (error) {
    captureError(error)
  }
}

// ── 成员 ──────────────────────────────────────────────────────
async function addMember() {
  if (!selected.value || !newMemberId.value) return
  try {
    await apis.projects.addMember(selected.value.id, { userId: newMemberId.value })
    newMemberId.value = ''
    members.value = await apis.projects.listMembers(selected.value.id)
  } catch (error) {
    captureError(error)
  }
}

async function removeMember(userId: string) {
  if (!selected.value) return
  try {
    await apis.projects.removeMember(selected.value.id, userId)
    members.value = await apis.projects.listMembers(selected.value.id)
  } catch (error) {
    captureError(error)
  }
}

// ── 课程 ──────────────────────────────────────────────────────
async function addCourse() {
  if (!selected.value || !newCourseName.value.trim()) return
  try {
    await apis.projects.addCourse(selected.value.id, {
      courseName: newCourseName.value.trim(),
      courseUrl: newCourseUrl.value.trim() || undefined,
    })
    newCourseName.value = ''
    newCourseUrl.value = ''
    courses.value = await apis.projects.listCourses(selected.value.id)
  } catch (error) {
    captureError(error)
  }
}

async function removeCourse(courseId: string) {
  if (!selected.value) return
  try {
    await apis.projects.removeCourse(selected.value.id, courseId)
    courses.value = await apis.projects.listCourses(selected.value.id)
  } catch (error) {
    captureError(error)
  }
}

onMounted(async () => {
  await loadProjects()
  try {
    teamMembers.value = await apis.team.listMembers()
  } catch (error) {
    captureError(error)
  }
})
</script>

<template>
  <section class="projects">
    <h1 class="page-title">{{ t('nav.projects') }}</h1>
    <p v-if="errorMessage" class="projects__error" role="alert">{{ errorMessage }}</p>

    <!-- 新建项目表单 -->
    <div v-if="showCreate" class="create-panel">
      <h2>{{ t('projects.create') }}</h2>
      <form class="create-panel__form" @submit.prevent="submitCreate">
        <label>
          {{ t('projects.projectName') }}
          <input v-model="createForm.name" required maxlength="64" />
        </label>
        <label>
          {{ t('projects.slug') }}
          <input v-model="createForm.slug" required maxlength="32" pattern="[a-z0-9-]+" />
        </label>
        <label>
          {{ t('projects.apiBaseUrl') }}
          <input v-model="createForm.apiBaseUrl" required type="url" maxlength="255" />
        </label>
        <label>
          {{ t('projects.signMethod') }}
          <select v-model="createForm.signMethod">
            <option value="hmac_sha256">{{ t('projects.signMethods.hmac_sha256') }}</option>
            <option value="oauth2">{{ t('projects.signMethods.oauth2') }}</option>
          </select>
        </label>
        <div class="create-panel__actions">
          <button type="submit" :disabled="creating">{{ t('common.save') }}</button>
          <button type="button" @click="showCreate = false">{{ t('common.cancel') }}</button>
        </div>
      </form>
    </div>
    <button v-else type="button" class="btn-primary" @click="openCreate">{{ t('projects.create') }}</button>

    <div class="projects__layout">
      <aside class="projects__list">
        <p v-if="!loading && !projects.length" class="page-placeholder">{{ t('projects.empty') }}</p>
        <button
          v-for="project in projects"
          :key="project.id"
          type="button"
          class="projects__item"
          :class="{ 'projects__item--active': selected?.id === project.id }"
          @click="selectDetail(project)"
        >
          <span>{{ project.name }}</span>
          <small>{{ project.slug }}</small>
          <small v-if="!project.isEnabled" class="projects__disabled">{{ t('projects.disabled') }}</small>
        </button>
      </aside>

      <div v-if="selected" class="projects__detail">
        <!-- 项目元信息 + 操作 -->
        <section class="panel">
          <header class="panel__header">
            <h2>{{ selected.name }} <small>{{ selected.slug }}</small></h2>
            <div class="panel__header-actions">
              <button v-if="!showEdit" type="button" @click="openEdit">{{ t('projects.edit') }}</button>
              <button
                v-if="selected.isEnabled"
                type="button"
                class="btn-danger"
                @click="disableProject"
              >{{ t('projects.disable') }}</button>
            </div>
          </header>

          <!-- 行内编辑表单 -->
          <form v-if="showEdit" class="edit-form" @submit.prevent="submitEdit">
            <label>
              {{ t('projects.projectName') }}
              <input v-model="editForm.name" required maxlength="64" />
            </label>
            <label>
              {{ t('projects.apiBaseUrl') }}
              <input v-model="editForm.apiBaseUrl" required type="url" maxlength="255" />
            </label>
            <label>
              {{ t('projects.signMethod') }}
              <select v-model="editForm.signMethod">
                <option value="hmac_sha256">{{ t('projects.signMethods.hmac_sha256') }}</option>
                <option value="oauth2">{{ t('projects.signMethods.oauth2') }}</option>
              </select>
            </label>
            <div class="edit-form__actions">
              <button type="submit" :disabled="editing">{{ t('common.save') }}</button>
              <button type="button" @click="showEdit = false">{{ t('common.cancel') }}</button>
            </div>
          </form>
        </section>

        <!-- 成员 -->
        <section class="panel">
          <header class="panel__header">
            <h2>{{ t('nav.members') }}</h2>
            <form class="panel__form" @submit.prevent="addMember">
              <select v-model="newMemberId" data-testid="member-select">
                <option value="" disabled>{{ t('projects.memberPlaceholder') }}</option>
                <option v-for="user in candidateUsers" :key="user.id" :value="user.id">
                  {{ user.displayName }}（{{ user.username }}）
                </option>
              </select>
              <button type="submit" :disabled="!newMemberId">{{ t('projects.addMember') }}</button>
            </form>
          </header>
          <p v-if="!members.length" class="page-placeholder">{{ t('projects.membersEmpty') }}</p>
          <table v-else class="panel__table">
            <thead>
              <tr>
                <th>{{ t('auth.username') }}</th>
                <th>{{ t('projects.memberRole') }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="member in members" :key="member.userId">
                <td>{{ member.displayName ?? member.username ?? member.userId }}</td>
                <td>{{ member.memberRole }}</td>
                <td class="panel__actions">
                  <button type="button" @click="removeMember(member.userId)">{{ t('projects.removeMember') }}</button>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- 课程 -->
        <section class="panel">
          <header class="panel__header">
            <h2>{{ t('nav.courses') }}</h2>
            <form class="panel__form" @submit.prevent="addCourse">
              <input v-model="newCourseName" :placeholder="t('projects.courseName')" data-testid="course-name" />
              <input v-model="newCourseUrl" :placeholder="t('projects.courseUrl')" data-testid="course-url" />
              <button type="submit" :disabled="!newCourseName.trim()">{{ t('projects.addCourse') }}</button>
            </form>
          </header>
          <p v-if="!courses.length" class="page-placeholder">{{ t('projects.coursesEmpty') }}</p>
          <table v-else class="panel__table">
            <thead>
              <tr>
                <th>{{ t('projects.courseName') }}</th>
                <th>URL</th>
                <th>{{ t('projects.createdAt') }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="course in courses" :key="course.id">
                <td>{{ course.courseName }}</td>
                <td>
                  <a v-if="course.courseUrl" :href="course.courseUrl" target="_blank" rel="noopener">{{
                    course.courseUrl
                  }}</a>
                  <span v-else>—</span>
                </td>
                <td>{{ formatDate(course.createdAt) }}</td>
                <td class="panel__actions">
                  <button type="button" @click="removeCourse(course.id)">{{ t('projects.removeCourse') }}</button>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
      <p v-else class="page-placeholder">{{ t('projects.selectHint') }}</p>
    </div>
  </section>
</template>

<style scoped>
.page-title {
  margin: 0 0 12px;
  font-size: 18px;
}
.page-placeholder {
  color: rgba(0, 0, 0, 0.45);
}
.projects__error {
  margin: 0 0 12px;
  color: #cf1322;
  font-size: 13px;
}
.btn-primary {
  margin-bottom: 12px;
  padding: 6px 16px;
  border: none;
  border-radius: 6px;
  background: #1677ff;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
.btn-danger {
  border: 1px solid #ffa39e;
  background: #fff;
  color: #cf1322;
}
.create-panel {
  margin-bottom: 16px;
  padding: 16px;
  border: 1px solid #d9d9d9;
  border-radius: 8px;
  background: #fafafa;
}
.create-panel h2 {
  margin: 0 0 12px;
  font-size: 15px;
}
.create-panel__form,
.edit-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 480px;
}
.create-panel__form label,
.edit-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}
.create-panel__form input,
.create-panel__form select,
.edit-form input,
.edit-form select {
  padding: 6px 10px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  font-size: 13px;
}
.create-panel__actions,
.edit-form__actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.create-panel__actions button,
.edit-form__actions button {
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}
.create-panel__actions button[type='submit'],
.edit-form__actions button[type='submit'] {
  border: none;
  background: #1677ff;
  color: #fff;
}
.create-panel__actions button[type='button'],
.edit-form__actions button[type='button'] {
  border: 1px solid #d9d9d9;
  background: #fff;
  color: rgba(0, 0, 0, 0.65);
}
.create-panel__actions button:disabled,
.edit-form__actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.projects__layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 16px;
  align-items: start;
}
.projects__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.projects__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  background: #fff;
  text-align: left;
  cursor: pointer;
}
.projects__item--active {
  border-color: #1677ff;
}
.projects__item small {
  color: rgba(0, 0, 0, 0.45);
}
.projects__disabled {
  color: #cf1322;
}
.projects__detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.panel {
  padding: 16px;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  background: #fff;
}
.panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.panel__header h2 {
  margin: 0;
  font-size: 15px;
}
.panel__header h2 small {
  font-weight: normal;
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
  margin-left: 6px;
}
.panel__header-actions {
  display: flex;
  gap: 8px;
}
.panel__header-actions button {
  padding: 4px 12px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
  cursor: pointer;
}
.panel__form {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.panel__form input,
.panel__form select {
  padding: 6px 10px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  font-size: 13px;
}
.panel__form button {
  padding: 6px 14px;
  border: none;
  border-radius: 6px;
  background: #1677ff;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}
.panel__form button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.panel__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.panel__table th,
.panel__table td {
  padding: 8px;
  border-bottom: 1px solid #f5f5f5;
  text-align: left;
}
.panel__actions button {
  padding: 4px 10px;
  border: 1px solid #ffa39e;
  border-radius: 6px;
  background: #fff;
  color: #cf1322;
  font-size: 12px;
  cursor: pointer;
}
</style>
