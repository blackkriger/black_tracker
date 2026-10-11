<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Palette, Plus, X } from 'lucide-vue-next';
import Dialog from './Dialog.vue';
import { api } from '../lib/api';
import { usePanelErrors } from '../lib/panelErrors';

type NoteColor = 'amber' | 'blue' | 'green' | 'pink' | 'red';

interface Note {
  id: string;
  body: string;
  color: NoteColor;
  position: number;
  width: number | null;
  height: number | null;
  updatedAt: string;
}

const COLORS: NoteColor[] = ['amber', 'blue', 'green', 'pink', 'red'];

const { t } = useI18n();
const { errors, fail, clear } = usePanelErrors();

const notes = ref<Note[]>([]);
const loading = ref(true);
const adding = ref(false);
const coloring = ref<string | null>(null);
const deleting = ref<Note | null>(null);

const root = ref<HTMLElement | null>(null);
const room = ref<number | null>(null);
const bodies = new Map<string, HTMLTextAreaElement>();
const saves = new Map<string, number>();
let resizing: { note: Note; el: HTMLElement; width: number; height: number } | null = null;

async function patch(note: Note, body: Partial<Pick<Note, 'body' | 'color' | 'width' | 'height'>>): Promise<void> {
  clear('notes');
  try {
    await api(`/me/notes/${note.id}`, { method: 'PATCH', body });
  } catch (err) {
    fail('notes', err, t('me.noteSaveFailed'));
  }
}

async function ensureOne(): Promise<void> {
  if (notes.value.length) return;
  try {
    notes.value = [await api<Note>('/me/notes', { method: 'POST', body: {} })];
  } catch (err) {
    fail('notes', err);
  }
}

onMounted(async () => {
  try {
    notes.value = await api<Note[]>('/me/notes');
  } catch (err) {
    fail('notes', err, t('me.notesFailed'));
    return;
  } finally {
    loading.value = false;
  }
  await ensureOne();
});

function write(note: Note, ev: Event): void {
  note.body = (ev.target as HTMLTextAreaElement).value;
  clearTimeout(saves.get(note.id));
  saves.set(
    note.id,
    window.setTimeout(() => {
      saves.delete(note.id);
      void patch(note, { body: note.body });
    }, 600)
  );
}

function flush(note: Note): void {
  const pending = saves.get(note.id);
  if (pending === undefined) return;
  clearTimeout(pending);
  saves.delete(note.id);
  void patch(note, { body: note.body });
}

async function add(): Promise<void> {
  if (adding.value) return;
  adding.value = true;
  clear('notes');
  try {
    const note = await api<Note>('/me/notes', { method: 'POST', body: {} });
    notes.value = [...notes.value, note];
    await nextTick();
    bodies.get(note.id)?.focus();
  } catch (err) {
    fail('notes', err);
  } finally {
    adding.value = false;
  }
}

function askRemove(note: Note): void {
  if (note.body.trim()) deleting.value = note;
  else void remove(note);
}

async function remove(note: Note): Promise<void> {
  deleting.value = null;
  clearTimeout(saves.get(note.id));
  saves.delete(note.id);
  bodies.delete(note.id);
  clear('notes');
  const before = notes.value;
  notes.value = notes.value.filter((n) => n.id !== note.id);
  try {
    await api(`/me/notes/${note.id}`, { method: 'DELETE' });
  } catch (err) {
    notes.value = before;
    fail('notes', err);
  }
}

function confirmRemove(): void {
  if (deleting.value) void remove(deleting.value);
}

function recolor(note: Note, color: NoteColor): void {
  coloring.value = null;
  if (note.color === color) return;
  note.color = color;
  void patch(note, { color });
}

function measureRoom(): void {
  const el = root.value;
  if (!el) return;
  const host = el.closest<HTMLElement>('.page__body') ?? document.documentElement;
  const box = host.getBoundingClientRect();
  const right = box.left + host.clientLeft + host.clientWidth - parseFloat(getComputedStyle(host).paddingRight);
  room.value = Math.max(200, Math.floor(right - el.getBoundingClientRect().left));
}

function startResize(note: Note, ev: PointerEvent): void {
  const el = ev.currentTarget as HTMLElement;
  if (ev.target !== el) return;
  measureRoom();
  resizing = { note, el, width: el.offsetWidth, height: el.offsetHeight };
}

function endResize(): void {
  const r = resizing;
  resizing = null;
  if (!r) return;
  const width = Math.round(r.el.offsetWidth);
  const height = Math.round(r.el.offsetHeight);
  if (width === r.width && height === r.height) return;
  r.note.width = width;
  r.note.height = height;
  void patch(r.note, { width, height });
}

function keepBody(id: string, el: unknown): void {
  if (el instanceof HTMLTextAreaElement) bodies.set(id, el);
}

function onKey(ev: KeyboardEvent): void {
  if (ev.key === 'Escape' && coloring.value) coloring.value = null;
}

onMounted(() => {
  measureRoom();
  window.addEventListener('keydown', onKey);
  window.addEventListener('pointerup', endResize);
  window.addEventListener('resize', measureRoom);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('pointerup', endResize);
  window.removeEventListener('resize', measureRoom);
  for (const note of notes.value) flush(note);
});
</script>

<template>
  <div ref="root" class="stickies" :style="room ? { '--room': `${room}px` } : undefined">
    <span v-if="loading" class="sk sticky-sk"></span>
    <div
      v-for="n in notes"
      :key="n.id"
      class="sticky"
      :class="[`sticky--${n.color}`, { 'is-empty': !n.body.trim() }]"
      :style="{ width: n.width ? `${n.width}px` : undefined, height: n.height ? `${n.height}px` : undefined }"
      @pointerdown="startResize(n, $event)"
    >
      <div class="sticky__head">
        <button
          class="btn btn--sm btn--icon btn--ghost"
          type="button"
          :title="t('me.newNote')"
          :aria-label="t('me.newNote')"
          :disabled="adding"
          @click="add"
        ><Plus class="ic" /></button>
        <span class="sp"></span>
        <div v-if="coloring === n.id" class="sticky__colors" role="radiogroup" :aria-label="t('me.noteColor')">
          <button
            v-for="c in COLORS"
            :key="c"
            class="sticky__swatch"
            :class="[`sticky--${c}`, { 'is-active': n.color === c }]"
            type="button"
            role="radio"
            :aria-checked="n.color === c"
            :title="t(`me.noteColors.${c}`)"
            :aria-label="t(`me.noteColors.${c}`)"
            @click="recolor(n, c)"
          ></button>
        </div>
        <button
          class="btn btn--sm btn--icon btn--ghost"
          :class="{ 'is-on': coloring === n.id }"
          type="button"
          :title="t('me.noteColor')"
          :aria-label="t('me.noteColor')"
          :aria-expanded="coloring === n.id"
          @click="coloring = coloring === n.id ? null : n.id"
        ><Palette class="ic" /></button>
        <button
          class="btn btn--sm btn--icon btn--ghost"
          type="button"
          :title="t('me.deleteNote')"
          :aria-label="t('me.deleteNote')"
          :disabled="notes.length <= 1"
          @click="askRemove(n)"
        ><X class="ic" /></button>
      </div>
      <textarea
        :ref="(el) => keepBody(n.id, el)"
        class="sticky__body"
        spellcheck="false"
        maxlength="4000"
        :aria-label="t('me.note')"
        :value="n.body"
        @input="write(n, $event)"
        @blur="flush(n)"
      ></textarea>
    </div>
    <div v-if="errors.notes" class="err panel__err">{{ errors.notes }}</div>

    <Dialog v-if="deleting" :title="t('me.deleteNote')" @close="deleting = null">
      <p>{{ t('me.deleteNoteText') }}</p>
      <template #footer>
        <div class="sp"></div>
        <button class="btn" type="button" @click="deleting = null">{{ t('common.cancel') }}</button>
        <button class="btn btn--danger" type="button" @click="confirmRemove">{{ t('me.deleteNote') }}</button>
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.stickies {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.sticky-sk {
  display: block;
  height: 188px;
}
.sticky--amber {
  --h: var(--note-amber);
}
.sticky--blue {
  --h: var(--note-blue);
}
.sticky--green {
  --h: var(--note-green);
}
.sticky--pink {
  --h: var(--note-pink);
}
.sticky--red {
  --h: var(--note-red);
}
.sticky {
  display: flex;
  flex-direction: column;
  height: 188px;
  min-width: 200px;
  max-width: var(--room, 100%);
  min-height: 96px;
  max-height: 4000px;
  background: color-mix(in oklab, var(--h) 10%, var(--card));
  border: 1px solid color-mix(in oklab, var(--h) 35%, var(--line));
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  resize: both;
}
.sticky.is-empty {
  opacity: 0.55;
  transition: opacity 0.15s ease-out;
}
.sticky.is-empty:hover,
.sticky.is-empty:focus-within {
  opacity: 1;
}
.sticky__head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
  height: 30px;
  padding: 0 2px;
  background: color-mix(in oklab, var(--h) 22%, var(--card));
  border-bottom: 1px solid color-mix(in oklab, var(--h) 35%, var(--line));
}
.sticky__head .btn.is-on {
  color: var(--text);
}
.sticky__colors {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-right: 4px;
}
.sticky__swatch {
  width: 22px;
  height: 18px;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--black) 35%, transparent);
  background: var(--h);
  cursor: pointer;
}
.sticky__swatch:hover {
  outline: 1px solid var(--text-dim);
  outline-offset: 1px;
}
.sticky__swatch.is-active {
  outline: 1px solid var(--text);
  outline-offset: 1px;
}
.sticky__body {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  margin: 0;
  padding: 10px 12px;
  border: 0;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--text);
  font: 13px/1.55 var(--font-ui);
}
</style>
