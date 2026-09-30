<script setup lang="ts">
import TopBar from '../components/TopBar.vue';
import ProfilePanels from '../components/ProfilePanels.vue';
</script>

<template>
  <div class="page">
    <TopBar />
    <div class="page__body">
      <div class="sheet">
        <ProfilePanels />
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
  padding: var(--space-6) var(--space-5);
}
</style>
