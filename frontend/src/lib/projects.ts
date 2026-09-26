// The project list is read once per page load and shared: the top bar needs it on every screen, and it changes only when an admin touches it.
import { ref } from 'vue';
import { api } from './api';

export interface ProjectMini {
  id: string;
  shortName: string;
  name: string;
  archived: boolean;
  boardCount: number;
}

const projects = ref<ProjectMini[]>([]);
const loaded = ref(false);
let inflight: Promise<void> | null = null;

export function useProjects() {
  return {
    projects,
    loaded,
    async load(force = false): Promise<void> {
      if (loaded.value && !force) return;
      // Several screens mount at once on a cold load; they all wait on the same request rather than firing their own.
      inflight ??= api<ProjectMini[]>('/projects')
        .then((rows) => {
          projects.value = rows;
          loaded.value = true;
        })
        .catch(() => {
          /* the screen that needs projects reports its own failure */
        })
        .finally(() => {
          inflight = null;
        });
      await inflight;
    },
  };
}
