<script setup lang="ts">
import { DEFAULT_LOCALE, createTranslator } from '@zhihu-koc/shared-i18n'

const t = createTranslator(DEFAULT_LOCALE)
</script>

<template>
  <section>
    <h1 class="page-title">{{ t('nav.overview') }}</h1>
    <p class="page-placeholder">{{ t('common.empty') }}</p>
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
</style>
