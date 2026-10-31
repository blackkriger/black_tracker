<template>
  <footer class="authfoot stamp">
    <i18n-t keypath="settings.by" tag="span">
      <template #name>
        <a href="https://github.com/blackkriger" target="_blank" rel="noopener noreferrer">blackkriger</a>
      </template>
    </i18n-t>
  </footer>
</template>

<style scoped>
.authfoot {
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
