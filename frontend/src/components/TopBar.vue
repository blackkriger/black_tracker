<script setup lang="ts">
// The bar every screen but sign-in carries: the projects, side by side, and who you are.
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useProjects } from '../lib/projects';
import { useSession } from '../lib/session';

const props = defineProps<{
  /** The project this screen belongs to, when it belongs to one. */
  project?: { shortName: string; name: string } | null;
}>();

const session = useSession();
const router = useRouter();
const { projects, load } = useProjects();

const live = computed(() => projects.value.filter((p) => !p.archived));
const currentShort = computed(() => props.project?.shortName ?? null);

onMounted(() => void load());

async function signOut(): Promise<void> {
  await session.signOut();
  await router.push({ name: 'login' });
}
</script>

<template>
  <header class="top">
    <nav v-if="live.length" class="topitems" aria-label="Projects">
      <RouterLink
        v-for="p in live"
        :key="p.id"
        class="topitem"
        :to="`/p/${p.shortName}`"
        :aria-current="p.shortName === currentShort ? 'page' : undefined"
      >
        <span class="proj__k">{{ p.shortName }}</span>
        <span class="topitem__name">{{ p.name }}</span>
      </RouterLink>
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
/* One treatment for everything in the bar: a flat item that fills on hover and stays filled where you are. Only signing out reads differently, and only because it is the one thing here you would not want to hit by accident. */
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
  background: var(--surface);
}
.topitem[aria-current] {
  color: var(--text);
  background: var(--surface);
}
.topitem:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.topitem__name {
  font-weight: 500;
}
.topitem--danger:hover {
  color: var(--danger-text);
  background: color-mix(in srgb, var(--danger) 14%, transparent);
}
</style>
