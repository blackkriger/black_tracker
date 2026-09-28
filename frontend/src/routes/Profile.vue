<script setup lang="ts">
// The account on its own page. Settings hold the same panels, but somebody with no role
// cannot open settings at all, and this is the one screen left to them.
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
