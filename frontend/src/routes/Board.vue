<script setup lang="ts">
// A board and its columns. Cards land in the next pass; what is here is the frame they will sit in.
import { computed, onMounted, ref, watch } from 'vue';
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
interface Board {
  id: string;
  name: string;
  position: number;
  states: State[];
}
interface Project {
  id: string;
  shortName: string;
  name: string;
  archived: boolean;
  boards: Board[];
}

const route = useRoute();
const project = ref<Project | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

const boards = computed(() =>
  [...(project.value?.boards ?? [])].sort((a, b) => a.position - b.position)
);
// The address names a board, or the project's first one stands in.
const current = computed(() => {
  const wanted = String(route.params.boardId ?? '');
  return boards.value.find((b) => b.id === wanted) ?? boards.value[0] ?? null;
});

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

    <nav v-if="boards.length > 1" class="tabs boardtabs" aria-label="Boards">
      <RouterLink
        v-for="b in boards"
        :key="b.id"
        class="tab"
        :to="`/p/${project?.shortName}/b/${b.id}`"
        :aria-current="b.id === current?.id ? 'page' : undefined"
      >{{ b.name }}</RouterLink>
    </nav>

    <div class="page__body">
      <p v-if="loading" class="hint">Loading…</p>
      <div v-else-if="error" class="empty"><span class="empty__g">✕</span>{{ error }}</div>
      <div v-else-if="current" class="cols">
        <section
          v-for="s in current.states"
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
      <div v-else class="empty"><span class="empty__g">◇</span>This project has no boards.</div>
    </div>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.boardtabs {
  padding: 0 var(--space-5);
  border-bottom: 1px solid var(--line);
  height: 44px;
}
.page__body {
  flex: 1 1 auto;
  padding: var(--space-5);
  overflow-x: auto;
}
.cols {
  display: flex;
  gap: var(--space-4);
  align-items: flex-start;
}
.col__name {
  margin: 0;
}
</style>
