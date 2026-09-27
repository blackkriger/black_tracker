// "Look at this comment." The address alone cannot say it twice — clicking the same notice
// again is the same address, and nothing changes — so the asking is kept here instead, as a
// fresh object every time.
import { ref } from 'vue';

const wanted = ref<{ comment: string; at: number } | null>(null);

/** How long an unanswered ask still counts, so a window opening now can pick it up. */
const FRESH_MS = 5000;

export function useFocus() {
  return {
    wanted,
    ask(comment: string | null): void {
      if (comment) wanted.value = { comment, at: Date.now() };
    },
    /** The comment a window opening right now was meant to land on. */
    pending(): string | null {
      const w = wanted.value;
      return w && Date.now() - w.at < FRESH_MS ? w.comment : null;
    },
  };
}
