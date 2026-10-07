<script setup lang="ts">
import { buddyAvatarStyle } from '../lib/avatar';
import { usePeople } from '../lib/people';

defineProps<{ logins: string[] }>();

const { nameOf } = usePeople();

function label(login: string): string {
  const name = nameOf(login);
  return name && name !== login ? `${name} (${login})` : login;
}
</script>

<template>
  <span v-if="logins.length" class="viewers">
    <span v-for="l in logins" :key="l" class="av" :style="buddyAvatarStyle(l)" :title="label(l)"></span>
  </span>
</template>

<style scoped>
.viewers {
  display: inline-flex;
  flex: none;
  gap: 4px;
}
.viewers .av {
  flex: none;
}
</style>
