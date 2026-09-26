<script setup lang="ts">
// The root is a junction, not a page: it sends you to the board you had open and only draws something when there is nothing to send you to.
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import TopBar from '../components/TopBar.vue';
import { lastProject } from '../lib/lastProject';
import { useProjects } from '../lib/projects';

const router = useRouter();
const { projects, load } = useProjects();
const loading = ref(true);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    await load();
    const open = projects.value.filter((p) => !p.archived);
    const remembered = open.find((p) => p.shortName === lastProject.get());
    const target = remembered ?? open[0];
    if (target) await router.replace(`/${target.shortName}`);
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
