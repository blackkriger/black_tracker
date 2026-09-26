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
        class="topitem topitem--project"
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
.topitem--danger:hover {
  color: var(--danger-text);
}
</style>
