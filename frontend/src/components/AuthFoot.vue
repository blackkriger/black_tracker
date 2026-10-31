<script setup lang="ts">
import mark from '../../../docs/icon.png';
</script>

<template>
  <footer class="authfoot stamp">
    <img :src="mark" alt="" width="20" height="20" />
    <i18n-t keypath="settings.by" tag="span">
      <template #name>
        <a href="https://github.com/blackkriger" target="_blank" rel="noopener noreferrer">blackkriger</a>
      </template>
    </i18n-t>
  </footer>
</template>

<style scoped>
.authfoot {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: auto;
}
.authfoot a {
  color: var(--text-dim);
  text-decoration: none;
}
.authfoot a:hover {
  color: var(--text);
}
</style>
