import type { Directive } from 'vue';

const pending = new Set<HTMLElement>();
let frame: number | null = null;

function settle(): void {
  frame = null;
  for (const el of pending) {
    const line = parseFloat(getComputedStyle(el).lineHeight);
    el.classList.toggle('is-split', el.getBoundingClientRect().height < line * 1.5);
  }
  pending.clear();
}

const observer = new ResizeObserver((entries) => {
  for (const entry of entries) pending.add(entry.target as HTMLElement);
  if (frame === null) frame = requestAnimationFrame(settle);
});

export const vSplitLine: Directive<HTMLElement> = {
  mounted(el) {
    observer.observe(el);
  },
  unmounted(el) {
    observer.unobserve(el);
    pending.delete(el);
  },
};
