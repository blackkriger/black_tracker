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

const KEPT = 'tracker:filter-projects';
const LISTS = ['projects', 'states', 'assignees', 'authors', 'tags'] as const;

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

function keptProjects(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEPT) ?? '[]') as string[];
  } catch {
    return [];
  }
}

export function keepProjects(projects: string[]): void {
  try {
    localStorage.setItem(KEPT, JSON.stringify(projects));
  } catch {}
}

export function filtersOf(query: LocationQuery, base: Filters = noFilters()): Filters {
  return {
    projects: query.projects !== undefined ? listOf(query.projects) : keptProjects(),
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

export const sameQuery = (a: Record<string, unknown>, b: Record<string, unknown>): boolean =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
