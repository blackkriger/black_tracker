<script setup lang="ts">
// A wall of pictures, each the size it actually is: lib/masonry.ts puts every block at the lowest free place it fits, so a short one never leaves a hole under a tall neighbour. The same wall carries what is waiting to go up and what is already up — the dashed edge is the only difference between them.
import { ref } from 'vue';
import { X } from 'lucide-vue-next';
import { useWall } from '../lib/masonry';
import { fileSize, type Shot } from '../lib/issues';

const props = defineProps<{
  shots: Shot[];
  /** Whether each block carries the way to take it back. */
  removable?: boolean;
  /** Chosen but not yet uploaded, which is what the dashed edge says. */
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
          :aria-label="`Remove ${s.name}`"
          @click="emit('remove', s.key)"
        ><X class="ic ic--sm" /></button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* No columns: every block is the size of the picture in it, and the packer puts each one at the lowest free place it fits. The blocks are placed absolutely, which is what lets one start under a short neighbour rather than after the tallest block beside it. */
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
/* Its own size. A picture is never stretched to fill anything — only held back when it is wider than the room it has or taller than the ceiling. */
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
/* The size belongs to the name, so it follows it; the cross keeps the right edge. */
.wait__name {
  overflow-wrap: anywhere;
  font-size: 12.5px;
}
.wait__row .stamp {
  margin-right: auto;
}
</style>
