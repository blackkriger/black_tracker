import { ref } from 'vue';

export type Layout = 'top' | 'side';

const KEY = 'tracker:layout';

function readLayout(): Layout {
  try {
    return localStorage.getItem(KEY) === 'side' ? 'side' : 'top';
  } catch {
    return 'top';
  }
}

export const layout = ref<Layout>(readLayout());

const narrowQuery = window.matchMedia('(max-width: 900px)');
export const narrow = ref(narrowQuery.matches);
narrowQuery.addEventListener('change', (ev) => (narrow.value = ev.matches));

const smallQuery = window.matchMedia('(max-width: 412px)');
export const small = ref(smallQuery.matches);
smallQuery.addEventListener('change', (ev) => (small.value = ev.matches));

const tinyQuery = window.matchMedia('(max-width: 340px)');
export const tiny = ref(tinyQuery.matches);
tinyQuery.addEventListener('change', (ev) => (tiny.value = ev.matches));

function applyLayout(): void {
  document.documentElement.dataset.layout = layout.value;
}

export function setLayout(next: Layout): void {
  layout.value = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {}
  applyLayout();
}

applyLayout();
