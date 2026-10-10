<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { lastProject } from '../lib/lastProject';
import { useProjects } from '../lib/projects';

const { t } = useI18n();
const router = useRouter();
const { projects, failed, load } = useProjects();
const loading = ref(true);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    await load();
    if (failed.value) throw new Error(t('common.projectsFailed'));
    const open = projects.value.filter((p) => !p.archived);
    const remembered = open.find((p) => p.shortName === lastProject.get());
    const target = remembered ?? open[0];
    if (target) await router.replace(`/${target.shortName}`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('common.projectsFailed');
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page">
    <div class="page__body">
      <p v-if="loading" class="hint">{{ t('common.loading') }}</p>
      <div v-else-if="error" class="empty"><span class="empty__g">✕</span>{{ error }}</div>
      <div v-else class="empty"><span class="empty__g">◇</span>{{ t('common.noProjects') }}</div>
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
