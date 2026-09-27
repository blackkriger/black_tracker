// Making a board is never just a row: a board without columns cannot draw anything, so it comes with the starting four. Both the project and the board routes create boards, hence this sits apart from either.

import type { PoolClient } from 'pg';
import type { Auth } from './auth.js';
import { pool } from './db.js';
import { knownColor } from './colors.js';

// The board's address. A name of nothing but punctuation or Cyrillic slugs to an empty string, so it falls back to a plain word and the counter below keeps it unique inside the project.
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'board';
}

export async function freeSlug(
  client: PoolClient,
  projectId: string,
  name: string,
  exceptBoardId?: string
): Promise<string> {
  const base = slugify(name);
  const taken = await client.query<{ slug: string }>(
    'select slug from boards where project_id = $1 and ($2::uuid is null or id <> $2)',
    [projectId, exceptBoardId ?? null]
  );
  const used = new Set(taken.rows.map((r) => r.slug.toLowerCase()));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

export interface BoardRow {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  default_state_id: string | null;
  position: number;
}

export interface StateRow {
  id: string;
  board_id: string;
  name: string;
  position: number;
  is_open: boolean;
  is_resolved: boolean;
  color: string;
}

// What a new board starts with. Their colours are fixed rather than random: the same four columns should look the same on every board, so "green means done" is learned once.
export const DEFAULT_STATES: { name: string; isOpen: boolean; isResolved: boolean }[] = [
  { name: 'Backlog', isOpen: true, isResolved: false },
  { name: 'In progress', isOpen: true, isResolved: false },
  { name: 'Review', isOpen: true, isResolved: false },
  { name: 'Done', isOpen: false, isResolved: true },
];

export async function createBoardWithDefaults(
  client: PoolClient,
  projectId: string,
  name: string
): Promise<BoardRow> {
  const board = await client.query<BoardRow>(
    `insert into boards (project_id, name, slug, position)
     values ($1, $2, $3, (select coalesce(max(position), -1) + 1 from boards where project_id = $1))
     returning id, project_id, name, slug, default_state_id, position`,
    [projectId, name, await freeSlug(client, projectId, name)]
  );
  const row = board.rows[0];

  const states = await client.query<StateRow>(
    `insert into states (board_id, name, position, is_open, is_resolved, color)
     select $1, s.name, s.pos, s.is_open, s.is_resolved, s.color
       from unnest($2::text[], $3::int[], $4::bool[], $5::bool[], $6::text[])
            as s(name, pos, is_open, is_resolved, color)
     returning *`,
    [
      row.id,
      DEFAULT_STATES.map((s) => s.name),
      DEFAULT_STATES.map((_, i) => i),
      DEFAULT_STATES.map((s) => s.isOpen),
      DEFAULT_STATES.map((s) => s.isResolved),
      DEFAULT_STATES.map((s) => knownColor(s.name) ?? '#71767b'),
    ]
  );

  const first = [...states.rows].sort((a, b) => a.position - b.position)[0];
  const withDefault = await client.query<BoardRow>(
    `update boards set default_state_id = $1 where id = $2
     returning id, project_id, name, slug, default_state_id, position`,
    [first?.id ?? null, row.id]
  );
  return withDefault.rows[0];
}

export interface Denials {
  /** Nothing is open at all — there is no role for access to hang off. */
  everything: boolean;
  projects: Set<string>;
  boards: Set<string>;
}

/** What an admin is held to: nothing. */
export const DENIES_NOTHING: Denials = {
  everything: false,
  projects: new Set(),
  boards: new Set(),
};

// What one role cannot open, both kinds of denial in one read: a whole project, or single boards inside a project it does have. Access is carried by the role, so someone wearing none is shut out of everything until they are given one.
export async function deniedFor(roleId: string | null): Promise<Denials> {
  if (!roleId) return { everything: true, projects: new Set(), boards: new Set() };
  const [projects, boards] = await Promise.all([
    pool.query<{ project_id: string }>('select project_id from project_denials where role_id = $1', [
      roleId,
    ]),
    pool.query<{ board_id: string }>('select board_id from board_denials where role_id = $1', [
      roleId,
    ]),
  ]);
  return {
    everything: false,
    projects: new Set(projects.rows.map((r) => r.project_id)),
    boards: new Set(boards.rows.map((r) => r.board_id)),
  };
}

// Which roles are shut out of which board. Access is a denial list, so a board missing from the answer is open to everyone — including anyone wearing no role at all.
// The question every route about a board asks before it does anything: an admin is held to no denial, and someone with no role is held to all of them.
export async function mayOpenBoard(
  auth: Auth,
  boardId: string,
  projectId: string
): Promise<boolean> {
  if (auth.isAdmin) return true;
  const denied = await deniedFor(auth.roleId);
  return !denied.everything && !denied.boards.has(boardId) && !denied.projects.has(projectId);
}

export async function mayOpenProject(auth: Auth, projectId: string): Promise<boolean> {
  if (auth.isAdmin) return true;
  const denied = await deniedFor(auth.roleId);
  return !denied.everything && !denied.projects.has(projectId);
}

export async function denialsFor(boardIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!boardIds.length) return out;
  const res = await pool.query<{ board_id: string; role_id: string }>(
    'select board_id, role_id from board_denials where board_id = any($1::uuid[])',
    [boardIds]
  );
  for (const row of res.rows) {
    const list = out.get(row.board_id) ?? [];
    list.push(row.role_id);
    out.set(row.board_id, list);
  }
  return out;
}

export const publicState = (r: StateRow) => ({
  id: r.id,
  boardId: r.board_id,
  name: r.name,
  position: r.position,
  isOpen: r.is_open,
  isResolved: r.is_resolved,
  color: r.color,
});

export const publicBoard = (r: BoardRow, states: StateRow[] = [], deniedRoles: string[] = []) => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  slug: r.slug,
  defaultStateId: r.default_state_id,
  position: r.position,
  states: states.map(publicState),
  /** The roles that cannot see it. Settings screens read this; everyone else only ever gets boards they may open. */
  deniedRoles,
});
