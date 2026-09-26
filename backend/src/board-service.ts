// Making a board is never just a row: a board without columns cannot draw anything, so it comes with the starting four. Both the project and the board routes create boards, hence this sits apart from either.

import type { PoolClient } from 'pg';
import { knownColor } from './colors.js';

export interface BoardRow {
  id: string;
  project_id: string;
  name: string;
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
    `insert into boards (project_id, name, position)
     values ($1, $2, (select coalesce(max(position), -1) + 1 from boards where project_id = $1))
     returning id, project_id, name, default_state_id, position`,
    [projectId, name]
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
     returning id, project_id, name, default_state_id, position`,
    [first?.id ?? null, row.id]
  );
  return withDefault.rows[0];
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

export const publicBoard = (
  r: BoardRow,
  states: StateRow[] = [],
  deniedTo: string[] = [],
  issues = 0
) => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  defaultStateId: r.default_state_id,
  position: r.position,
  issues,
  states: states.map(publicState),
  /** Who cannot see it. Settings screens read this; everyone else only ever gets boards they may open. */
  deniedTo,
});
