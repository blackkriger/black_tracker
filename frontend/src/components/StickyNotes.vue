<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Palette, Plus, X } from 'lucide-vue-next';
import Dialog from './Dialog.vue';
import { api } from '../lib/api';
import { usePanelErrors } from '../lib/panelErrors';

type NoteColor = 'amber' | 'blue' | 'green' | 'pink' | 'violet' | 'plain';

interface Note {
  id: string;
  body: string;
  color: NoteColor;
  position: number;
  height: number | null;
  updatedAt: string;
}

const COLORS: NoteColor[] = ['amber', 'blue', 'green', 'pink', 'violet', 'plain'];

const { t } = useI18n();
const { errors, fail, clear } = usePanelErrors();

const notes = ref<Note[]>([]);
const loading = ref(true);
const adding = ref(false);
const coloring = ref<string | null>(null);
const deleting = ref<Note | null>(null);

const bodies = new Map<string, HTMLTextAreaElement>();
const saves = new Map<string, number>();
const resizes = new Map<string, number>();
const seen = new Map<string, number>();

async function patch(note: Note, body: Partial<Pick<Note, 'body' | 'color' | 'height'>>): Promise<void> {
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
    notes.value = [note, ...notes.value];
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
  clearTimeout(resizes.get(note.id));
  resizes.delete(note.id);
  seen.delete(note.id);
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

const observer = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const el = entry.target as HTMLElement;
    const id = el.dataset.note;
    if (!id) continue;
    const height = Math.round(el.offsetHeight);
    if (seen.get(id) === height) continue;
    const first = !seen.has(id);
    seen.set(id, height);
    if (first) continue;
    clearTimeout(resizes.get(id));
    resizes.set(
      id,
      window.setTimeout(() => {
        resizes.delete(id);
        const note = notes.value.find((n) => n.id === id);
        if (!note || note.height === height) return;
        note.height = height;
        void patch(note, { height });
      }, 450)
    );
  }
});

function watchSize(id: string, el: unknown): void {
  if (!(el instanceof HTMLElement) || el.dataset.note === id) return;
  el.dataset.note = id;
  observer.observe(el);
}

function keepBody(id: string, el: unknown): void {
  if (el instanceof HTMLTextAreaElement) bodies.set(id, el);
}

function onKey(ev: KeyboardEvent): void {
  if (ev.key === 'Escape' && coloring.value) coloring.value = null;
}

onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  for (const note of notes.value) flush(note);
  observer.disconnect();
});
</script>

<template>
  <div class="stickies">
    <span v-if="loading" class="sk sticky-sk"></span>
    <div
      v-for="n in notes"
      :key="n.id"
      :ref="(el) => watchSize(n.id, el)"
      class="sticky"
      :class="[`sticky--${n.color}`, { 'is-empty': !n.body.trim() }]"
      :style="n.height ? { height: `${n.height}px` } : undefined"
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
        <div v-if="coloring === n.id" class="sticky__colors" role="radiogroup" :aria-label="t('me.noteColor')">
          <button
            v-for="c in COLORS"
            :key="c"
            class="sticky__color"
            :class="`sticky--${c}`"
            type="button"
            role="radio"
            :aria-checked="n.color === c"
            :title="t(`me.noteColors.${c}`)"
            :aria-label="t(`me.noteColors.${c}`)"
            @click="recolor(n, c)"
          ></button>
        </div>
        <span class="sp"></span>
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
.sticky--violet {
  --h: var(--note-violet);
}
.sticky--plain {
  --h: var(--note-plain);
}
.sticky {
  display: flex;
  flex-direction: column;
  height: 188px;
  min-height: 96px;
  max-height: 4000px;
  background: color-mix(in oklab, var(--h) 10%, var(--card));
  border: 1px solid color-mix(in oklab, var(--h) 35%, var(--line));
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  resize: vertical;
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
  gap: 6px;
  padding-left: 6px;
}
.sticky__color {
  width: 14px;
  height: 14px;
  padding: 0;
  border: 1px solid color-mix(in oklab, var(--h) 60%, var(--line));
  background: var(--h);
  cursor: pointer;
}
.sticky__color[aria-checked='true'] {
  outline: 1px solid var(--text);
  outline-offset: 2px;
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
