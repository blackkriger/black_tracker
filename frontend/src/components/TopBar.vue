<script setup lang="ts">
// The bar every screen but sign-in carries: which project you are in, how you are looking at it, and who you are.
import { useRouter } from 'vue-router';
import { useSession } from '../lib/session';

const props = defineProps<{
  /** Omitted on screens that stand outside a project, such as the profile. */
  project?: { shortName: string; name: string } | null;
}>();

const session = useSession();
const router = useRouter();

async function signOut(): Promise<void> {
  await session.signOut();
  await router.push({ name: 'login' });
}
</script>

<template>
  <header class="top">
    <RouterLink v-if="props.project" class="proj" :to="`/p/${props.project.shortName}`">
      <span class="proj__k">{{ props.project.shortName }}</span>
      <span class="proj__name">{{ props.project.name }}</span>
    </RouterLink>
    <RouterLink v-else class="proj" to="/">
      <span class="proj__name">Tracker</span>
    </RouterLink>

    <div class="sp"></div>

    <RouterLink class="toplink" to="/profile">{{ session.me.value?.login }}</RouterLink>
    <button class="btn btn--ghost btn--sm" type="button" @click="signOut">Sign out</button>
  </header>
</template>

<style scoped>
.proj {
  text-decoration: none;
}
</style>
