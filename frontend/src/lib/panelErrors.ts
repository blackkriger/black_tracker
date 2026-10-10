import { ref } from 'vue';
import { i18n } from '../i18n';

export function usePanelErrors() {
  const errors = ref<Record<string, string | null>>({});

  return {
    errors,
    fail(key: string, err: unknown, fallback = i18n.global.t('common.wentWrong')): void {
      errors.value = { ...errors.value, [key]: err instanceof Error ? err.message : fallback };
    },
    clear(key: string): void {
      errors.value = { ...errors.value, [key]: null };
    },
  };
}
