<script setup lang="ts">
import { ref } from 'vue';
import { X } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { useWall } from '../lib/masonry';
import { fileSize, type Shot } from '../lib/issues';

const { t } = useI18n();
const props = defineProps<{
  shots: Shot[];
  removable?: boolean;
  waiting?: boolean;
}>();

const emit = defineEmits<{
  (e: 'open', key: string): void;
  (e: 'remove', key: string): void;
}>();

const wall = ref<HTMLElement | null>(null);
const pack = useWall(wall, () => props.shots.length);
</script>

<template>
  <div v-if="shots.length" ref="wall" class="waits">
    <div v-for="s in shots" :key="s.key" class="wait" :class="{ 'wait--waiting': waiting }">
      <button class="wait__img" type="button" @click="emit('open', s.key)">
        <img :src="s.src" :alt="s.name" @load="pack.repack()" />
      </button>
      <div class="wait__row">
        <span class="wait__name">{{ s.name }}</span>
        <span class="stamp">{{ fileSize(s.size) }}</span>
        <button
          v-if="removable"
          class="btn btn--sm btn--icon btn--ghost"
          type="button"
          :aria-label="t('files.remove', { name: s.name })"
          @click="emit('remove', s.key)"
        ><X class="ic ic--sm" /></button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.waits {
  position: relative;
  margin-top: 8px;
}
.wait {
  position: absolute;
  top: 0;
  left: 0;
  max-width: 100%;
  border: 1px solid var(--line);
  background: var(--bg);
  border-radius: var(--radius);
  overflow: hidden;
}
.wait--waiting {
  border: 1px dashed var(--line-2);
}
.wait__img {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  cursor: zoom-in;
}
.wait__img img {
  display: block;
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 420px;
}
.wait__row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 30px;
  padding: 0 4px 0 8px;
  border-top: 1px solid var(--line);
}
.wait--waiting .wait__row {
  border-top: 1px dashed var(--line-2);
}
.wait__name {
  overflow-wrap: anywhere;
  font-size: 12.5px;
}
.wait__row .stamp {
  margin-right: auto;
}
</style>
