import { ref } from 'vue';
import { stored } from './storage';

export type Theme = 'dark' | 'light' | 'system';

const KEY = 'tracker:theme';
const THEMES: Theme[] = ['dark', 'light', 'system'];
const prefersLight = window.matchMedia('(prefers-color-scheme: light)');

function readTheme(): Theme {
  const saved = stored.get(KEY) as Theme | null;
  return saved && THEMES.includes(saved) ? saved : 'system';
}

export const theme = ref<Theme>(readTheme());
export const shownTheme = ref<'dark' | 'light'>('dark');

function applyTheme(): void {
  const light = theme.value === 'light' || (theme.value === 'system' && prefersLight.matches);
  shownTheme.value = light ? 'light' : 'dark';
  document.documentElement.dataset.theme = shownTheme.value;
}

export function setTheme(next: Theme): void {
  theme.value = next;
  stored.set(KEY, next);
  applyTheme();
}

prefersLight.addEventListener('change', applyTheme);
applyTheme();

export const ink = (color: string | null | undefined): string | undefined =>
  color ? `color-mix(in oklab, ${color}, var(--black) var(--ink-shade))` : undefined;
