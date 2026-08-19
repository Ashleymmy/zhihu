<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Project, ProjectCourse, ProjectMember } from '@zhihu-koc/shared-contracts'
import { DEFAULT_LOCALE, createTranslator } from '@zhihu-koc/shared-i18n'
import { isApiError } from '@zhihu-koc/shared-services'
import { formatDate } from '@zhihu-koc/shared-utils'
import { apis } from '../stores/auth'

const t = createTranslator(DEFAULT_LOCALE)

const projects = ref<Project[]>([])
const selected = ref<Project | null>(null)
const members = ref<ProjectMember[]>([])
const courses = ref<ProjectCourse[]>([])
const loading = ref(false)
const errorMessage = ref('')

async function select(project: Project) {
  selected.value = project
  errorMessage.value = ''
  try {
    ;[members.value, courses.value] = await Promise.all([
      apis.projects.listMembers(project.id),
      apis.projects.listCourses(project.id),
    ])
  } catch (error) {
    errorMessage.value = isApiError(error) ? error.message : String(error)
  }
}

onMounted(async () => {
  loading.value = true
  try {
    projects.value = await apis.projects.list()
    if (projects.value.length) await select(projects.value[0]!)
  } catch (error) {
    errorMessage.value = isApiError(error) ? error.message : String(error)
  } finally {
    loading.value = false
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
          <small v-if="project.memberRole">{{ t('projects.memberRole') }}：{{ project.memberRole }}</small>
        </button>
      </aside>

      <div v-if="selected" class="projects__detail">
        <section class="panel">
          <h2>{{ t('nav.members') }}</h2>
          <p v-if="!members.length" class="page-placeholder">{{ t('projects.membersEmpty') }}</p>
          <ul v-else class="panel__list">
            <li v-for="member in members" :key="member.userId">
              {{ member.displayName ?? member.username ?? member.userId }}
              <small>{{ member.memberRole }}</small>
            </li>
          </ul>
        </section>

        <section class="panel">
          <h2>{{ t('nav.courses') }}</h2>
          <p v-if="!courses.length" class="page-placeholder">{{ t('projects.coursesEmpty') }}</p>
          <table v-else class="panel__table">
            <thead>
              <tr>
                <th>{{ t('projects.courseName') }}</th>
                <th>URL</th>
                <th>{{ t('projects.createdAt') }}</th>
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
              </tr>
            </tbody>
          </table>
        </section>
      </div>
      <p v-else-if="projects.length" class="page-placeholder">{{ t('projects.selectHint') }}</p>
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
.panel h2 {
  margin: 0 0 12px;
  font-size: 15px;
}
.panel__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}
.panel__list small {
  margin-left: 8px;
  color: rgba(0, 0, 0, 0.45);
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
</style>
