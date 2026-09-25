<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../lib/api';
import { useSession } from '../lib/session';

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
}

const session = useSession();
const projects = ref<Project[]>([]);
const states = ref<State[]>([]);
const error = ref<string | null>(null);
const loading = ref(true);

onMounted(async () => {
  try {
    projects.value = await api<Project[]>('/projects');
    const first = projects.value.find((p) => !p.archived);
    if (first) {
      states.value = await api<State[]>(`/projects/${first.shortName}/states`);
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not load the board.';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="app">
    <header class="top">
      <button class="proj" type="button">
        <span class="proj__k">{{ projects[0]?.shortName ?? '—' }}</span>
        <span class="proj__name">{{ projects[0]?.name ?? 'No projects yet' }}</span>
      </button>
      <div class="sp"></div>
      <span class="hint">{{ session.me.value?.login }}</span>
      <button class="btn btn--ghost btn--sm" type="button" @click="session.signOut().then(() => $router.push('/login'))">
        Sign out
      </button>
    </header>

    <div class="board">
      <p v-if="loading" class="hint">Loading…</p>
      <p v-else-if="error" class="hint">{{ error }}</p>
      <p v-else-if="!projects.length" class="hint">No projects yet. An admin creates the first one.</p>
      <div v-else class="cols">
        <section v-for="s in states" :key="s.id" class="col">
          <header class="col__h">
            <b class="col__dot" :style="{ background: s.color }"></b>
            <span class="col__name">{{ s.name }}</span>
            <span class="col__count">0</span>
          </header>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.board {
  padding: var(--space-5);
}
.cols {
  display: flex;
  gap: var(--space-4);
  align-items: flex-start;
}
.col {
  width: var(--col-w);
  background: var(--surface);
  border: 1px solid var(--line);
}
.col__h {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 40px;
  padding: 0 var(--space-3);
  border-bottom: 1px solid var(--line);
  font-weight: 600;
}
.col__dot {
  width: 8px;
  height: 8px;
  flex: none;
}
.col__count {
  margin-left: auto;
  font-family: var(--font-num);
  font-size: 12.5px;
  color: var(--text-muted);
}
</style>
