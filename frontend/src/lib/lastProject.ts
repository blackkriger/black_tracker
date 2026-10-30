import { stored } from './storage';

const KEY = 'tracker:last-project';
const BOARD_KEY = 'tracker:last-board:';

export const lastProject = {
  get(): string | null {
    return stored.get(KEY);
  },
  set(shortName: string): void {
    stored.set(KEY, shortName);
  },
};

export const lastBoard = {
  get(shortName: string): string | null {
    return stored.get(BOARD_KEY + shortName);
  },
  set(shortName: string, slug: string): void {
    stored.set(BOARD_KEY + shortName, slug);
  },
};
