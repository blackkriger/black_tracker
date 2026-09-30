import { onBeforeUnmount, watch, type Ref } from 'vue';

const GAP = 8;
const STEP = 4;

export function packWall(root: HTMLElement | null): void {
  if (!root) return;
  const items = Array.from(root.children) as HTMLElement[];
  if (!items.length) {
    root.style.height = '';
    return;
  }

  const width = Math.max(Math.floor(root.clientWidth), 1);
  const slots = Math.ceil(width / STEP);
  const top = new Array<number>(slots).fill(0);

  let bottom = 0;
  for (const item of items) {
    const box = item.getBoundingClientRect();
    const w = Math.min(Math.ceil(box.width), width);
    const h = Math.ceil(box.height);
    const span = Math.max(Math.ceil(w / STEP), 1);

    let bestAt = 0;
    let bestY = Infinity;
    for (let at = 0; at + span <= slots; at++) {
      let y = 0;
      for (let i = at; i < at + span; i++) if (top[i] > y) y = top[i];
      if (y < bestY) {
        bestY = y;
        bestAt = at;
        if (y === 0) break;
      }
    }
    if (!Number.isFinite(bestY)) bestY = 0;

    const x = Math.min(bestAt * STEP, Math.max(width - w, 0));
    item.style.transform = `translate(${x}px, ${bestY}px)`;
    const reach = Math.ceil((w + GAP) / STEP);
    for (let i = bestAt; i < Math.min(bestAt + reach, slots); i++) top[i] = bestY + h + GAP;
    bottom = Math.max(bottom, bestY + h);
  }

  root.style.height = `${bottom}px`;
}

export function useWall(root: Ref<HTMLElement | null>, source: () => unknown) {
  let observer: ResizeObserver | null = null;
  let frame: number | null = null;

  function repack(): void {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      packWall(root.value);
    });
  }

  function observe(): void {
    observer?.disconnect();
    if (!root.value) return;
    observer = new ResizeObserver(repack);
    observer.observe(root.value);
    for (const child of Array.from(root.value.children)) observer.observe(child);
    repack();
  }

  watch([root, source], () => requestAnimationFrame(observe), { flush: 'post' });

  onBeforeUnmount(() => {
    observer?.disconnect();
    if (frame !== null) cancelAnimationFrame(frame);
  });

  return { repack };
}
