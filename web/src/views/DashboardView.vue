<template>
  <div class="dashboard-view">
    <h2>知乎联盟运营平台</h2>

    <el-alert
      title="⚠️ 安全红线"
      type="error"
      :closable="false"
      show-icon
      style="margin-bottom: 20px"
    >
      生产环境必须通过 BFF 后端签名，secret_key 禁止出现在前端代码或 .env 文件中。
      测试接口时注意日配额，严禁在循环中调用真实 API。
    </el-alert>

    <el-row :gutter="16" style="margin-bottom: 20px">
      <el-col :span="6" v-for="card in quickCards" :key="card.route">
        <el-card shadow="hover" class="quick-card" @click="router.push(card.route)">
          <div class="card-body">
            <el-icon :size="32" :color="card.color"><component :is="card.icon" /></el-icon>
            <div class="card-title">{{ card.title }}</div>
            <div class="card-desc">{{ card.desc }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-card header="使用流程" shadow="never">
      <el-steps :active="4" finish-status="success" style="padding: 8px 0">
        <el-step title="选渠道" description="代理渠道 → 获取 channel_id" />
        <el-step title="看任务" description="推广任务 → 获取 task_id" />
        <el-step title="建计划" description="创建推广计划 → 获取 plan_id" />
        <el-step title="建作品" description="创建推广作品 → 获取 composition_id" />
        <el-step title="看数据" description="数据报表 → 实时数据（每日更新）" />
      </el-steps>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { Connection, List, EditPen, Film, TrendCharts } from '@element-plus/icons-vue'

const router = useRouter()

const quickCards = [
  { route: '/channels',     icon: Connection,   color: '#409eff', title: '代理渠道',   desc: '查看渠道列表' },
  { route: '/tasks',        icon: List,         color: '#67c23a', title: '推广任务',   desc: '获取 task_id' },
  { route: '/plans',        icon: EditPen,       color: '#e6a23c', title: '创建计划',   desc: '单个/批量创建推广计划' },
  { route: '/compositions', icon: Film,          color: '#f56c6c', title: '推广作品',   desc: '创建/查询/修改作品' },
]
</script>

<style scoped>
.dashboard-view { padding: 20px; }
.dashboard-view h2 { margin-top: 0; margin-bottom: 16px; }
.quick-card { cursor: pointer; transition: transform .15s; }
.quick-card:hover { transform: translateY(-2px); }
.card-body { text-align: center; padding: 12px 0; }
.card-title { font-size: 16px; font-weight: 600; margin: 10px 0 4px; }
.card-desc { font-size: 13px; color: #909399; }
</style>
