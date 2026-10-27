<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { usePeople } from '../lib/people';
import { useRoles } from '../lib/roles';
import { useProjects } from '../lib/projects';
import { api } from '../lib/api';
import type { IssueLink } from '../lib/issues';
import Quill from 'quill';
import 'quill/dist/quill.core.css';
import { clean } from '../lib/richtext';
import '../lib/mention-blot';
import '../lib/issue-key-blot';
import { KEY, keyInfo, keysVersion } from '../lib/issueKeys';
import { nameAt } from '../lib/mentions';
import {
  Bold,
  ChevronLeft,
  Code,
  Heading3,
  ImagePlus,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Strikethrough,
} from 'lucide-vue-next';
import { ink } from '../lib/theme';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const body = defineModel<string>({ required: true });
const props = defineProps<{ placeholder?: string; minHeight?: string; disabled?: boolean; inlineImages?: boolean }>();
const emit = defineEmits<{ (e: 'files', list: File[]): void; (e: 'blur'): void }>();

const INLINE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const INLINE_LIMIT = 20 * 1024 * 1024;
const picker = ref<HTMLInputElement | null>(null);

const { people, load: loadPeople } = usePeople();
const { roles, load: loadRoles } = useRoles();
const { projects, load: loadProjects } = useProjects();

const wrap = ref<HTMLDivElement | null>(null);
const host = ref<HTMLDivElement | null>(null);
let quill: Quill | null = null;
let fromEditor = false;

const focused = ref(false);
const overWithFiles = ref(false);

// Quill would inline pasted or dropped images as base64, which clean() strips; intercept them first.
function onPaste(ev: ClipboardEvent): void {
  const files = ev.clipboardData?.files;
  if (!files?.length) return;
  ev.preventDefault();
  ev.stopPropagation();
  takeFiles([...files]);
}

const inlinable = (file: File): boolean =>
  !!props.inlineImages && INLINE_TYPES.includes(file.type) && file.size <= INLINE_LIMIT;

function readUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function insertPictures(files: File[]): Promise<void> {
  for (const file of files) {
    const url = await readUrl(file);
    if (!quill) return;
    const at = quill.getSelection(true)?.index ?? quill.getLength();
    quill.insertEmbed(at, 'image', url, 'user');
    quill.setSelection(at + 1, 0, 'user');
  }
}

function takeFiles(list: File[]): void {
  const others = list.filter((f) => !inlinable(f));
  if (others.length) emit('files', others);
  void insertPictures(list.filter(inlinable));
}

function onPicked(ev: Event): void {
  const input = ev.target as HTMLInputElement;
  takeFiles([...(input.files ?? [])]);
  input.value = '';
}

const carriesFiles = (ev: DragEvent): boolean =>
  Array.from(ev.dataTransfer?.types ?? []).includes('Files');

function onDragOver(ev: DragEvent): void {
  if (!carriesFiles(ev)) return;
  ev.preventDefault();
  overWithFiles.value = true;
}

function onDrop(ev: DragEvent): void {
  if (!carriesFiles(ev)) return;
  ev.preventDefault();
  ev.stopPropagation();
  overWithFiles.value = false;
  const list = ev.dataTransfer?.files;
  if (list?.length) takeFiles([...list]);
}

const marks = ref({
  bold: false,
  italic: false,
  strike: false,
  code: false,
  blockquote: false,
  bullet: false,
  ordered: false,
  check: false,
  header: false,
});

function readMarks(): void {
  if (!quill) return;
  const sel = quill.getSelection();
  const f: Record<string, unknown> = sel ? quill.getFormat(sel) : {};
  marks.value = {
    bold: !!f.bold,
    italic: !!f.italic,
    strike: !!f.strike,
    code: !!f.code,
    blockquote: !!f.blockquote,
    bullet: f.list === 'bullet',
    ordered: f.list === 'ordered',
    check: f.list === 'checked' || f.list === 'unchecked',
    header: f.header === 3,
  };
}

const naming = ref<{ from: number; query: string } | null>(null);
const keying = ref<{ from: number; query: string; moved: boolean } | null>(null);
const issueHits = ref<IssueLink[]>([]);
let keySearch = 0;
let keyTimer = 0;
const chosen = ref(0);
const list = ref<HTMLDivElement | null>(null);
const rows = ref<HTMLDivElement | null>(null);
const caret = ref({ left: 0, top: 0, bottom: 0 });
const at = ref({ left: 0, top: 0, tip: 12, room: 0, up: false, ready: false });

interface Named {
  id: string;
  label: string;
  color: string | null;
  hint: string;
  key?: boolean;
}

const projectKeys = computed(
  () => new Set(projects.value.filter((p) => !p.archived).map((p) => p.shortName))
);

const matches = computed<Named[]>(() => {
  if (keying.value) {
    return issueHits.value.map((h) => ({
      id: h.id,
      label: h.key,
      color: h.stateColor,
      hint: h.summary,
      key: true,
    }));
  }
  if (!naming.value) return [];
  const q = naming.value.query.toLowerCase();
  const who = people.value
    .filter((p) => p.login.toLowerCase().includes(q) || p.fullName.toLowerCase().includes(q))
    .map((p) => ({ id: p.id, label: p.login, color: null, hint: p.fullName }));
  const what = roles.value
    .filter((r) => r.name.toLowerCase().includes(q))
    .map((r) => ({ id: r.id, label: r.name, color: r.color, hint: '' }));
  return [...who, ...what].slice(0, 8);
});

const GAP = 6;
const EDGE = 8;

function measure(): void {
  if (!quill) return;
  const sel = quill.getSelection();
  const box = sel ? quill.getBounds(sel.index) : null;
  const rect = host.value?.getBoundingClientRect();
  if (!box || !rect) return;
  caret.value = {
    left: rect.left + box.left,
    top: rect.top + box.top,
    bottom: rect.top + box.bottom,
  };
}

function place(): void {
  const el = list.value;
  if (!el) return;
  const walls = wrap.value?.closest('.dlg')?.getBoundingClientRect();
  const wallL = (walls?.left ?? 0) + EDGE;
  const wallR = (walls?.right ?? window.innerWidth) - EDGE;
  const wallT = (walls?.top ?? 0) + EDGE;
  const wallB = (walls?.bottom ?? window.innerHeight) - EDGE;
  const below = wallB - caret.value.bottom - GAP;
  const above = caret.value.top - GAP - wallT;
  const shell = el.offsetHeight - (rows.value?.offsetHeight ?? 0);
  const up = (rows.value?.scrollHeight ?? 0) + shell > below && above > below;
  const room = Math.max(0, (up ? above : below) - shell);
  const left = Math.max(wallL, Math.min(caret.value.left, wallR - el.offsetWidth));
  at.value = {
    left,
    top: up ? caret.value.top - GAP : caret.value.bottom + GAP,
    tip: Math.max(12, Math.min(caret.value.left - left, el.offsetWidth - 12)),
    room,
    up,
    ready: room > 32 && caret.value.top < wallB && caret.value.bottom > wallT,
  };
}

function findIssues(query: string): void {
  const mine = ++keySearch;
  window.clearTimeout(keyTimer);
  keyTimer = window.setTimeout(async () => {
    try {
      const rows = await api<IssueLink[]>(`/issues/search?q=${encodeURIComponent(query)}`);
      if (mine !== keySearch) return;
      const prefix = query.includes('-') ? query : `${query}-`;
      issueHits.value = rows.filter((r) => r.key.startsWith(prefix)).slice(0, 8);
      chosen.value = 0;
      void nextTick(place);
    } catch {
      if (mine === keySearch) issueHits.value = [];
    }
  }, 150);
}

watch(keying, (now) => {
  if (now) return;
  ++keySearch;
  issueHits.value = [];
});

function lookForName(): void {
  if (!quill) return;
  const sel = quill.getSelection();
  if (!sel || sel.length) {
    naming.value = null;
    keying.value = null;
    return;
  }
  const back = Math.min(40, sel.index);
  const before = quill.getText(sel.index - back, back);
  const found = /(?:^|\s)@([a-zA-Z0-9_.-]*)$/.exec(before);
  if (found) {
    keying.value = null;
    naming.value = { from: sel.index - found[1].length - 1, query: found[1] };
    chosen.value = 0;
    measure();
    void nextTick(place);
    return;
  }
  naming.value = null;
  const typed = /(?:^|[\s(])([A-Z][A-Z0-9]*(?:-\d*)?)$/.exec(before)?.[1];
  if (!typed || !projectKeys.value.has(typed.split('-')[0])) {
    keying.value = null;
    at.value = { ...at.value, ready: false };
    return;
  }
  if (typed !== keying.value?.query) {
    keying.value = { from: sel.index - typed.length, query: typed, moved: false };
    findIssues(typed);
  }
  measure();
  void nextTick(place);
}

function follow(): void {
  if (!naming.value && !keying.value) return;
  measure();
  place();
}

let painting = false;
function paintNames(): void {
  if (!quill || painting) return;
  painting = true;
  const text = quill.getText();
  quill.formatText(0, text.length, 'mention', false, 'silent');
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '@') continue;
    if (i > 0 && !/\s/.test(text[i - 1])) continue;
    const found = nameAt(text, i + 1);
    if (!found) continue;
    quill.formatText(i, found.name.length + 1, 'mention', found.name, 'silent');
    i += found.name.length;
  }
  painting = false;
}

watch([people, roles], () => paintNames());

function paintKeys(): void {
  if (!quill) return;
  const text = quill.getText();
  quill.formatText(0, text.length, 'issuekey', false, 'silent');
  for (const m of text.matchAll(KEY)) {
    const from = m.index ?? 0;
    const f = quill.getFormat(from, m[0].length);
    if (f.code || f['code-block'] || f.link) continue;
    const info = keyInfo(m[0]);
    if (info) quill.formatText(from, m[0].length, 'issuekey', info.key, 'silent');
  }
}

watch(keysVersion, () => paintKeys());

function pickKey(key: string): void {
  if (!quill || !keying.value) return;
  const { from, query } = keying.value;
  keying.value = null;
  quill.deleteText(from, query.length, 'user');
  quill.insertText(from, `${key} `, 'user');
  quill.setSelection(from + key.length + 1, 0, 'silent');
}

function pick(n: Named): void {
  if (n.key) pickKey(n.label);
  else pickName(n.label);
}

function pickName(login: string): void {
  if (!quill || !naming.value) return;
  const { from, query } = naming.value;
  naming.value = null;
  quill.deleteText(from, query.length + 1, 'user');
  quill.insertText(from, `@${login} `, 'user');
  quill.setSelection(from + login.length + 2, 0, 'silent');
}

// Capture phase: must run before Quill's Enter handling and the dialog's window Escape listener.
function onNameKey(ev: KeyboardEvent): void {
  if (!matches.value.length) return;
  const stop = () => {
    ev.preventDefault();
    ev.stopPropagation();
  };
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    const step = ev.key === 'ArrowDown' ? 1 : -1;
    chosen.value = (chosen.value + step + matches.value.length) % matches.value.length;
    if (keying.value) keying.value.moved = true;
    stop();
  } else if (ev.key === 'Enter' && keying.value && !keying.value.moved && !keying.value.query.includes('-')) {
    keying.value = null;
  } else if (ev.key === 'Enter' || ev.key === 'Tab') {
    pick(matches.value[chosen.value]);
    stop();
  } else if (ev.key === 'Escape') {
    naming.value = null;
    keying.value = null;
    stop();
  }
}

onMounted(() => {
  void loadPeople();
  void loadRoles();
  void loadProjects();
  if (!host.value) return;
  quill = new Quill(host.value, {
    theme: undefined,
    placeholder: props.placeholder,
    formats: [
      'bold',
      'italic',
      'strike',
      'code',
      'code-block',
      'blockquote',
      'list',
      'header',
      'link',
      'image',
      'mention',
      'issuekey',
    ],
  });
  if (body.value) {
    quill.clipboard.dangerouslyPasteHTML(clean(body.value), 'silent');
    setTimeout(() => {
      paintNames();
      paintKeys();
    }, 0);
  }
  quill.on('text-change', () => {
    fromEditor = true;
    body.value = clean(quill?.root.innerHTML ?? '');
    readMarks();
    // Quill fires text-change before it moves the selection, so read the caret a tick later.
    setTimeout(() => {
      lookForName();
      paintNames();
      paintKeys();
    }, 0);
  });
  quill.on('selection-change', () => {
    readMarks();
    lookForName();
  });
  quill.root.addEventListener('keydown', onNameKey, true);
  document.addEventListener('scroll', follow, true);
  window.addEventListener('resize', follow);
  quill.enable(!props.disabled);
  quill.root.addEventListener('focus', () => (focused.value = true));
  quill.root.addEventListener('blur', () => {
    focused.value = false;
    emit('blur');
  });
});

// Clicking empty space in a dialog leaves the contenteditable focused, so blur it on any outside press.
function onPointerDown(ev: Event): void {
  if (!focused.value || !quill) return;
  const target = ev.target;
  if (target instanceof Node && wrap.value?.contains(target)) return;
  quill.root.blur();
}

onMounted(() => document.addEventListener('pointerdown', onPointerDown, true));

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown, true);
  document.removeEventListener('scroll', follow, true);
  window.removeEventListener('resize', follow);
  quill?.root.removeEventListener('keydown', onNameKey, true);
  quill = null;
});

watch(
  () => props.disabled,
  (off) => quill?.enable(!off)
);

watch(body, (next) => {
  if (fromEditor) {
    fromEditor = false;
    return;
  }
  if (!quill || clean(quill.root.innerHTML) === next) return;
  quill.clipboard.dangerouslyPasteHTML(clean(next ?? ''), 'silent');
  setTimeout(() => {
    paintNames();
    paintKeys();
  }, 0);
});

function toggleChecklist(): void {
  if (!quill) return;
  const list = quill.getFormat().list;
  quill.format('list', list === 'checked' || list === 'unchecked' ? false : 'unchecked', 'user');
  quill.focus();
  readMarks();
}

function toggle(format: string, value: unknown = true): void {
  if (!quill) return;
  const has = quill.getFormat()[format];
  quill.format(format, has === value ? false : value, 'user');
  quill.focus();
  readMarks();
}

defineExpose({
  focus(atEnd = false): void {
    if (!quill) return;
    quill.focus();
    if (atEnd) quill.setSelection(quill.getLength(), 0, 'silent');
  },
});

function addLink(): void {
  if (!quill) return;
  const range = quill.getSelection(true);
  if (!range || range.length === 0) return;
  const url = window.prompt(t('editor.linkTo'));
  if (url === null) return;
  quill.format('link', url.trim() || false, 'user');
  readMarks();
}
</script>

<template>
  <div ref="wrap" class="rt" :class="{ 'is-off': disabled }">
    <div class="mdbar">
      <button type="button" :aria-pressed="marks.bold" :title="t('editor.bold')" @click="toggle('bold')"><Bold class="ic" /></button>
      <button type="button" :aria-pressed="marks.italic" :title="t('editor.italic')" @click="toggle('italic')"><Italic class="ic" /></button>
      <button type="button" :aria-pressed="marks.strike" :title="t('editor.strike')" @click="toggle('strike')"><Strikethrough class="ic" /></button>
      <button type="button" :aria-pressed="marks.code" :title="t('editor.code')" @click="toggle('code')"><Code class="ic" /></button>
      <button type="button" :aria-pressed="marks.header" :title="t('editor.heading')" @click="toggle('header', 3)"><Heading3 class="ic" /></button>
      <button type="button" :aria-pressed="marks.bullet" :title="t('editor.bullets')" @click="toggle('list', 'bullet')"><List class="ic" /></button>
      <button type="button" :aria-pressed="marks.ordered" :title="t('editor.numbers')" @click="toggle('list', 'ordered')"><ListOrdered class="ic" /></button>
      <button type="button" :aria-pressed="marks.check" :title="t('editor.checklist')" @click="toggleChecklist"><ListChecks class="ic" /></button>
      <button type="button" :aria-pressed="marks.blockquote" :title="t('editor.quote')" @click="toggle('blockquote')"><Quote class="ic" /></button>
      <button type="button" :title="t('editor.link')" @click="addLink"><Link class="ic" /></button>
      <span v-if="inlineImages || $slots.tools" class="mdbar__sep" aria-hidden="true"></span>
      <template v-if="inlineImages">
        <button type="button" :title="t('editor.image')" @click="picker?.click()"><ImagePlus class="ic" /></button>
        <input
          ref="picker"
          type="file"
          multiple
          accept="image/png,image/jpeg,image/gif,image/webp"
          class="sr"
          tabindex="-1"
          @change="onPicked"
        />
      </template>
      <slot name="tools" />
    </div>
    <div
      ref="host"
      class="rt__editor"
      :class="{ 'is-drop': overWithFiles }"
      :style="{ minHeight: minHeight ?? '120px' }"
      @dragover="onDragOver"
      @dragleave="overWithFiles = false"
      @drop.capture="onDrop"
      @paste.capture="onPaste"
    ></div>

    <div
      v-if="matches.length"
      ref="list"
      class="menu rt__names"
      :class="{ 'is-up': at.up, 'is-set': at.ready }"
      :style="{ left: `${at.left}px`, top: `${at.top}px`, '--tip': `${at.tip}px` }"
    >
      <div ref="rows" class="rt__rows" :style="{ maxHeight: `${at.room}px` }">
        <button
          v-for="(n, i) in matches"
          :key="n.id"
          class="menu__i"
          :class="{ 'is-hover': i === chosen }"
          type="button"
          @mousedown.prevent="pick(n)"
        >
          <span :class="{ key: n.key }" :style="{ color: ink(n.color) }">{{ n.label }}</span>
          <span v-if="n.hint" class="rt__full" :class="{ 'rt__full--clip': n.key }">{{ n.hint }}</span>
          <ChevronLeft class="ic ic--sm rt__at" :class="{ 'is-off': i !== chosen }" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rt {
  position: relative;
}
.rt__names {
  position: fixed;
  z-index: 40;
  min-width: 180px;
  visibility: hidden;
}
.rt__rows {
  overflow-y: auto;
}
.rt__names.is-up {
  transform: translateY(-100%);
}
.rt__names.is-set {
  visibility: visible;
}
.rt__names::before,
.rt__names::after {
  content: "";
  position: absolute;
  bottom: 100%;
  left: var(--tip, 12px);
  margin-left: -6px;
  border: 6px solid transparent;
}
.rt__names::before {
  border-bottom-color: var(--line-2);
}
.rt__names::after {
  margin-bottom: -1px;
  border-bottom-color: var(--card);
}
.rt__names.is-up::before,
.rt__names.is-up::after {
  top: 100%;
  bottom: auto;
  border-bottom-color: transparent;
}
.rt__names.is-up::before {
  border-top-color: var(--line-2);
}
.rt__names.is-up::after {
  margin-top: -1px;
  margin-bottom: 0;
  border-top-color: var(--card);
}
.rt__names .menu__i:hover,
.rt__names .menu__i.is-hover {
  background: none;
}
.rt__full {
  color: var(--text-muted);
  font-size: 12px;
}
.rt__full--clip {
  max-width: 320px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.rt__at {
  margin-left: auto;
  color: var(--text);
}
.rt__at.is-off {
  visibility: hidden;
}
.rt.is-off {
  pointer-events: none;
  opacity: 0.6;
}
.rt__editor {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line-2);
  background: var(--bg);
  color: var(--text);
  font: 13.5px/1.6 var(--font-ui);
  overflow-y: auto;
  max-height: 340px;
  border-radius: 0 0 var(--radius) var(--radius);
}
.rt__editor.is-drop {
  border-style: dashed;
  border-color: var(--focus);
  background: color-mix(in srgb, var(--focus) 6%, var(--bg));
}
.rt__editor :deep(.ql-editor) {
  flex: 1 1 auto;
  padding: 10px 12px;
  outline: none;
}
.rt__editor :deep(.ql-editor img) {
  display: block;
  max-width: 100%;
  height: auto;
}
.rt__editor :deep(.ql-editor.ql-blank::before) {
  content: attr(data-placeholder);
  position: absolute;
  left: 12px;
  top: 10px;
  color: var(--text-muted);
  font-style: normal;
  pointer-events: none;
}
.rt__editor :deep(p) {
  margin: 0 0 8px;
}
.rt__editor :deep(p:last-child) {
  margin-bottom: 0;
}
.rt__editor :deep(h3) {
  margin: 12px 0 6px;
  font: 600 15px var(--font-ui);
}
.rt__editor :deep(blockquote) {
  margin: 0 0 8px;
  padding-left: 10px;
  border-left: 2px solid var(--line-2);
  color: var(--text-dim);
}
.rt__editor :deep(code) {
  padding: 1px 5px;
  background: var(--surface);
  border: 1px solid var(--line);
  font: 12.5px var(--font-mono);
  border-radius: var(--radius-sm);
}
.rt__editor :deep(ol),
.rt__editor :deep(ul) {
  margin: 0 0 8px;
  padding-left: 22px;
}
/* Quill 2 renders both list kinds as <ol data-list> and draws markers in .ql-ui, hidden below. */
.rt__editor :deep(li[data-list='bullet']) {
  list-style-type: disc;
}
.rt__editor :deep(li[data-list='ordered']) {
  list-style-type: decimal;
}
.rt__editor :deep(.ql-ui) {
  display: none;
}
.rt__editor :deep(a) {
  color: var(--focus);
}
.rt__editor :deep(.ikey) {
  font-family: var(--font-num);
}
.rt__editor :deep(.ikey.is-closed) {
  text-decoration: line-through;
}
@media (max-width: 760px) {
  .rt__editor {
    font-size: 16px;
  }
}
</style>
