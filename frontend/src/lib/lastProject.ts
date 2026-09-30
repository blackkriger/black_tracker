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
    } catch {}
  },
};

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
    } catch {}
  },
};
