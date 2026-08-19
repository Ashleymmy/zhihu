<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Project, ProjectCourse, ProjectMember, TeamMember } from '@zhihu-koc/shared-contracts'
import { DEFAULT_LOCALE, createTranslator } from '@zhihu-koc/shared-i18n'
import { isApiError } from '@zhihu-koc/shared-services'
import { formatDate } from '@zhihu-koc/shared-utils'
import { apis } from '../stores/auth'

const t = createTranslator(DEFAULT_LOCALE)

const projects = ref<Project[]>([])
const selected = ref<Project | null>(null)
const members = ref<ProjectMember[]>([])
const courses = ref<ProjectCourse[]>([])
const teamMembers = ref<TeamMember[]>([])
const loading = ref(false)
const errorMessage = ref('')

const newMemberId = ref('')
const newCourseName = ref('')
const newCourseUrl = ref('')

/** 已是成员的用户不再出现在待添加下拉里。 */
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
  selected.value = project
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
    <div class="projects__layout">
      <aside class="projects__list">
        <p v-if="!loading && !projects.length" class="page-placeholder">{{ t('projects.empty') }}</p>
        <button
          v-for="project in projects"
          :key="project.id"
          type="button"
          class="projects__item"
          :class="{ 'projects__item--active': selected?.id === project.id }"
          @click="select(project)"
        >
          <span>{{ project.name }}</span>
          <small>{{ project.slug }}</small>
          <small v-if="!project.isEnabled" class="projects__disabled">{{ t('projects.disabled') }}</small>
        </button>
      </aside>

      <div v-if="selected" class="projects__detail">
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
