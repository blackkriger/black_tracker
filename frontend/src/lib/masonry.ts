// Masonry packing, carried over from the Crons tab in another project. CSS cannot do it on its own — `grid-template-rows: masonry` is still behind a flag — so the grid is given one-pixel rows and each block is measured and placed by hand: the column that is currently shortest gets the next block, and it spans as many rows as it is tall. Blocks keep their own heights and nothing is left empty under a short one.
import { onBeforeUnmount, watch, type Ref } from 'vue';

const GAP = 8;

export function packMasonry(root: HTMLElement | null): void {
  if (!root) return;
  const items = Array.from(root.children) as HTMLElement[];
  if (!items.length) return;

  // Cleared first, or every measurement would be the span we gave it last time.
  for (const el of items) {
    el.style.gridColumn = '';
    el.style.gridRow = '';
  }
  const columns = getComputedStyle(root).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
  const heights = items.map((el) => Math.ceil(el.getBoundingClientRect().height));
  const ends = new Array<number>(columns).fill(0);

  items.forEach((el, i) => {
    const col = ends.indexOf(Math.min(...ends));
    const height = Math.max(heights[i], 1);
    const start = ends[col] === 0 ? 1 : ends[col] + GAP + 1;
    el.style.gridColumn = String(col + 1);
    el.style.gridRow = `${start} / span ${height}`;
    ends[col] = start + height - 1;
  });
}

/** Keeps one grid packed: on its own resize, on any block's, and whenever what is in it changes. Pictures arrive after their block does, so `repack()` is also called from each image's load. */
export function useMasonry(root: Ref<HTMLElement | null>, source: () => unknown) {
  let observer: ResizeObserver | null = null;
  let frame: number | null = null;

  function repack(): void {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      packMasonry(root.value);
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
