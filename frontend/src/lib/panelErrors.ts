import { ref } from 'vue';
import { i18n } from '../i18n';

export const messageOf = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

export function usePanelErrors() {
  const errors = ref<Record<string, string | null>>({});

  function fail(key: string, err: unknown, fallback = i18n.global.t('common.wentWrong')): void {
    errors.value = { ...errors.value, [key]: messageOf(err, fallback) };
  }

  function clear(key: string): void {
    errors.value = { ...errors.value, [key]: null };
  }

  return {
    errors,
    fail,
    clear,
    async attempt<T>(key: string, run: () => Promise<T>, fallback?: string): Promise<T | undefined> {
      clear(key);
      try {
        return await run();
      } catch (err) {
        fail(key, err, fallback);
        return undefined;
      }
    },
  };
}
