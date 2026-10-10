<script lang="ts">
const stack: symbol[] = [];
</script>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { X } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';

defineProps<{ title: string; width?: number }>();
const { t } = useI18n();
const emit = defineEmits<{ (e: 'close'): void }>();
const pressedScrim = ref(false);

const self = Symbol('dialog');

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape' && stack[stack.length - 1] === self) emit('close');
}

onMounted(() => {
  stack.push(self);
  window.addEventListener('keydown', onKeydown);
});
onUnmounted(() => {
  stack.splice(stack.indexOf(self), 1);
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div
      class="dialog__scrim"
      @pointerdown="pressedScrim = $event.target === $event.currentTarget"
      @click.self="pressedScrim && emit('close')"
    >
      <section class="dlg dialog" role="dialog" aria-modal="true" :style="{ width: `${width ?? 360}px` }">
        <header class="dlg__h">
          <span>{{ title }}</span>
          <button class="btn btn--sm btn--icon btn--ghost" type="button" :aria-label="t('common.close')" @click="emit('close')">
            <X class="ic" />
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
  background: var(--scrim);
}
.dialog {
  display: flex;
  flex-direction: column;
  max-width: 100%;
  max-height: 100%;
}
.dlg__b {
  min-height: 0;
  overflow-y: auto;
}
</style>
