<script setup lang="ts">
import TopBar from './TopBar.vue';
import { useSession } from '../lib/session';

const { signedOut } = useSession();
</script>

<template>
  <div v-if="signedOut" class="signed-out">
    <div class="empty"><span class="empty__g">✕</span>{{ signedOut }}</div>
  </div>
  <template v-else>
    <TopBar />
    <RouterView />
  </template>
</template>

<style scoped>
.signed-out {
  padding: var(--space-6) var(--space-5);
}
</style>
