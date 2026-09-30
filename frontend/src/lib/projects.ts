import { ref } from 'vue';
import { api } from './api';

export interface ProjectMini {
  id: string;
  shortName: string;
  name: string;
  archived: boolean;
  boards: { id: string; name: string; slug: string }[];
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
      inflight ??= api<ProjectMini[]>('/projects')
        .then((rows) => {
          projects.value = rows;
          loaded.value = true;
        })
        .catch(() => {})
        .finally(() => {
          inflight = null;
        });
      await inflight;
    },
  };
}
