<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import userText from '../../../../weixin-app/docs/用户协议.md?raw'
import privacyText from '../../../../weixin-app/docs/隐私协议.md?raw'
const route = useRoute()
const text = computed(() => route.params.type === 'privacy' ? privacyText : userText)
</script>
<template><main class="agreement-page"><router-link to="/register">返回注册</router-link><article>{{text}}</article></main></template>
<style scoped>.agreement-page{max-width:840px;padding:24px;margin:auto}.agreement-page article{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8;margin-top:24px}</style>
