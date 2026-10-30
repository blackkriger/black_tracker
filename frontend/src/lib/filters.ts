import { ref, watch } from 'vue';
import { useRoute, useRouter, type LocationQuery } from 'vue-router';
import { stored } from './storage';

export interface Filters {
  projects: string[];
  states: string[];
  assignees: string[];
  authors: string[];
  watchers: string[];
  tags: string[];
  from: string;
  to: string;
}

interface Remembered {
  projects: string[];
  states: string[];
  assignees: string[];
  authors: string[];
  watchers: string[];
  tags: string[];
  period: { from: string; to: string } | null;
}

const KEPT = 'tracker:filters';
const LISTS = ['projects', 'states', 'assignees', 'authors', 'watchers', 'tags'] as const;
const KEYS = [...LISTS, 'from', 'to'];

const listOf = (v: unknown): string[] => (typeof v === 'string' && v ? v.split(',').filter(Boolean) : []);

export const noFilters = (): Filters => ({
  projects: [],
  states: [],
  assignees: [],
  authors: [],
  watchers: [],
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
  const empty: Remembered = {
    projects: [],
    states: [],
    assignees: [],
    authors: [],
    watchers: [],
    tags: [],
    period: null,
  };
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
    watchers: f.watchers,
    tags: f.tags,
    period: picked ? { from: f.from, to: f.to } : null,
  };
  stored.set(KEPT, JSON.stringify(remembered.value));
}

export function rememberedFilters(base: Filters): Filters {
  const r = remembered.value;
  return {
    projects: [...r.projects],
    states: [...r.states],
    assignees: [...r.assignees],
    authors: [...r.authors],
    watchers: [...r.watchers],
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
    watchers: listOf(query.watchers),
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

export const COMMIT_FILTERS: readonly string[] = ['projects', 'tags', 'from', 'to'];

export const commitQuery = (query: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(query).filter(([key]) => COMMIT_FILTERS.includes(key)));

export const sameQuery = (a: Record<string, unknown>, b: Record<string, unknown>): boolean =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

export function useQuerySync(name: string, toQuery: () => Record<string, string>, fromQuery: () => void): () => void {
  const route = useRoute();
  const router = useRouter();
  watch(
    () => route.query,
    () => {
      if (route.name !== name) return;
      if (!sameQuery(toQuery(), route.query as Record<string, unknown>)) fromQuery();
    }
  );
  return () => {
    const next = toQuery();
    if (!sameQuery(next, route.query as Record<string, unknown>)) {
      void router.replace({ name, params: route.params, query: next });
    }
  };
}
