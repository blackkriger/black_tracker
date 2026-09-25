<script setup lang="ts">
// The bar every screen but sign-in carries: which project you are in, and who you are.
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useProjects } from '../lib/projects';
import { lastProject } from '../lib/lastProject';
import { useSession } from '../lib/session';

const props = defineProps<{
  /** The project this screen belongs to, when it belongs to one. */
  project?: { shortName: string; name: string } | null;
}>();

const session = useSession();
const router = useRouter();
const { projects, load } = useProjects();

const open = ref(false);

const live = computed(() => projects.value.filter((p) => !p.archived));
// On a screen that stands outside a project — the profile — the switcher still names one, so it reads as "pick a project" rather than an empty slot. With no projects at all it draws nothing.
const current = computed(() => {
  if (props.project) return props.project;
  const remembered = live.value.find((p) => p.shortName === lastProject.get());
  return remembered ?? live.value[0] ?? null;
});

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

async function pick(shortName: string): Promise<void> {
  open.value = false;
  await router.push(`/p/${shortName}`);
}

async function signOut(): Promise<void> {
  await session.signOut();
  await router.push({ name: 'login' });
}
</script>

<template>
  <header class="top">
    <div v-if="current" class="switcher" @click.stop>
      <button class="proj" type="button" :aria-expanded="open" @click="open = !open">
        <span class="proj__k">{{ current.shortName }}</span>
        <span class="proj__name">{{ current.name }}</span>
        <span v-if="live.length > 1" class="caret">▾</span>
      </button>
      <div v-if="open && live.length > 1" class="menu switcher__menu" role="menu">
        <button
          v-for="p in live"
          :key="p.shortName"
          class="menu__i"
          :class="{ 'is-cur': p.shortName === current.shortName }"
          type="button"
          role="menuitem"
          @click="pick(p.shortName)"
        >
          <span class="proj__k switcher__k">{{ p.shortName }}</span>
          {{ p.name }}
        </button>
      </div>
    </div>

    <div class="sp"></div>

    <RouterLink v-if="session.me.value?.isAdmin" class="toplink" to="/admin">Admin</RouterLink>
    <RouterLink class="toplink" to="/profile">{{ session.me.value?.login }}</RouterLink>
    <button class="btn btn--ghost btn--sm" type="button" @click="signOut">Sign out</button>
  </header>
</template>

<style scoped>
.switcher {
  position: relative;
}
.switcher__menu {
  position: absolute;
  top: calc(100% - 4px);
  left: 0;
  z-index: 10;
}
.switcher__k {
  font-size: 12.5px;
}
</style>
