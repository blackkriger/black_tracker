<script setup lang="ts">
// The frame every admin screen sits in: the top bar, the section list on the left, and whatever the screen puts in the slot.
import { computed, onMounted } from 'vue';
import TopBar from './TopBar.vue';
import { useProjects } from '../lib/projects';

const { projects, loaded, load } = useProjects();

const live = computed(() => projects.value.filter((p) => !p.archived));
const archived = computed(() => projects.value.filter((p) => p.archived));

onMounted(() => void load());
</script>

<template>
  <div class="page">
    <TopBar />

    <div class="page__body">
      <nav class="side settings__side" aria-label="Settings sections">
        <div class="side__h">Projects</div>
        <span v-for="n in loaded ? 0 : 3" :key="n" class="sk sk--row side__sk"></span>
        <RouterLink v-for="p in live" :key="p.id" :to="`/settings/${p.shortName}`">
          {{ p.shortName }} {{ p.name }}
        </RouterLink>
        <RouterLink v-for="p in archived" :key="p.id" :to="`/settings/${p.shortName}`">
          {{ p.shortName }} {{ p.name }} (archived)
        </RouterLink>
        <RouterLink to="/settings/new">New project…</RouterLink>

        <div class="side__h">Workspace</div>
        <RouterLink to="/settings/tags">Tags</RouterLink>
        <RouterLink to="/settings/users">Users &amp; access</RouterLink>
      </nav>

      <div class="sheet">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The links sit at 32px with a 2px gap; the placeholders stand in the same rhythm. */
.side__sk {
  margin: 0 10px;
}
.page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
/* The section list plus the sheet travel as one block, centred: the sheet stays the same 960px it is everywhere else. */
.page__body {
  flex: 1 1 auto;
  display: flex;
  gap: var(--space-5);
  padding: var(--space-5);
  align-items: flex-start;
  justify-content: center;
  min-height: 0;
}
.settings__side {
  width: 220px;
  flex: none;
}
@media (max-width: 1240px) {
  .page__body {
    justify-content: flex-start;
  }
}
@media (max-width: 860px) {
  .page__body {
    flex-direction: column;
  }
  .settings__side {
    width: 100%;
  }
}
</style>
