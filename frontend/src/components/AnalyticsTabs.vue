<script setup lang="ts">
import { RouterLink } from 'vue-router';
</script>

<template>
  <nav class="seg" aria-label="Analytics">
    <RouterLink class="seg__i" exact-active-class="is-on" :to="{ name: 'analytics' }">Issues</RouterLink>
    <RouterLink class="seg__i" exact-active-class="is-on" :to="{ name: 'analytics-feedback' }">Feedback</RouterLink>
  </nav>
</template>

<style scoped>
.seg {
  display: inline-flex;
  flex: none;
  height: 30px;
  border: 1px solid var(--line-2);
  background: var(--bg);
}
.seg__i {
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  color: var(--text-muted);
  font-size: 13px;
  text-decoration: none;
  cursor: pointer;
}
.seg__i + .seg__i {
  border-left: 1px solid var(--line-2);
}
.seg__i:hover,
.seg__i.is-on {
  color: var(--text);
}
.seg__i:focus-visible {
  box-shadow: var(--focus-ring);
  outline: none;
}
</style>
