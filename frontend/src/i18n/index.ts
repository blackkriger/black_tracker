import { computed } from 'vue';
import { createI18n } from 'vue-i18n';
import en from './en';
import ru from './ru';
import { stored } from '../lib/storage';

export type Locale = 'en' | 'ru';
export type LangChoice = 'system' | Locale;

const KEY = 'tracker:lang';

export function browserLocale(): Locale {
  const first = navigator.languages?.[0] ?? navigator.language ?? '';
  return /^ru\b/i.test(first) ? 'ru' : 'en';
}

function remembered(): Locale {
  const saved = stored.get(KEY);
  if (saved === 'en' || saved === 'ru') return saved;
  return browserLocale();
}

function russianPlural(choice: number, choices: number): number {
  if (choices < 3) return choice === 1 ? 0 : 1;
  const tens = Math.abs(choice) % 100;
  const ones = tens % 10;
  if (tens > 10 && tens < 20) return 2;
  if (ones === 1) return 0;
  if (ones >= 2 && ones <= 4) return 1;
  return 2;
}

export const i18n = createI18n({
  legacy: false,
  locale: remembered(),
  fallbackLocale: 'en',
  messages: { en, ru },
  pluralRules: { ru: russianPlural },
});

export const locale = computed(() => i18n.global.locale.value as Locale);

export function applyLocale(next: Locale): void {
  i18n.global.locale.value = next;
  document.documentElement.lang = next;
  stored.set(KEY, next);
}

document.documentElement.lang = i18n.global.locale.value;
