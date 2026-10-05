import { ref } from 'vue';
import type { LocationQuery } from 'vue-router';

export interface Filters {
  projects: string[];
  states: string[];
  assignees: string[];
  authors: string[];
  tags: string[];
  from: string;
  to: string;
}

interface Remembered {
  projects: string[];
  states: string[];
  assignees: string[];
  authors: string[];
  tags: string[];
  period: { from: string; to: string } | null;
}

const KEPT = 'tracker:filters';
const LISTS = ['projects', 'states', 'assignees', 'authors', 'tags'] as const;
const KEYS = [...LISTS, 'from', 'to'];

const listOf = (v: unknown): string[] => (typeof v === 'string' && v ? v.split(',').filter(Boolean) : []);

export const noFilters = (): Filters => ({
  projects: [],
  states: [],
  assignees: [],
  authors: [],
  tags: [],
  from: '',
  to: '',
});

export function monthFilters(): Filters {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const last = new Date(y, now.getMonth() + 1, 0).getDate();
  return { ...noFilters(), from: `${y}-${m}-01`, to: `${y}-${m}-${last}` };
}

function readRemembered(): Remembered {
  const empty: Remembered = { projects: [], states: [], assignees: [], authors: [], tags: [], period: null };
  try {
    const raw = JSON.parse(localStorage.getItem(KEPT) ?? 'null') as Partial<Remembered> | null;
    return raw ? { ...empty, ...raw } : empty;
  } catch {
    return empty;
  }
}

const remembered = ref<Remembered>(readRemembered());

export function remember(f: Filters, base: Filters): void {
  const picked = f.from !== base.from || f.to !== base.to;
  remembered.value = {
    projects: f.projects,
    states: f.states,
    assignees: f.assignees,
    authors: f.authors,
    tags: f.tags,
    period: picked ? { from: f.from, to: f.to } : null,
  };
  try {
    localStorage.setItem(KEPT, JSON.stringify(remembered.value));
  } catch {}
}

function rememberedFilters(base: Filters): Filters {
  const r = remembered.value;
  return {
    projects: [...r.projects],
    states: [...r.states],
    assignees: [...r.assignees],
    authors: [...r.authors],
    tags: [...r.tags],
    from: r.period ? r.period.from : base.from,
    to: r.period ? r.period.to : base.to,
  };
}

export function filtersOf(query: LocationQuery, base: Filters = noFilters()): Filters {
  if (!KEYS.some((key) => query[key] !== undefined)) return rememberedFilters(base);
  return {
    projects: listOf(query.projects),
    states: listOf(query.states),
    assignees: listOf(query.assignees),
    authors: listOf(query.authors),
    tags: listOf(query.tags),
    from: query.from !== undefined ? String(query.from ?? '') : base.from,
    to: query.to !== undefined ? String(query.to ?? '') : base.to,
  };
}

export function filtersQuery(f: Filters, base: Filters = noFilters()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of LISTS) if (f[key].length) out[key] = f[key].join(',');
  if (f.from !== base.from) out.from = f.from;
  if (f.to !== base.to) out.to = f.to;
  return out;
}

export function linkQuery(base: Filters, project?: string | null): Record<string, string> {
  const f = rememberedFilters(base);
  if (project) f.projects = [project];
  return filtersQuery(f, base);
}

export const sameQuery = (a: Record<string, unknown>, b: Record<string, unknown>): boolean =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
