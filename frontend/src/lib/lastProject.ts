// Which project the root should land on. Per-browser, so it is a preference rather than state the server has to keep.
const KEY = 'tracker:last-project';

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
