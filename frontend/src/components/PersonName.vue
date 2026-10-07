<script setup lang="ts">
import { usePeople } from '../lib/people';
import { ink } from '../lib/theme';

defineProps<{ login: string }>();

const { nameOf, colorOf } = usePeople();
</script>

<template>
  <span class="person">
    <span :style="{ color: ink(colorOf(login)) }">{{ nameOf(login) }}</span>
    <span v-if="nameOf(login) !== login" class="nick">{{ login }}</span>
  </span>
</template>

<style scoped>
.person {
  white-space: nowrap;
}
</style>
