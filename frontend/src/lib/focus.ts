import { ref } from 'vue';

const wanted = ref<{ comment: string; at: number } | null>(null);

const FRESH_MS = 5000;

export function useFocus() {
  return {
    wanted,
    ask(comment: string | null): void {
      if (comment) wanted.value = { comment, at: Date.now() };
    },
    pending(): string | null {
      const w = wanted.value;
      return w && Date.now() - w.at < FRESH_MS ? w.comment : null;
    },
  };
}
