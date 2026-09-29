<script setup lang="ts">
// The editor behind a description and a comment: Quill with a short toolbar and nothing else — no images (files hang off the issue), no fonts, no colours. It speaks the same v-model contract as a textarea, handing back HTML that is sanitised before it is ever shown again.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { usePeople } from '../lib/people';
import { useRoles } from '../lib/roles';
import Quill from 'quill';
import 'quill/dist/quill.core.css';
import { clean } from '../lib/richtext';
import '../lib/mention-blot';
import { nameAt } from '../lib/mentions';
import {
  Bold,
  ChevronLeft,
  Code,
  Heading3,
  Italic,
  Link,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
} from 'lucide-vue-next';
import { ink } from '../lib/theme';

const body = defineModel<string>({ required: true });
const props = defineProps<{ placeholder?: string; minHeight?: string; disabled?: boolean }>();
const emit = defineEmits<{ (e: 'files', list: FileList): void; (e: 'blur'): void }>();

const { people, load: loadPeople } = usePeople();
const { roles, load: loadRoles } = useRoles();

const wrap = ref<HTMLDivElement | null>(null);
const host = ref<HTMLDivElement | null>(null);
let quill: Quill | null = null;
// Set while the editor itself is the source of a change, so the watcher below does not reset the caret on every keystroke.
let fromEditor = false;

// Quill says when it has the caret and when it has lost it: the box draws nothing for it, but a press outside still has to let the caret go.
const focused = ref(false);
// A file dragged over the text: Quill would try to paste it into the document, so it is caught here and handed to whoever owns the editor.
const overWithFiles = ref(false);

// The same for a screenshot in the clipboard: Quill would inline it as base64, which the
// sanitiser throws away on the way out. Caught before Quill sees it and sent up as a file.
function onPaste(ev: ClipboardEvent): void {
  const files = ev.clipboardData?.files;
  if (!files?.length) return;
  ev.preventDefault();
  ev.stopPropagation();
  emit('files', files);
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
  if (list?.length) emit('files', list);
}

const marks = ref({
  bold: false,
  italic: false,
  strike: false,
  code: false,
  blockquote: false,
  bullet: false,
  ordered: false,
  header: false,
});

function readMarks(): void {
  if (!quill) return;
  const f = quill.getFormat();
  marks.value = {
    bold: !!f.bold,
    italic: !!f.italic,
    strike: !!f.strike,
    code: !!f.code,
    blockquote: !!f.blockquote,
    bullet: f.list === 'bullet',
    ordered: f.list === 'ordered',
    header: f.header === 3,
  };
}

// An `@` and what has been typed after it, while the caret is still on the end of it.
const naming = ref<{ from: number; query: string } | null>(null);
const chosen = ref(0);
const list = ref<HTMLDivElement | null>(null);
const rows = ref<HTMLDivElement | null>(null);
// Where the caret stands in the window, and where the list was put beside it.
const caret = ref({ left: 0, top: 0, bottom: 0 });
const at = ref({ left: 0, top: 0, tip: 12, room: 0, up: false, ready: false });

// A name can be a person or a role: naming a role names everyone wearing it.
interface Named {
  id: string;
  label: string;
  color: string | null;
  hint: string;
}

const matches = computed<Named[]>(() => {
  if (!naming.value) return [];
  const q = naming.value.query.toLowerCase();
  // Only the roles are coloured here: a colour on a person would be their role's, said twice.
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

// Where the caret is in the window. Quill measures it against the editor, which scrolls
// inside a window that scrolls too, so the answer only holds for the moment it is asked.
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

// The list hangs in the window rather than in the editor, which clips it: it is held
// inside the dialog around it, turned upwards when the room below runs out, and given
// only the height that is left, so it never reaches past the frame it belongs to.
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
  // The rows scroll, the box around them does not: what is left over is theirs to have.
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
    // Scrolled out of its own dialog, or with no room left to stand in: nothing to show.
    ready: room > 32 && caret.value.top < wallB && caret.value.bottom > wallT,
  };
}

function lookForName(): void {
  if (!quill) return;
  const sel = quill.getSelection();
  if (!sel || sel.length) {
    naming.value = null;
    return;
  }
  const back = Math.min(40, sel.index);
  const before = quill.getText(sel.index - back, back);
  // A name starts a word: an e-mail address in the middle of one is not a mention.
  const found = /(?:^|\s)@([a-zA-Z0-9_.-]*)$/.exec(before);
  if (!found) {
    naming.value = null;
    at.value = { ...at.value, ready: false };
    return;
  }
  naming.value = { from: sel.index - found[1].length - 1, query: found[1] };
  chosen.value = 0;
  measure();
  void nextTick(place);
}

// Anything that moves the editor moves the caret with it, and the list has to follow.
function follow(): void {
  if (!naming.value) return;
  measure();
  place();
}

// The names in the box, coloured where they stand. The format is applied silently, so it
// never reaches the model — what is stored is the plain text, painted again when read.
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

// The lists arrive after the page does, and a draft put back before they land would stay
// colourless: the names are only recognisable once there is something to recognise them by.
watch([people, roles], () => paintNames());

function pickName(login: string): void {
  if (!quill || !naming.value) return;
  const { from, query } = naming.value;
  naming.value = null;
  quill.deleteText(from, query.length + 1, 'user');
  quill.insertText(from, `@${login} `, 'user');
  quill.setSelection(from + login.length + 2, 0, 'silent');
}

// The list answers the keys first: Quill would otherwise break the line on Enter, and the
// window above would close on Escape.
function onNameKey(ev: KeyboardEvent): void {
  if (!naming.value || !matches.value.length) return;
  const stop = () => {
    ev.preventDefault();
    ev.stopPropagation();
  };
  if (ev.key === 'ArrowDown') {
    chosen.value = (chosen.value + 1) % matches.value.length;
    stop();
  } else if (ev.key === 'ArrowUp') {
    chosen.value = (chosen.value - 1 + matches.value.length) % matches.value.length;
    stop();
  } else if (ev.key === 'Enter' || ev.key === 'Tab') {
    pickName(matches.value[chosen.value].label);
    stop();
  } else if (ev.key === 'Escape') {
    naming.value = null;
    stop();
  }
}

onMounted(() => {
  void loadPeople();
  void loadRoles();
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
      'mention',
    ],
  });
  if (body.value) {
    quill.clipboard.dangerouslyPasteHTML(clean(body.value), 'silent');
    setTimeout(paintNames, 0);
  }
  quill.on('text-change', () => {
    fromEditor = true;
    body.value = clean(quill?.root.innerHTML ?? '');
    readMarks();
    // Quill has not moved its caret yet when it says the text changed, so the list would
    // otherwise be a keystroke behind and an `@` on its own would show nothing.
    setTimeout(() => {
      lookForName();
      paintNames();
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

// Clicking empty space in a dialog leaves a contenteditable focused — the browser has nothing there to put a caret in, so it keeps the one it has. A press anywhere outside this editor lets it go.
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

// Shut while what was written is being sent: anything typed after that would be thrown away without saying so.
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
  setTimeout(paintNames, 0);
});

function toggle(format: string, value: unknown = true): void {
  if (!quill) return;
  const has = quill.getFormat()[format];
  quill.format(format, has === value ? false : value, 'user');
  quill.focus();
  readMarks();
}

defineExpose({
  /** `atEnd` puts the caret after everything already written, which is where a reply carries on. */
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
  const url = window.prompt('Link to');
  if (url === null) return;
  quill.format('link', url.trim() || false, 'user');
  readMarks();
}
</script>

<template>
  <div ref="wrap" class="rt" :class="{ 'is-off': disabled }">
    <div class="mdbar">
      <button type="button" :aria-pressed="marks.bold" title="Bold" @click="toggle('bold')"><Bold class="ic" /></button>
      <button type="button" :aria-pressed="marks.italic" title="Italic" @click="toggle('italic')"><Italic class="ic" /></button>
      <button type="button" :aria-pressed="marks.strike" title="Strikethrough" @click="toggle('strike')"><Strikethrough class="ic" /></button>
      <button type="button" :aria-pressed="marks.code" title="Code" @click="toggle('code')"><Code class="ic" /></button>
      <button type="button" :aria-pressed="marks.header" title="Heading" @click="toggle('header', 3)"><Heading3 class="ic" /></button>
      <button type="button" :aria-pressed="marks.bullet" title="Bulleted list" @click="toggle('list', 'bullet')"><List class="ic" /></button>
      <button type="button" :aria-pressed="marks.ordered" title="Numbered list" @click="toggle('list', 'ordered')"><ListOrdered class="ic" /></button>
      <button type="button" :aria-pressed="marks.blockquote" title="Quote" @click="toggle('blockquote')"><Quote class="ic" /></button>
      <button type="button" title="Link" @click="addLink"><Link class="ic" /></button>
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
          @mousedown.prevent="pickName(n.label)"
        >
          <span :style="{ color: ink(n.color) }">{{ n.label }}</span>
          <span v-if="n.hint" class="rt__full">{{ n.hint }}</span>
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
/* The list of names stands where the caret is, in the window: the editor clips whatever
   hangs out of it, and the caret it belongs to is at the foot of the frame as often as not. */
.rt__names {
  position: fixed;
  z-index: 40;
  min-width: 180px;
  visibility: hidden;
}
/* Only the names scroll: the box keeps its pointer, which hangs outside it. */
.rt__rows {
  overflow-y: auto;
}
.rt__names.is-up {
  transform: translateY(-100%);
}
/* Measured before it is seen: until then it would stand wherever it last stood. */
.rt__names.is-set {
  visibility: visible;
}
/* The pointer every popup here has, drawn twice: the border's triangle, then the surface's one pixel lower to cover the line under it. It stands under the `@` it was opened by, wherever the list itself had to be pushed to stay inside. */
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
/* The one in hand is pointed at rather than painted: every name keeps its own colour. */
.rt__at {
  margin-left: auto;
  color: var(--text);
}
.rt__at.is-off {
  visibility: hidden;
}
/* Nothing in here answers while it is off — the toolbar, the text and whatever the owner put in the toolbar alike. */
.rt.is-off {
  pointer-events: none;
  opacity: 0.6;
}
/* The box is the frame; the editable part fills it, so a click anywhere inside lands in the text and not on a dead margin. */
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
}
.rt__editor :deep(ol),
.rt__editor :deep(ul) {
  margin: 0 0 8px;
  padding-left: 22px;
}
/* Quill's own bullet lives in a span it draws; the marker is ours to set. */
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
</style>
