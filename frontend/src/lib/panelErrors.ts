import { ref } from 'vue';

export function usePanelErrors() {
  const errors = ref<Record<string, string | null>>({});

  return {
    errors,
    fail(key: string, err: unknown, fallback = 'Something went wrong.'): void {
      errors.value = { ...errors.value, [key]: err instanceof Error ? err.message : fallback };
    },
    clear(key: string): void {
      errors.value = { ...errors.value, [key]: null };
    },
  };
}
