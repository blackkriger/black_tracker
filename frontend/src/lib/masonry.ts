// Packing blocks that each keep their own size. A picture is shown as large as it is, so the blocks differ in width as well as height, and neither CSS grid nor flex can lay that out without holes: grid forces equal columns, flex leaves the rest of a row empty under a short block.
//
// So the wall is packed by hand, the way a shelf is stacked: the container is measured, every block keeps its natural size, and each one is put at the lowest free place it fits — sliding along the top edge of what is already there. Blocks are absolutely placed, which is what lets the next one start under a short neighbour instead of after the tallest in its row.
import { onBeforeUnmount, watch, type Ref } from 'vue';

const GAP = 8;
/** The top edge is sampled every few pixels; finer than a block ever needs and cheap to scan. */
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
  // How far down the wall is filled at each sampled x.
  const top = new Array<number>(slots).fill(0);

  let bottom = 0;
  for (const item of items) {
    const box = item.getBoundingClientRect();
    const w = Math.min(Math.ceil(box.width), width);
    const h = Math.ceil(box.height);
    const span = Math.max(Math.ceil(w / STEP), 1);

    // The lowest place it fits, and the leftmost of those.
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
    for (let i = bestAt; i < Math.min(bestAt + span, slots); i++) top[i] = bestY + h + GAP;
    bottom = Math.max(bottom, bestY + h);
  }

  root.style.height = `${bottom}px`;
}

/** Keeps one wall packed: on its own resize, on any block's, and whenever what is in it changes. Pictures arrive after their block does, so `repack()` is also called from each image's load. */
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
