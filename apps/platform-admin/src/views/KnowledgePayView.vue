<script setup lang="ts">
import { ref, computed } from 'vue'

interface Course {
  id: number
  title: string
  category: string
  price: number
  sales: number
  revenue: number
  status: 'online' | 'offline' | 'draft'
  createdAt: string
  instructor: string
}

const searchQuery = ref('')
const selectedStatus = ref('')
const selectedCategory = ref('')
const showDialog = ref(false)
const editingCourse = ref<Course | null>(null)

const formData = ref({
  title: '',
  category: '',
  price: 0,
  instructor: '',
})

const courses = ref<Course[]>([
  {
    id: 1,
    title: '知乎推广实战：从0到1打造爆款内容',
    category: '运营推广',
    price: 299,
    sales: 1245,
    revenue: 372255,
    status: 'online',
    createdAt: '2024-01-15',
    instructor: '张老师',
  },
  {
    id: 2,
    title: '数据分析入门：用数据驱动运营决策',
    category: '数据分析',
    price: 199,
    sales: 892,
    revenue: 177508,
    status: 'online',
    createdAt: '2024-01-20',
    instructor: '李老师',
  },
  {
    id: 3,
    title: 'MCN机构管理与达人孵化',
    category: '团队管理',
    price: 499,
    sales: 345,
    revenue: 172155,
    status: 'online',
    createdAt: '2024-02-01',
    instructor: '王老师',
  },
  {
    id: 4,
    title: '内容创作技巧：提升文章阅读量',
    category: '内容创作',
    price: 159,
    sales: 0,
    revenue: 0,
    status: 'draft',
    createdAt: '2024-02-18',
    instructor: '赵老师',
  },
])

const categories = ['运营推广', '数据分析', '团队管理', '内容创作', '商业变现']

const filteredCourses = computed(() => {
  return courses.value.filter((course) => {
    if (selectedStatus.value && course.status !== selectedStatus.value) return false
    if (selectedCategory.value && course.category !== selectedCategory.value) return false
    if (searchQuery.value) {
      const q = searchQuery.value.toLowerCase()
      return (
        course.title.toLowerCase().includes(q) ||
        course.instructor.toLowerCase().includes(q)
      )
    }
    return true
  })
})

const totalRevenue = computed(() => {
  return filteredCourses.value.reduce((sum, c) => sum + c.revenue, 0)
})

const totalSales = computed(() => {
  return filteredCourses.value.reduce((sum, c) => sum + c.sales, 0)
})

function openCreateDialog() {
  editingCourse.value = null
  formData.value = {
    title: '',
    category: '',
    price: 0,
    instructor: '',
  }
  showDialog.value = true
}

function openEditDialog(course: Course) {
  editingCourse.value = course
  formData.value = {
    title: course.title,
    category: course.category,
    price: course.price,
    instructor: course.instructor,
  }
  showDialog.value = true
}

function closeDialog() {
  showDialog.value = false
  editingCourse.value = null
}

function saveCourse() {
  if (editingCourse.value) {
    const existing = courses.value.find((c) => c.id === editingCourse.value!.id)
    if (existing) {
      Object.assign(existing, {
        title: formData.value.title,
        category: formData.value.category,
        price: formData.value.price,
        instructor: formData.value.instructor,
      })
    }
  } else {
    const newCourse: Course = {
      id: Date.now(),
      title: formData.value.title,
      category: formData.value.category,
      price: formData.value.price,
      instructor: formData.value.instructor,
      sales: 0,
      revenue: 0,
      status: 'draft',
      createdAt: new Date().toISOString().slice(0, 10),
    }
    courses.value.push(newCourse)
  }
  closeDialog()
}

function toggleStatus(course: Course) {
  if (course.status === 'online') {
    course.status = 'offline'
  } else if (course.status === 'offline' || course.status === 'draft') {
    course.status = 'online'
  }
}

function getStatusText(status: string) {
  const map: Record<string, string> = {
    online: '已上架',
    offline: '已下架',
    draft: '草稿',
  }
  return map[status] || status
}

function getStatusClass(status: string) {
  const map: Record<string, string> = {
    online: 'status-badge-success',
    offline: 'status-badge-warning',
    draft: 'status-badge',
  }
  return map[status] || 'status-badge'
}
</script>

<template>
  <div class="page-stack">
    <header class="page-header">
      <div>
        <p class="eyebrow">KNOWLEDGE / PAY</p>
        <h1>知识付费</h1>
      </div>
      <button class="primary-action" @click="openCreateDialog">+ 创建课程</button>
    </header>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 16px;">
      <article class="metric-card">
        <span class="metric-label">总销售额</span>
        <strong class="metric-value">¥{{ totalRevenue.toLocaleString() }}</strong>
      </article>
      <article class="metric-card">
        <span class="metric-label">总销量</span>
        <strong class="metric-value">{{ totalSales }}</strong>
      </article>
      <article class="metric-card">
        <span class="metric-label">在售课程</span>
        <strong class="metric-value">{{ courses.filter((c) => c.status === 'online').length }}</strong>
      </article>
    </div>

    <article class="panel" style="padding: 20px;">
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
        <div class="form-field">
          <label style="font-size: 11px; color: var(--ink-soft); margin-bottom: 6px;">课程状态</label>
          <select v-model="selectedStatus" style="width: 100%; padding: 8px; border: 1px solid var(--line); border-radius: var(--radius); font-size: 12px;">
            <option value="">全部状态</option>
            <option value="online">已上架</option>
            <option value="offline">已下架</option>
            <option value="draft">草稿</option>
          </select>
        </div>
        <div class="form-field">
          <label style="font-size: 11px; color: var(--ink-soft); margin-bottom: 6px;">课程分类</label>
          <select v-model="selectedCategory" style="width: 100%; padding: 8px; border: 1px solid var(--line); border-radius: var(--radius); font-size: 12px;">
            <option value="">全部分类</option>
            <option v-for="cat in categories" :key="cat" :value="cat">{{ cat }}</option>
          </select>
        </div>
        <div class="form-field">
          <label style="font-size: 11px; color: var(--ink-soft); margin-bottom: 6px;">搜索</label>
          <input
            v-model="searchQuery"
            placeholder="搜索课程标题、讲师..."
            style="width: 100%; padding: 8px 12px; border: 1px solid var(--line); border-radius: var(--radius); font-size: 12px;"
          />
        </div>
      </div>
    </article>

    <article class="panel">
      <div class="list-toolbar">
        <span class="toolbar-title">课程列表（{{ filteredCourses.length }}）</span>
      </div>
      <div class="responsive-table">
        <table>
          <thead>
            <tr>
              <th>课程名称</th>
              <th>分类</th>
              <th>讲师</th>
              <th style="text-align: right;">价格</th>
              <th style="text-align: right;">销量</th>
              <th style="text-align: right;">收入</th>
              <th>状态</th>
              <th>创建时间</th>
              <th style="text-align: right;">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="course in filteredCourses" :key="course.id">
              <td><strong>{{ course.title }}</strong></td>
              <td>{{ course.category }}</td>
              <td><strong>{{ course.instructor }}</strong></td>
              <td style="text-align: right; font-weight: 500;">¥{{ course.price }}</td>
              <td style="text-align: right;">{{ course.sales }}</td>
              <td style="text-align: right; font-weight: 500; color: var(--forest);">
                ¥{{ course.revenue.toLocaleString() }}
              </td>
              <td>
                <span :class="getStatusClass(course.status)">{{ getStatusText(course.status) }}</span>
              </td>
              <td>{{ course.createdAt }}</td>
              <td style="text-align: right;">
                <button class="quiet-action" @click="openEditDialog(course)">编辑</button>
                <button
                  class="quiet-action"
                  :style="course.status === 'online' ? 'color: var(--clay)' : 'color: var(--forest)'"
                  @click="toggleStatus(course)"
                >
                  {{ course.status === 'online' ? '下架' : '上架' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <!-- 创建/编辑对话框 -->
    <div v-if="showDialog" class="dialog-overlay" @click.self="closeDialog">
      <div class="dialog-card" style="width: 520px;">
        <header class="dialog-header">
          <h3>{{ editingCourse ? '编辑课程' : '创建课程' }}</h3>
          <button class="dialog-close" @click="closeDialog">×</button>
        </header>
        <div class="dialog-body">
          <div class="form-field">
            <label>课程名称</label>
            <input v-model="formData.title" placeholder="输入课程标题" />
          </div>
          <div class="form-field">
            <label>课程分类</label>
            <select v-model="formData.category">
              <option value="">请选择分类</option>
              <option v-for="cat in categories" :key="cat" :value="cat">{{ cat }}</option>
            </select>
          </div>
          <div class="form-field">
            <label>讲师</label>
            <input v-model="formData.instructor" placeholder="讲师姓名" />
          </div>
          <div class="form-field">
            <label>价格（元）</label>
            <input v-model.number="formData.price" type="number" placeholder="0" />
          </div>
        </div>
        <footer class="dialog-footer">
          <button class="secondary-action" @click="closeDialog">取消</button>
          <button class="primary-action" @click="saveCourse">
            {{ editingCourse ? '保存' : '创建' }}
          </button>
        </footer>
      </div>
    </div>
  </div>
</template>
