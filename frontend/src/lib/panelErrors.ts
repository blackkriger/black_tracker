// An error belongs under the thing that caused it. A screen made of panels keeps one message per panel rather than a single line at the top, where it says nothing about which field was wrong.
import { ref } from 'vue';

export function usePanelErrors() {
  const errors = ref<Record<string, string | null>>({});

  return {
    errors,
    /** Puts the API's own message under `key`, or a plain fallback when the failure carries none. */
    fail(key: string, err: unknown, fallback = 'Something went wrong.'): void {
      errors.value = { ...errors.value, [key]: err instanceof Error ? err.message : fallback };
    },
    clear(key: string): void {
      errors.value = { ...errors.value, [key]: null };
    },
  };
}
