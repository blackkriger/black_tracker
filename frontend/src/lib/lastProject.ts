// Which project the root should land on, and which board that project should open on. Per-browser, so they are preferences rather than state the server has to keep.
const KEY = 'tracker:last-project';
const BOARD_KEY = 'tracker:last-board:';

export const lastProject = {
  get(): string | null {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set(shortName: string): void {
    try {
      localStorage.setItem(KEY, shortName);
    } catch {
      /* private mode, or storage is full — the root just falls back to the first project */
    }
  },
};

// One remembered board per project: opening `/p/PROJ` returns you to the board you were last on there.
export const lastBoard = {
  get(shortName: string): string | null {
    try {
      return localStorage.getItem(BOARD_KEY + shortName);
    } catch {
      return null;
    }
  },
  set(shortName: string, slug: string): void {
    try {
      localStorage.setItem(BOARD_KEY + shortName, slug);
    } catch {
      /* falls back to the project's first board */
    }
  },
};
