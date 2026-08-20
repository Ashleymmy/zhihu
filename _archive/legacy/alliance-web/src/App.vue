<template>
  <el-container style="height: 100vh">
    <!-- 侧边栏 -->
    <el-aside width="200px" style="background: #304156; overflow: hidden">
      <div class="logo">知乎联盟</div>
      <el-menu
        :default-active="$route.path"
        router
        background-color="#304156"
        text-color="#bfcbd9"
        active-text-color="#409eff"
      >
        <el-menu-item index="/dashboard">
          <el-icon><Odometer /></el-icon>
          <span>概览</span>
        </el-menu-item>
        <el-menu-item index="/channels">
          <el-icon><Connection /></el-icon>
          <span>代理渠道</span>
        </el-menu-item>
        <el-menu-item index="/tasks">
          <el-icon><List /></el-icon>
          <span>推广任务</span>
        </el-menu-item>
        <el-menu-item index="/plans">
          <el-icon><EditPen /></el-icon>
          <span>推广计划</span>
        </el-menu-item>
        <el-menu-item index="/compositions">
          <el-icon><Film /></el-icon>
          <span>推广作品</span>
        </el-menu-item>
        <el-menu-item index="/report">
          <el-icon><TrendCharts /></el-icon>
          <span>数据报表</span>
        </el-menu-item>
        <el-divider style="border-color:#445269; margin:4px 0" />
        <el-menu-item index="/ranking">
          <el-icon><Reading /></el-icon>
          <span>盐选榜单</span>
        </el-menu-item>
        <el-menu-item index="/intercept">
          <el-icon><Warning /></el-icon>
          <span>评论截流</span>
        </el-menu-item>
        <el-menu-item index="/risk">
          <el-icon><Bell /></el-icon>
          <span>风险举报</span>
        </el-menu-item>
        <el-divider style="border-color:#445269; margin:4px 0" />
        <el-menu-item index="/audiobook">
          <el-icon><Headset /></el-icon>
          <span>有声书</span>
        </el-menu-item>
        <el-menu-item index="/comic">
          <el-icon><VideoPlay /></el-icon>
          <span>漫剧</span>
        </el-menu-item>
        <el-menu-item index="/content-tag">
          <el-icon><PriceTag /></el-icon>
          <span>内容标签</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <!-- 主区域 -->
    <el-container>
      <el-header style="border-bottom: 1px solid #e4e7ed; display: flex; align-items: center">
        <span style="font-size: 15px; color: #606266">{{ pageTitle }}</span>
      </el-header>
      <el-main style="overflow: auto">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import {
  Odometer, Connection, List, EditPen, Film, TrendCharts,
  Reading, Warning, Bell, Headset, VideoPlay, PriceTag,
} from '@element-plus/icons-vue'

const route = useRoute()
const titleMap: Record<string, string> = {
  '/dashboard':    '概览',
  '/channels':     '代理渠道',
  '/tasks':        '推广任务',
  '/plans':        '创建推广计划',
  '/compositions': '推广作品管理',
  '/report':       '数据报表',
  '/ranking':      '盐选内容榜单',
  '/intercept':    '评论截流举报',
  '/risk':         '风险举报管理',
  '/audiobook':    '有声书内容库',
  '/comic':        '漫剧内容库',
  '/content-tag':  '内容标签查询',
}
const pageTitle = computed(() => titleMap[route.path] ?? '')
</script>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif; }
.logo {
  color: #fff;
  font-size: 18px;
  font-weight: 600;
  padding: 20px 24px;
  letter-spacing: 1px;
}
</style>
