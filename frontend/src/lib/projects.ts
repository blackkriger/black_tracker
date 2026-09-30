import { ref } from 'vue';
import { latestRead } from './api';

export interface ProjectMini {
  id: string;
  shortName: string;
  name: string;
  archived: boolean;
  boards: { id: string; name: string; slug: string }[];
}

const projects = ref<ProjectMini[]>([]);
const loaded = ref(false);
const failed = ref(false);
const read = latestRead<ProjectMini[]>('/projects', (rows) => {
  projects.value = rows;
  loaded.value = true;
  failed.value = false;
});

export function useProjects() {
  return {
    projects,
    loaded,
    failed,
    async load(force = false): Promise<void> {
      if (loaded.value && !force) return;
      await read(force).catch(() => {
        failed.value = true;
      });
    },
  };
}
