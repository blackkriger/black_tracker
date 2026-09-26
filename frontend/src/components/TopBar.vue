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
    <nav v-if="live.length" class="tabs projects" aria-label="Projects">
      <RouterLink
        v-for="p in live"
        :key="p.id"
        class="tab project"
        :to="`/p/${p.shortName}`"
        :aria-current="p.shortName === currentShort ? 'page' : undefined"
      >
        <span class="proj__k">{{ p.shortName }}</span>
        <span class="project__name">{{ p.name }}</span>
      </RouterLink>
    </nav>

    <div class="sp"></div>

    <RouterLink class="toplink" to="/profile">{{ session.me.value?.login }}</RouterLink>
    <RouterLink v-if="session.me.value?.isAdmin" class="toplink" to="/settings">Settings</RouterLink>
    <button class="btn btn--ghost btn--sm" type="button" @click="signOut">Sign out</button>
  </header>
</template>

<style scoped>
.projects {
  /* The bar's first element, so it carries no divider of its own. */
  padding-left: 0;
  border-left: 0;
  height: auto;
}
.project {
  gap: 8px;
  height: 32px;
}
.project__name {
  font-weight: 500;
}
</style>
