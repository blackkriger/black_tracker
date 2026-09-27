<script setup lang="ts">
// The bar every screen but sign-in carries: the projects side by side, each naming the board it would open, and who you are.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useProjects, type ProjectMini } from '../lib/projects';
import { lastBoard } from '../lib/lastProject';
import { useLive } from '../lib/live';
import { useSession } from '../lib/session';
import { ChevronDown } from 'lucide-vue-next';

const props = defineProps<{
  /** The project this screen belongs to, when it belongs to one. */
  project?: { shortName: string; name: string } | null;
  /** The board being looked at, named beside its project so you can see where you are. */
  board?: { name: string; slug: string } | null;
}>();

const session = useSession();
const router = useRouter();
const { projects, load } = useProjects();

// No role is no access, so the one screen such a person has is not worth pointing at.
const hasRole = computed(() => session.me.value?.isAdmin === true || !!session.me.value?.role);

const live = computed(() => projects.value.filter((p) => !p.archived));
const currentShort = computed(() => props.project?.shortName ?? null);

// Which project's menu is open.
const openShort = ref<string | null>(null);

// The board each project would open, read once from storage and kept in step as you move around, since localStorage itself is not reactive.
const remembered = ref<Record<string, string>>({});
watch(
  live,
  (rows) => {
    const next: Record<string, string> = { ...remembered.value };
    for (const p of rows) {
      const slug = lastBoard.get(p.shortName);
      if (slug) next[p.shortName] = slug;
    }
    remembered.value = next;
  },
  { immediate: true }
);
watch(
  () => [currentShort.value, props.board?.slug] as const,
  ([short, slug]) => {
    if (short && slug) remembered.value = { ...remembered.value, [short]: slug };
  },
  { immediate: true }
);

// The screen knows better than storage which board it settled on, so it wins for the project you are on.
function shownBoard(p: ProjectMini): { name: string; slug: string } | null {
  if (p.shortName === currentShort.value && props.board) return props.board;
  if (!p.boards.length) return null;
  return p.boards.find((b) => b.slug === remembered.value[p.shortName]) ?? p.boards[0];
}

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

// Someone added a project or a board while this bar was on screen.
useLive((ev) => {
  if (['project.changed', 'board.changed'].includes(ev.type)) void load(true);
});

async function pickBoard(short: string, slug: string): Promise<void> {
  openShort.value = null;
  lastBoard.set(short, slug);
  remembered.value = { ...remembered.value, [short]: slug };
  await router.push(`/${short}/${slug}`);
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
          :to="`/${p.shortName}`"
          :aria-current="p.shortName === currentShort ? 'page' : undefined"
        >
          <span class="proj__k">{{ p.shortName }}</span>
          <span class="topitem__name">{{ p.name }}</span>
        </RouterLink>

        <span v-if="p.boards.length > 1" class="boardpick">
          <button
            class="topitem topitem--caret"
            type="button"
            :aria-expanded="openShort === p.shortName"
            :aria-label="`Boards of ${p.name}`"
            @click="openShort = openShort === p.shortName ? null : p.shortName"
          >
            <span class="topitem__board">{{ shownBoard(p)?.name }}</span>
            <ChevronDown class="ic ic--sm" />
          </button>

          <div v-if="openShort === p.shortName" class="menu boardmenu" role="menu">
            <button
              v-for="b in p.boards"
              :key="b.id"
              class="menu__i"
              :class="{ 'is-cur': b.slug === shownBoard(p)?.slug }"
              type="button"
              role="menuitem"
              @click="pickBoard(p.shortName, b.slug)"
            >{{ b.name }}</button>
          </div>
        </span>
        <RouterLink
          v-else-if="p.boards.length === 1"
          class="topitem topitem--caret topitem__board"
          :to="`/${p.shortName}/${p.boards[0].slug}`"
        >{{ p.boards[0].name }}</RouterLink>
      </span>
    </nav>

    <div class="sp"></div>

    <nav class="topitems" aria-label="Account">
      <RouterLink class="topitem" to="/profile">{{ session.me.value?.login }}</RouterLink>
      <RouterLink v-if="hasRole" class="topitem" to="/settings">Settings</RouterLink>
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
  gap: 6px;
  padding: 0 6px;
}
.topitem__board {
  color: var(--text);
  font-size: 13px;
}
.topitem__caret {
  font-size: 10px;
}
.boardpick {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.boardmenu {
  position: absolute;
  top: calc(100% + 7px);
  left: 0;
  z-index: 20;
}
/* The pointer above the menu, drawn twice: the border's triangle, then the surface's one pixel lower to cover the line under it. */
.boardmenu::before,
.boardmenu::after {
  content: "";
  position: absolute;
  bottom: 100%;
  left: 11px;
  border: 6px solid transparent;
}
.boardmenu::before {
  border-bottom-color: var(--line-2);
}
.boardmenu::after {
  margin-bottom: -1px;
  border-bottom-color: var(--card);
}
.topitem--danger:hover {
  color: var(--danger-text);
}
</style>
