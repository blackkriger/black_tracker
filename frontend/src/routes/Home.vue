<script setup lang="ts">
// The root is a junction, not a page: it sends you to the board you had open and only draws something when there is nothing to send you to.
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import TopBar from '../components/TopBar.vue';
import { api } from '../lib/api';
import { lastProject } from '../lib/lastProject';

interface Project {
  shortName: string;
  name: string;
  archived: boolean;
}

const router = useRouter();
const loading = ref(true);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    const projects = await api<Project[]>('/projects');
    const open = projects.filter((p) => !p.archived);
    const remembered = open.find((p) => p.shortName === lastProject.get());
    const target = remembered ?? open[0];
    if (target) await router.replace(`/p/${target.shortName}`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not load projects.';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page">
    <TopBar />
    <div class="page__body">
      <p v-if="loading" class="hint">Loading…</p>
      <div v-else-if="error" class="empty"><span class="empty__g">✕</span>{{ error }}</div>
      <div v-else class="empty"><span class="empty__g">◇</span>No projects yet.</div>
    </div>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
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
