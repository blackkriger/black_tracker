<script setup lang="ts">
// The bar every screen but sign-in carries: the projects side by side, the boards of the one you are in behind a caret, and who you are.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../lib/api';
import { useProjects } from '../lib/projects';
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
const currentBoardId = computed(() => String(route.params.boardId ?? ''));

// Only the project in view needs its boards, and only to fill the menu, so they are read when that project changes.
const boards = ref<{ id: string; name: string }[]>([]);
const open = ref(false);

watch(
  currentShort,
  async (short) => {
    open.value = false;
    if (!short) {
      boards.value = [];
      return;
    }
    try {
      boards.value = await api<{ id: string; name: string }[]>(
        `/projects/${encodeURIComponent(short)}/boards`
      );
    } catch {
      boards.value = [];
    }
  },
  { immediate: true }
);

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
  open.value = false;
}
function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') open.value = false;
}

async function pickBoard(id: string): Promise<void> {
  open.value = false;
  await router.push(`/p/${currentShort.value}/b/${id}`);
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
          v-if="p.shortName === currentShort && boards.length > 1"
          class="topitem topitem--caret"
          type="button"
          :aria-expanded="open"
          aria-label="Boards"
          @click="open = !open"
        >▾</button>

        <div v-if="open && p.shortName === currentShort" class="menu boardmenu" role="menu">
          <button
            v-for="b in boards"
            :key="b.id"
            class="menu__i"
            :class="{ 'is-cur': b.id === currentBoardId }"
            type="button"
            role="menuitem"
            @click="pickBoard(b.id)"
          >{{ b.name }}</button>
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
