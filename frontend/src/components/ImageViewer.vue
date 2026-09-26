<script setup lang="ts">
// A picture, full screen: the viewer from another project, brought over and dressed in this theme. Wheel zooms towards the cursor, drag moves the picture, double click puts it back, arrows walk the set. `v-model:index` holds which one is open, null closes it.
import { computed, onUnmounted, ref, watch } from 'vue';
import { ChevronLeft, ChevronRight, X } from 'lucide-vue-next';

const props = defineProps<{ images: { src: string; name: string }[]; index: number | null }>();
const emit = defineEmits<{ (e: 'update:index', v: number | null): void }>();

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;

const zoom = ref(1);
const pan = ref({ x: 0, y: 0 });
const stage = ref<HTMLElement | null>(null);

const open = computed(
  () => props.index != null && props.index >= 0 && props.index < props.images.length
);
const current = computed(() => (open.value ? props.images[props.index as number] : null));
const count = computed(() => props.images.length);

function close(): void {
  emit('update:index', null);
}

function resetView(): void {
  zoom.value = 1;
  pan.value = { x: 0, y: 0 };
}

function go(dir: number): void {
  if (props.index == null || count.value < 2) return;
  emit('update:index', (props.index + dir + count.value) % count.value);
}

watch(() => props.index, resetView);

// Zoom towards the cursor: the point under it stays under it.
function onWheel(ev: WheelEvent): void {
  ev.preventDefault();
  const box = stage.value?.getBoundingClientRect();
  if (!box) return;
  const cx = ev.clientX - box.left - box.width / 2;
  const cy = ev.clientY - box.top - box.height / 2;
  const old = zoom.value;
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, old * (ev.deltaY < 0 ? 1.2 : 1 / 1.2)));
  if (next === old) return;
  pan.value =
    next === MIN_ZOOM
      ? { x: 0, y: 0 }
      : {
          x: cx - (cx - pan.value.x) * (next / old),
          y: cy - (cy - pan.value.y) * (next / old),
        };
  zoom.value = next;
}

let drag: { sx: number; sy: number; bx: number; by: number } | null = null;

function onPointerDown(ev: PointerEvent): void {
  if (ev.button !== 0) return;
  ev.preventDefault();
  drag = { sx: ev.clientX, sy: ev.clientY, bx: pan.value.x, by: pan.value.y };
  (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
}

function onPointerMove(ev: PointerEvent): void {
  if (!drag) return;
  pan.value = { x: drag.bx + (ev.clientX - drag.sx), y: drag.by + (ev.clientY - drag.sy) };
}

function onPointerUp(ev: PointerEvent): void {
  drag = null;
  (ev.currentTarget as HTMLElement).releasePointerCapture?.(ev.pointerId);
}

function onKey(ev: KeyboardEvent): void {
  if (!open.value) return;
  if (ev.key === 'Escape') close();
  else if (ev.key === 'ArrowLeft') go(-1);
  else if (ev.key === 'ArrowRight') go(1);
}

watch(open, (isOpen) => {
  if (isOpen) window.addEventListener('keydown', onKey, true);
  else window.removeEventListener('keydown', onKey, true);
});
onUnmounted(() => window.removeEventListener('keydown', onKey, true));
</script>

<template>
  <Teleport to="body">
    <div v-if="open && current" class="iviewer">
      <!-- A click on the empty stage closes; the picture itself is for dragging. -->
      <div ref="stage" class="iviewer__stage" @wheel="onWheel" @click.self="close">
        <img
          :src="current.src"
          :alt="current.name"
          class="iviewer__img"
          draggable="false"
          :style="{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @dblclick="resetView"
        />
      </div>

      <div class="iviewer__bar">
        <span class="iviewer__name">{{ current.name }}</span>
        <div class="iviewer__nav">
          <button v-if="count > 1" class="btn btn--sm" type="button" aria-label="Previous" @click="go(-1)"><ChevronLeft class="ic" /></button>
          <span v-if="count > 1" class="iviewer__n">{{ (index ?? 0) + 1 }} / {{ count }}</span>
          <button v-if="count > 1" class="btn btn--sm" type="button" aria-label="Next" @click="go(1)"><ChevronRight class="ic" /></button>
        </div>
        <button class="btn btn--sm iviewer__close" type="button" aria-label="Close" @click="close"><X class="ic" /></button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.iviewer {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  background: rgba(0, 0, 0, 0.88);
  user-select: none;
}
.iviewer__stage {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 24px;
}
.iviewer__img {
  display: block;
  max-width: 100%;
  max-height: 100%;
  transform-origin: center center;
  cursor: grab;
}
.iviewer__img:active {
  cursor: grabbing;
}
/* Three columns of equal weight on the outside: the name reads from the left edge, the close sits on the right, and the walk stays in the middle of the screen however long the name is. */
.iviewer__bar {
  flex: none;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--surface);
  border-top: 1px solid var(--line);
}
.iviewer__nav {
  display: flex;
  align-items: center;
  gap: 8px;
}
.iviewer__close {
  justify-self: end;
}
.iviewer__n {
  min-width: 56px;
  text-align: center;
  font: 12px/1 var(--font-num);
  color: var(--accent);
}
.iviewer__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  color: var(--text-muted);
}
</style>
