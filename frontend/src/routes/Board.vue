<script setup lang="ts">
// A board and its columns. Cards land in the next pass; what is here is the frame they will sit in.
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import TopBar from '../components/TopBar.vue';
import { api } from '../lib/api';
import { lastBoard, lastProject } from '../lib/lastProject';

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
  slug: string;
  position: number;
  states: State[];
}
interface Tag {
  id: string;
  name: string;
  color: string;
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
// What this project can tag an issue with: its own tags and the global ones, in the server's order.
const tags = ref<Tag[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const boards = computed(() =>
  [...(project.value?.boards ?? [])].sort((a, b) => a.position - b.position)
);
// The address names a board; without one, the board you were last on here, and failing that the first.
const current = computed(() => {
  const wanted = String(route.params.slug ?? '').toLowerCase();
  if (wanted)
    return boards.value.find((b) => b.slug.toLowerCase() === wanted) ?? boards.value[0] ?? null;
  const short = project.value?.shortName;
  const remembered = short ? boards.value.find((b) => b.slug === lastBoard.get(short)) : null;
  return remembered ?? boards.value[0] ?? null;
});

// Whatever you end up looking at is what this project opens on next time.
watch(current, (board) => {
  const short = project.value?.shortName;
  if (board && short) lastBoard.set(short, board.slug);
});

async function load(short: string): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const [loaded, tagRows] = await Promise.all([
      api<Project>(`/projects/${encodeURIComponent(short)}`),
      api<Tag[]>(`/tags?project=${encodeURIComponent(short)}`),
    ]);
    project.value = loaded;
    tags.value = tagRows;
    lastProject.set(loaded.shortName);
  } catch (err) {
    project.value = null;
    tags.value = [];
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
    <TopBar :project="project" :board="current" />

    <div v-if="tags.length" class="tagbar">
      <span
        v-for="t in tags"
        :key="t.id"
        class="taglabel taglabel--plain"
        :style="{ '--c': t.color }"
      >{{ t.name }}</span>
    </div>

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
.tagbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 10px var(--space-5);
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
