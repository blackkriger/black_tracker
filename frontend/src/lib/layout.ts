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
