<script setup lang="ts">
import TopBar from '../components/TopBar.vue';
</script>

<template>
  <div class="page">
    <TopBar />
    <div class="page__body">
      <div class="empty">
        <span class="empty__g">404</span>
        No such page.
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.page__body {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
}
</style>
