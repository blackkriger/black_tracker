<script setup lang="ts">
// The bar every screen but sign-in carries: the projects side by side, each with its boards behind a caret, and who you are.
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../lib/api';
import { useProjects } from '../lib/projects';
import { lastBoard } from '../lib/lastProject';
import { useSession } from '../lib/session';

const props = defineProps<{
  /** The project this screen belongs to, when it belongs to one. */
  project?: { shortName: string; name: string } | null;
}>();

const session = useSession();
const router = useRouter();
const route = useRoute();
const { projects, load } = useProjects();

const live = computed(() => projects.value.filter((p) => !p.archived));
const currentShort = computed(() => props.project?.shortName ?? null);
const currentSlug = computed(() => String(route.params.slug ?? ''));

// Which project's menu is open, and the boards read so far. A project's boards are fetched the first time its caret is used and kept for the rest of the page's life.
const openShort = ref<string | null>(null);
const boardsByProject = ref<Record<string, { id: string; name: string; slug: string }[]>>({});

onMounted(() => {
  void load();
  window.addEventListener('click', closeMenu);
  window.addEventListener('keydown', onKeydown);
});
onUnmounted(() => {
  window.removeEventListener('click', closeMenu);
  window.removeEventListener('keydown', onKeydown);
});

function closeMenu(): void {
  openShort.value = null;
}
function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') openShort.value = null;
}

async function toggleBoards(short: string): Promise<void> {
  if (openShort.value === short) {
    openShort.value = null;
    return;
  }
  openShort.value = short;
  if (boardsByProject.value[short]) return;
  try {
    const rows = await api<{ id: string; name: string; slug: string }[]>(
      `/projects/${encodeURIComponent(short)}/boards`
    );
    boardsByProject.value = { ...boardsByProject.value, [short]: rows };
  } catch {
    boardsByProject.value = { ...boardsByProject.value, [short]: [] };
  }
}

async function pickBoard(short: string, slug: string): Promise<void> {
  openShort.value = null;
  lastBoard.set(short, slug);
  await router.push(`/p/${short}/b/${slug}`);
}

async function signOut(): Promise<void> {
  await session.signOut();
  await router.push({ name: 'login' });
}
</script>

<template>
  <header class="top">
    <nav v-if="live.length" class="topitems" aria-label="Projects">
      <span v-for="p in live" :key="p.id" class="topproj" @click.stop>
        <RouterLink
          class="topitem topitem--project"
          :to="`/p/${p.shortName}`"
          :aria-current="p.shortName === currentShort ? 'page' : undefined"
        >
          <span class="proj__k">{{ p.shortName }}</span>
          <span class="topitem__name">{{ p.name }}</span>
        </RouterLink>

        <button
          class="topitem topitem--caret"
          type="button"
          :aria-expanded="openShort === p.shortName"
          :aria-label="`Boards of ${p.name}`"
          @click="toggleBoards(p.shortName)"
        >▾</button>

        <div v-if="openShort === p.shortName" class="menu boardmenu" role="menu">
          <button
            v-for="b in boardsByProject[p.shortName] ?? []"
            :key="b.id"
            class="menu__i"
            :class="{ 'is-cur': p.shortName === currentShort && b.slug === currentSlug }"
            type="button"
            role="menuitem"
            @click="pickBoard(p.shortName, b.slug)"
          >{{ b.name }}</button>
          <div v-if="!(boardsByProject[p.shortName] ?? []).length" class="menu__h">No boards yet.</div>
        </div>
      </span>
    </nav>

    <div class="sp"></div>

    <nav class="topitems" aria-label="Account">
      <RouterLink class="topitem" to="/profile">{{ session.me.value?.login }}</RouterLink>
      <RouterLink v-if="session.me.value?.isAdmin" class="topitem" to="/settings">Settings</RouterLink>
      <button class="topitem topitem--danger" type="button" @click="signOut">Sign out</button>
    </nav>
  </header>
</template>

<style scoped>
/* Nothing in the bar takes a background: the text itself does the talking. It brightens on hover, turns gold on a project — the bright gold, a shade up from the key beside it — and red on the one action you would not want to hit by accident. */
.topitems {
  display: flex;
  align-items: center;
  gap: 2px;
}
.topitem {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 10px;
  border: 0;
  background: none;
  color: var(--text-dim);
  font: 13px var(--font-ui);
  text-decoration: none;
  cursor: pointer;
}
.topitem:hover {
  color: var(--text);
}
.topitem--project:hover,
.topitem--project[aria-current] {
  color: var(--accent-bright);
}
.topitem:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.topitem__name {
  font-weight: 500;
}
.topproj {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.topitem--caret {
  padding: 0 6px;
  font-size: 10px;
}
.boardmenu {
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  z-index: 20;
}
.topitem--danger:hover {
  color: var(--danger-text);
}
</style>
