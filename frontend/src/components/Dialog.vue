<script setup lang="ts">
// The modal every confirmation and short form uses: a dimmed page, a panel in the middle, Esc and a click outside to leave. It teleports to <body> so no parent's stacking context can trap it.
import { onMounted, onUnmounted } from 'vue';

defineProps<{ title: string; width?: number }>();
const emit = defineEmits<{ (e: 'close'): void }>();

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') emit('close');
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <div class="dialog__scrim" @click.self="emit('close')">
      <section class="dlg dialog" role="dialog" aria-modal="true" :style="{ width: `${width ?? 360}px` }">
        <header class="dlg__h">
          <span>{{ title }}</span>
          <button class="btn btn--sm btn--icon btn--ghost" type="button" aria-label="Close" @click="emit('close')">
            ✕
          </button>
        </header>
        <div class="dlg__b"><slot /></div>
        <div class="dlg__f"><slot name="footer" /></div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.dialog__scrim {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-5);
  background: rgba(0, 0, 0, 0.7);
}
.dialog {
  max-width: 100%;
}
</style>
