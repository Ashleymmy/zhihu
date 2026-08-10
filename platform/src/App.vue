<template>
  <a-config-provider :theme="theme">
    <router-view />
  </a-config-provider>
</template>

<script setup lang="ts">
import { theme as antdTheme } from 'ant-design-vue'

const theme = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    colorPrimary: '#6366f1',
    borderRadius: 8,
    colorLink: '#6366f1',
    colorBgBase: '#07080c',
    colorTextBase: '#f1f5f9',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif",
  },
}
</script>
