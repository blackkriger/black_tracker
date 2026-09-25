<script setup lang="ts">
// The bar every screen but sign-in carries: which project you are in, how you are looking at it, and who you are.
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useSession } from '../lib/session';

const props = defineProps<{
  /** Omitted on screens that stand outside a project, such as the profile. */
  project?: { shortName: string; name: string } | null;
}>();

const session = useSession();
const router = useRouter();

// The avatar is the same initials-on-colour plate another project uses, hashed off the login so a person keeps their colour.
const initials = computed(() => {
  const source = session.me.value?.fullName || session.me.value?.login || '';
  const parts = source.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : source.slice(0, 2);
  return letters.toUpperCase();
});

const avatarColor = computed(() => {
  const login = session.me.value?.login ?? '';
  let hash = 0;
  for (const ch of login) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `var(--mono-c${hash % 8})`;
});

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
    <RouterLink class="user" to="/profile" :aria-label="`Profile: ${session.me.value?.login}`">
      <span class="av" :style="{ '--c': avatarColor }">{{ initials }}</span>
    </RouterLink>
    <button class="btn btn--ghost btn--sm" type="button" @click="signOut">Sign out</button>
  </header>
</template>

<style scoped>
.proj {
  text-decoration: none;
}
</style>
