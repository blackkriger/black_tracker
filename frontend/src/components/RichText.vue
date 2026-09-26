<script setup lang="ts">
// The editor behind a description and a comment: Quill with a short toolbar and nothing else — no images (files hang off the issue), no fonts, no colours. It speaks the same v-model contract as a textarea, handing back HTML that is sanitised before it is ever shown again.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Quill from 'quill';
import 'quill/dist/quill.core.css';
import { clean } from '../lib/richtext';
import { Bold, Code, Heading3, Italic, Link, List, ListOrdered, Quote, Strikethrough } from 'lucide-vue-next';

const body = defineModel<string>({ required: true });
const props = defineProps<{ placeholder?: string; minHeight?: string }>();
const emit = defineEmits<{ (e: 'files', list: FileList): void }>();

const wrap = ref<HTMLDivElement | null>(null);
const host = ref<HTMLDivElement | null>(null);
let quill: Quill | null = null;
// Set while the editor itself is the source of a change, so the watcher below does not reset the caret on every keystroke.
let fromEditor = false;

// Quill says when it has the caret and when it has lost it; :focus-within would keep the ring after a click that focuses nothing.
const focused = ref(false);
// A file dragged over the text: Quill would try to paste it into the document, so it is caught here and handed to whoever owns the editor.
const overWithFiles = ref(false);

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

onMounted(() => {
  if (!host.value) return;
  quill = new Quill(host.value, {
    theme: undefined,
    placeholder: props.placeholder,
    formats: ['bold', 'italic', 'strike', 'code', 'code-block', 'blockquote', 'list', 'header', 'link'],
  });
  if (body.value) quill.clipboard.dangerouslyPasteHTML(clean(body.value), 'silent');
  quill.on('text-change', () => {
    fromEditor = true;
    body.value = clean(quill?.root.innerHTML ?? '');
    readMarks();
  });
  quill.on('selection-change', readMarks);
  quill.root.addEventListener('focus', () => (focused.value = true));
  quill.root.addEventListener('blur', () => (focused.value = false));
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
  quill = null;
});

watch(body, (next) => {
  if (fromEditor) {
    fromEditor = false;
    return;
  }
  if (!quill || clean(quill.root.innerHTML) === next) return;
  quill.clipboard.dangerouslyPasteHTML(clean(next ?? ''), 'silent');
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
  <div ref="wrap" class="rt">
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
      :class="{ 'is-focus': focused, 'is-drop': overWithFiles }"
      :style="{ minHeight: minHeight ?? '120px' }"
      @dragover="onDragOver"
      @dragleave="overWithFiles = false"
      @drop.capture="onDrop"
    ></div>
  </div>
</template>

<style scoped>
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
.rt__editor.is-focus {
  border-color: var(--focus);
  box-shadow: 0 0 0 1px var(--focus);
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
.rt__editor :deep(a) {
  color: var(--focus);
}
</style>
