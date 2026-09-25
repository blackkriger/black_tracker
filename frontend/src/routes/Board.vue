<script setup lang="ts">
// The board itself is still a shell: columns come from the project's states, the cards land in the next pass.
import { onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import TopBar from '../components/TopBar.vue';
import { api } from '../lib/api';
import { lastProject } from '../lib/lastProject';

interface State {
  id: string;
  name: string;
  position: number;
  isOpen: boolean;
  isResolved: boolean;
  color: string;
}
interface Project {
  id: string;
  shortName: string;
  name: string;
  archived: boolean;
  states: State[];
}

const route = useRoute();
const project = ref<Project | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

async function load(short: string): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    project.value = await api<Project>(`/projects/${encodeURIComponent(short)}`);
    lastProject.set(project.value.shortName);
  } catch (err) {
    project.value = null;
    error.value = err instanceof Error ? err.message : 'Could not load the project.';
  } finally {
    loading.value = false;
  }
}

onMounted(() => load(String(route.params.short)));
watch(
  () => route.params.short,
  (short) => {
    if (short) void load(String(short));
  }
);
</script>

<template>
  <div class="page">
    <TopBar :project="project" />

    <div class="page__body">
      <p v-if="loading" class="hint">Loading…</p>
      <div v-else-if="error" class="empty"><span class="empty__g">✕</span>{{ error }}</div>
      <div v-else-if="project" class="cols">
        <section
          v-for="s in project.states"
          :key="s.id"
          class="col"
          :style="{ '--c': s.color }"
          :aria-label="`${s.name}, 0 issues`"
        >
          <header class="col__head">
            <span class="col__sw"></span>
            <h2 class="col__name">{{ s.name }}</h2>
            <span class="col__count">0</span>
          </header>
          <div class="col__body">
            <div class="empty empty--sm"><span class="empty__g">◇</span>Nothing here yet.</div>
          </div>
        </section>
      </div>
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
  padding: var(--space-5);
  overflow-x: auto;
}
/* The column itself, its header and its body are styled globally — this only lays the columns out in a row. */
.cols {
  display: flex;
  gap: var(--space-4);
  align-items: flex-start;
}
.col__name {
  margin: 0;
}
</style>
