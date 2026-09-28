<script setup lang="ts">
// A file read where it hangs. Markdown is drawn the way a comment is; everything else is
// shown as code with its lines numbered. The text arrives as data and is put on the page by
// us, so nothing the file carries is ever parsed as a document on our own origin.
import { computed, ref, watch, onUnmounted } from 'vue';
import { Download, WrapText, X } from 'lucide-vue-next';
import DOMPurify from 'dompurify';
import { api } from '../lib/api';
import { langOf } from '../lib/files';

const props = defineProps<{ file: { id: string; name: string } | null }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const text = ref('');
const truncated = ref(false);
const loading = ref(false);
const error = ref('');
const marked_ = ref('');
const code = ref('');

// Long lines run off the side until they are told to fold, the way Alt+Z folds them in an
// editor. Whoever asks for it keeps it for every file they open after this one.
const wrapped = ref(false);

const lang = computed(() => (props.file ? langOf(props.file.name) : 'plaintext'));
const isMd = computed(() => lang.value === 'markdown');
const lines = computed(() => (code.value ? byLines(code.value) : []));

// The highlighter paints the file in one pass and a span may run over several lines, so the
// markup is cut line by line with whatever was left open reopened on the next one. A line
// has to be its own row for its number to stay beside it once the line folds.
function byLines(html: string): string[] {
  const out: string[] = [];
  const open: string[] = [];
  let line = '';
  for (const piece of html.match(/<span [^>]*>|<\/span>|\n|[^<\n]+|</g) ?? []) {
    if (piece === '\n') {
      out.push(line + '</span>'.repeat(open.length));
      line = open.join('');
    } else if (piece === '</span>') {
      open.pop();
      line += piece;
    } else if (piece.startsWith('<span')) {
      open.push(piece);
      line += piece;
    } else {
      line += piece;
    }
  }
  out.push(line + '</span>'.repeat(open.length));
  return out;
}

// Neither the parser nor the highlighter is worth its weight until a file is opened, so
// both are fetched at that point rather than riding in the bundle.
async function colour(src: string, language: string): Promise<string> {
  const hljs = (await import('highlight.js/lib/common')).default;
  return hljs.getLanguage(language)
    ? hljs.highlight(src, { language }).value
    : hljs.highlightAuto(src).value;
}

async function paint(): Promise<void> {
  if (isMd.value) {
    const { marked } = await import('marked');
    const doc = new DOMParser().parseFromString(
      DOMPurify.sanitize(await marked.parse(text.value)),
      'text/html'
    );
    // A fenced block is code like any other. The highlighter is handed the block's text,
    // never its markup, so what it gives back is spans around what was already there.
    for (const block of doc.querySelectorAll('pre code')) {
      const named = [...block.classList].find((c) => c.startsWith('language-'));
      block.innerHTML = await colour(block.textContent ?? '', named?.slice(9) ?? '');
    }
    marked_.value = doc.body.innerHTML;
    code.value = '';
    return;
  }
  marked_.value = '';
  code.value = await colour(text.value, lang.value);
}

async function read(): Promise<void> {
  const file = props.file;
  if (!file) return;
  loading.value = true;
  error.value = '';
  text.value = '';
  marked_.value = '';
  code.value = '';
  try {
    const got = await api<{ text: string; truncated: boolean }>(`/attachments/${file.id}/text`);
    if (props.file?.id !== file.id) return;
    text.value = got.text;
    truncated.value = got.truncated;
    await paint();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not read this file.';
  } finally {
    loading.value = false;
  }
}

function onKey(ev: KeyboardEvent): void {
  if (!props.file) return;
  if (ev.key === 'Escape') {
    ev.stopPropagation();
    emit('close');
  } else if (ev.altKey && (ev.key === 'z' || ev.key === 'Z' || ev.code === 'KeyZ')) {
    ev.preventDefault();
    wrapped.value = !wrapped.value;
  }
}

// The empty page around the file closes it, as the dark around a picture does — unless
// something is selected, which is what a drag that ended out here was for.
function onPage(): void {
  if (window.getSelection()?.isCollapsed === false) return;
  emit('close');
}

watch(
  () => props.file?.id,
  (id) => {
    if (id) {
      void read();
      window.addEventListener('keydown', onKey, true);
    } else {
      window.removeEventListener('keydown', onKey, true);
    }
  }
);
onUnmounted(() => window.removeEventListener('keydown', onKey, true));
</script>

<template>
  <Teleport to="body">
    <div v-if="file" class="iviewer">
      <div class="fv__page" @click.self="onPage">
        <div v-if="loading" class="fv__said">Reading…</div>
        <div v-else-if="error" class="err fv__said">{{ error }}</div>
        <div v-else-if="isMd" class="md fv__md" v-html="marked_"></div>
        <div v-else class="fv__code" :class="{ 'is-folded': wrapped }">
          <template v-for="(line, i) in lines" :key="i">
            <span class="fv__num" aria-hidden="true">{{ i + 1 }}</span>
            <code class="fv__src" v-html="line"></code>
          </template>
        </div>
        <div v-if="truncated && !loading && !error" class="fv__cut">
          Only the first 512 KB are shown. Download the file to read the rest.
        </div>
      </div>

      <div class="iviewer__bar">
        <span class="iviewer__name">{{ file.name }}</span>
        <div class="iviewer__nav">
          <button
            v-if="!isMd && !loading && !error"
            class="btn btn--sm"
            type="button"
            :aria-pressed="wrapped"
            title="Fold long lines (Alt+Z)"
            @click="wrapped = !wrapped"
          >
            <WrapText class="ic" />
            Wrap
          </button>
          <a class="btn btn--sm" :href="`/api/attachments/${file.id}`" download>
            <Download class="ic" />
            Download
          </a>
        </div>
        <button class="btn btn--sm iviewer__close" type="button" aria-label="Close" @click="emit('close')">
          <X class="ic" />
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* The page the file is read on: one column the width of a book, the whole screen to scroll. */
.fv__page {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 24px;
  user-select: text;
}
.fv__md,
.fv__said,
.fv__cut {
  max-width: 900px;
  margin: 0 auto;
}
/* A document keeps a book's width; code is as wide as its longest line lets it be, and
   only scrolls sideways once that is wider than the screen. */
.fv__code {
  width: max-content;
  max-width: 100%;
  margin: 0 auto;
}
.fv__said {
  color: var(--text-dim);
}
.fv__cut {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  color: var(--text-muted);
  font-size: 12px;
}
/* One row per line, so a number stays beside its line even after the line folds. The
   numbers ride in their own column and stay put when the code is scrolled sideways. */
.fv__code {
  display: grid;
  grid-template-columns: max-content max-content;
  align-content: start;
  padding: 14px 16px;
  border: 1px solid var(--line);
  background: var(--surface);
  overflow-x: auto;
  font: 12.5px/1.6 var(--font-mono);
}
.fv__num {
  position: sticky;
  left: 0;
  padding-right: 14px;
  border-right: 1px solid var(--line);
  /* The strip between the rule and the code is covered too, so nothing slides out under it. */
  box-shadow: 14px 0 0 var(--surface);
  background: var(--surface);
  color: var(--text-faint);
  text-align: right;
  user-select: none;
}
.fv__src {
  padding-left: 14px;
  color: var(--text);
  white-space: pre;
}
/* Folded, the file is as wide as the screen and nothing runs off the side of it. */
.fv__code.is-folded {
  width: 100%;
  grid-template-columns: max-content minmax(0, 1fr);
}
.fv__code.is-folded .fv__src {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.fv__md {
  color: var(--text);
}
/* A document carries more than a comment ever does: .md draws the rest, these are the parts
   Quill has no button for. */
.fv__md :deep(h1),
.fv__md :deep(h2) {
  margin: 18px 0 8px;
  font: 600 20px var(--font-ui);
}
.fv__md :deep(h1) {
  padding-bottom: 6px;
  border-bottom: 1px solid var(--line);
}
.fv__md :deep(h2) {
  font-size: 17px;
}
.fv__md :deep(li) {
  margin: 2px 0;
}
.fv__md :deep(table) {
  margin: 0 0 10px;
  border-collapse: collapse;
}
.fv__md :deep(th),
.fv__md :deep(td) {
  padding: 4px 10px;
  border: 1px solid var(--line);
  text-align: left;
}
.fv__md :deep(th) {
  background: var(--surface);
}
.fv__md :deep(hr) {
  margin: 14px 0;
  border: 0;
  border-top: 1px solid var(--line);
}
.fv__md :deep(img) {
  max-width: 100%;
}
/* A fenced block is a `pre` around a `code`, and only the outer one is the box. */
.fv__md :deep(pre code) {
  padding: 0;
  border: 0;
  background: none;
}
/* Code wears the same hues the boards do — in the column of a code file and in a fenced
   block inside a document alike: the four starting statuses, and a comment in grey. */
.fv__page :deep(.hljs-keyword),
.fv__page :deep(.hljs-selector-tag),
.fv__page :deep(.hljs-tag),
.fv__page :deep(.hljs-literal),
.fv__page :deep(.hljs-type) {
  color: #c98eff;
}
.fv__page :deep(.hljs-string),
.fv__page :deep(.hljs-addition),
.fv__page :deep(.hljs-regexp) {
  color: #8effa9;
}
.fv__page :deep(.hljs-number),
.fv__page :deep(.hljs-attr),
.fv__page :deep(.hljs-attribute),
.fv__page :deep(.hljs-property),
.fv__page :deep(.hljs-variable) {
  color: #6cdcff;
}
.fv__page :deep(.hljs-title),
.fv__page :deep(.hljs-section),
.fv__page :deep(.hljs-name),
.fv__page :deep(.hljs-built_in) {
  color: var(--accent);
}
.fv__page :deep(.hljs-comment),
.fv__page :deep(.hljs-quote),
.fv__page :deep(.hljs-meta) {
  color: var(--text-muted);
}
.fv__page :deep(.hljs-deletion) {
  color: var(--danger-text);
}
</style>
