<script setup lang="ts">
// The frame every admin screen sits in: the top bar, the section list on the left, and whatever the screen puts in the slot.
import { computed, onMounted, ref } from 'vue';
import TopBar from './TopBar.vue';
import { ExternalLink } from 'lucide-vue-next';
import { api } from '../lib/api';
import { stamp } from '../lib/issues';
import { useLive } from '../lib/live';
import { useProjects } from '../lib/projects';

const { projects, loaded, load } = useProjects();

// When the running code was last changed, read from the commit the server stands on.
const updated = ref<string | null>(null);

const live = computed(() => projects.value.filter((p) => !p.archived));
const archived = computed(() => projects.value.filter((p) => p.archived));

onMounted(async () => {
  void load();
  try {
    const got = await api<{ updatedAt: string }>('/version');
    updated.value = got.updatedAt;
  } catch {
    // The date is a footnote; the settings themselves do not depend on it.
  }
});

useLive((ev) => {
  if (['project.changed', 'board.changed'].includes(ev.type)) void load(true);
});
</script>

<template>
  <div class="page">
    <TopBar />

    <div class="page__body">
      <nav class="side settings__side" aria-label="Settings sections">
        <div class="side__h">Profile</div>
        <RouterLink to="/settings/profile">Profile</RouterLink>
        <RouterLink to="/settings/api">API</RouterLink>

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
        <!-- pgweb on the same host, behind its own basic auth: the tracker's session does not open it. -->
        <a href="/db/" target="_blank" rel="noopener noreferrer">
          DB
          <ExternalLink class="ic ic--sm" />
        </a>

        <span class="side__foot stamp">
          <template v-if="updated">UPDATED {{ stamp(updated) }}</template>
        </span>
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
/* The list travels with the page under the bar and is exactly the height the screen leaves
   it, so its last line, the date the service was last updated, sits at the bottom without
   ever making the page itself taller. */
.settings__side {
  position: sticky;
  top: calc(var(--top-h) + var(--space-5));
  display: flex;
  flex-direction: column;
  width: 220px;
  flex: none;
  height: calc(100vh - var(--top-h) - var(--space-5) * 2);
  overflow-y: auto;
}
.side__foot {
  margin-top: auto;
  padding: 14px 10px 4px;
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
    position: static;
    width: 100%;
    height: auto;
  }
}
</style>
