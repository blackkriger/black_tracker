<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue';
import { FileDown, WrapText, X } from 'lucide-vue-next';
import DOMPurify from 'dompurify';
import { api } from '../lib/api';
import { langOf, setWrapLines, wrapLines as wrapped } from '../lib/files';
import { shownTheme } from '../lib/theme';

const props = defineProps<{ file: { id: string; name: string } | null }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const text = ref('');
const truncated = ref(false);
const loading = ref(false);
const error = ref('');
const marked_ = ref('');
const code = ref('');


const lang = computed(() => (props.file ? langOf(props.file.name) : 'plaintext'));
const isMd = computed(() => lang.value === 'markdown');
const isDrawio = computed(() => lang.value === 'drawio');

// Sandboxed without allow-same-origin so draw.io can't reach the session; its opaque origin forces '*'.
const frame = ref<HTMLIFrameElement | null>(null);
const frameReady = ref(false);
const frameSize = ref<{ width: number; height: number } | null>(null);

function feedFrame(): void {
  if (!isDrawio.value || !frameReady.value || !text.value) return;
  const tokens = getComputedStyle(document.documentElement);
  frame.value?.contentWindow?.postMessage(
    {
      type: 'drawio',
      xml: text.value,
      theme: shownTheme.value,
      background: tokens.getPropertyValue('--surface').trim(),
      highlight: tokens.getPropertyValue('--accent').trim(),
    },
    '*'
  );
}

function onFrameMessage(ev: MessageEvent): void {
  if (ev.source !== frame.value?.contentWindow) return;
  if (ev.data?.type === 'drawio-ready') {
    frameReady.value = true;
    feedFrame();
  } else if (
    ev.data?.type === 'drawio-size' &&
    Number.isFinite(ev.data.width) &&
    Number.isFinite(ev.data.height)
  ) {
    frameSize.value = { width: ev.data.width, height: ev.data.height };
  }
}

window.addEventListener('message', onFrameMessage);
watch([text, shownTheme], feedFrame);
const lines = computed(() => (code.value ? byLines(code.value) : []));

// highlight.js spans can cross newlines, so each line closes its open spans and reopens them next.
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

async function colour(src: string, language: string): Promise<string> {
  const hljs = (await import('highlight.js/lib/common')).default;
  return hljs.getLanguage(language)
    ? hljs.highlight(src, { language }).value
    : hljs.highlightAuto(src).value;
}

async function paint(): Promise<void> {
  if (isDrawio.value) return;
  if (isMd.value) {
    const { marked } = await import('marked');
    const doc = new DOMParser().parseFromString(
      DOMPurify.sanitize(await marked.parse(text.value), {
        ALLOWED_TAGS: [
          'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'blockquote', 'pre', 'code',
          'ul', 'ol', 'li', 'strong', 'em', 'del', 's', 'a', 'img',
          'table', 'thead', 'tbody', 'tr', 'th', 'td',
        ],
        ALLOWED_ATTR: ['href', 'title', 'alt', 'src', 'class', 'align'],
      }),
      'text/html'
    );
    for (const link of doc.querySelectorAll('a[href]')) {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    }
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
  frameReady.value = false;
  frameSize.value = null;
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
    setWrapLines(!wrapped.value);
  }
}

// A text-selecting drag that ends on the backdrop fires a click here; don't close on it.
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
onUnmounted(() => {
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('message', onFrameMessage);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="file" class="iviewer" @click.self="onPage">
      <div class="fv__page" @click.self="onPage">
        <div v-if="loading" class="fv__said">Reading…</div>
        <div v-else-if="error" class="err fv__said">{{ error }}</div>
        <div v-else-if="isMd" class="md fv__md" v-html="marked_"></div>
        <iframe
          v-else-if="isDrawio"
          :key="file.id"
          ref="frame"
          class="fv__drawio"
          :class="{ 'is-sized': frameSize }"
          :style="
            frameSize
              ? { width: `${frameSize.width + 2}px`, height: `${frameSize.height + 2}px` }
              : undefined
          "
          src="/drawio/viewer.html"
          sandbox="allow-scripts"
          title="Diagram"
        ></iframe>
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
            v-if="!isMd && !isDrawio && !loading && !error"
            class="btn btn--sm"
            type="button"
            :aria-pressed="wrapped"
            title="Fold long lines (Alt+Z)"
            @click="setWrapLines(!wrapped)"
          >
            <WrapText class="ic" />
            Wrap
          </button>
          <a class="btn btn--sm" :href="`/api/attachments/${file.id}`" download>
            <FileDown class="ic" />
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
.fv__page {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  /* Margin, not padding: scrolled code would show in the padding beside the sticky line numbers. */
  margin: 24px 24px 0;
  user-select: text;
}
.fv__md,
.fv__said,
.fv__cut {
  max-width: 900px;
  margin: 0 auto;
}
:root[data-theme='light'] .fv__md,
:root[data-theme='light'] .fv__said,
:root[data-theme='light'] .fv__cut {
  padding: 14px 16px;
  border: 1px solid var(--line);
  background: var(--surface);
}
:root[data-theme='light'] .fv__said {
  width: fit-content;
}
/* One scroller only: a nested one would catch middle-click autoscroll and move only sideways. */
.fv__code {
  width: max-content;
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
.fv__code {
  display: grid;
  grid-template-columns: max-content max-content;
  align-content: start;
  padding: 14px 16px;
  border: 1px solid var(--line);
  background: var(--surface);
  font: 12.5px/1.6 var(--font-mono);
}
.fv__num {
  position: sticky;
  left: 0;
  padding-right: 14px;
  border-right: 1px solid var(--line);
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
.fv__code.is-folded {
  max-width: 100%;
  grid-template-columns: max-content minmax(0, max-content);
}
.fv__code.is-folded .fv__src {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.fv__md {
  color: var(--text);
}
.fv__drawio {
  display: block;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  margin: 0 auto;
  border: 1px solid var(--line);
  background: var(--surface);
  visibility: hidden;
}
.fv__drawio.is-sized {
  visibility: visible;
}
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
.fv__md :deep(pre code) {
  padding: 0;
  border: 0;
  background: none;
}
.fv__page :deep(.hljs-keyword),
.fv__page :deep(.hljs-selector-tag),
.fv__page :deep(.hljs-tag),
.fv__page :deep(.hljs-literal),
.fv__page :deep(.hljs-type) {
  color: var(--code-keyword);
}
.fv__page :deep(.hljs-string),
.fv__page :deep(.hljs-addition),
.fv__page :deep(.hljs-regexp) {
  color: var(--code-string);
}
.fv__page :deep(.hljs-number),
.fv__page :deep(.hljs-attr),
.fv__page :deep(.hljs-attribute),
.fv__page :deep(.hljs-property),
.fv__page :deep(.hljs-variable) {
  color: var(--code-number);
}
.fv__page :deep(.hljs-title),
.fv__page :deep(.hljs-section),
.fv__page :deep(.hljs-name),
.fv__page :deep(.hljs-built_in) {
  color: var(--code-title);
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
