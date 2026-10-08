<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { ProjectCourse } from '@zhihu-koc/shared-contracts/core'
import { apis } from '../stores/auth'
const groups = ref<{ id: string; name: string; courses: ProjectCourse[] }[]>([]), error = ref(''), loading = ref(false)
async function load() { loading.value = true; error.value = ''; try { groups.value = await Promise.all((await apis.projects.list()).filter(p => p.isEnabled).map(async p => ({ id: p.id, name: p.name, courses: (await apis.projects.listCourses(p.id)).filter(c => c.isActive) }))) } catch { error.value = '课程暂时没加载出来，请重试。' } finally { loading.value = false } }
const safeUrl = (url: string | null) => { try { const value = new URL(url ?? ''); return ['https:', 'http:'].includes(value.protocol) ? value.href : '' } catch { return '' } }
onMounted(load)
</script>
<template><section class="page-stack"><header class="page-header"><h1>学院</h1><button @click="load" :disabled="loading">刷新课程</button></header><div v-if="error" role="alert"><p>{{ error }}</p><button @click="load">重试</button></div><article v-for="group in groups" :key="group.id" class="panel courses"><h2>{{ group.name }}</h2><template v-if="group.courses.length"><div v-for="course in group.courses" :key="course.id"><a v-if="safeUrl(course.courseUrl)" :href="safeUrl(course.courseUrl)" target="_blank" rel="noopener noreferrer">{{ course.courseName }} →</a><span v-else>{{ course.courseName }}</span></div></template><p v-else>课程还在准备中，可先到任务大厅查看任务要求。</p></article><p v-if="!loading && !error && !groups.length">还没有可查看的项目课程。</p><router-link to="/task-hall">查看任务要求 →</router-link></section></template>
<style scoped>.courses{padding:22px}.courses h2{font-size:18px}.courses>div{padding:15px 0;border-top:1px solid var(--line);overflow-wrap:anywhere}.courses p{color:var(--ink-soft)}</style>
