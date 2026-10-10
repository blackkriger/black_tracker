<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
  <div class="page">
    <div class="page__body">
      <div class="empty">
        <span class="empty__g">404</span>
        {{ t('common.noSuchPage') }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  min-height: calc(100vh - var(--top-h));
  display: flex;
  flex-direction: column;
}
.page__body {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
}
</style>
