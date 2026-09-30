import { ref } from 'vue';
import { latestRead } from './api';

export interface RoleMini {
  id: string;
  name: string;
  color: string;
}

const roles = ref<RoleMini[]>([]);
const loaded = ref(false);
const read = latestRead<RoleMini[]>('/roles', (rows) => {
  roles.value = rows;
  loaded.value = true;
});

export function useRoles() {
  return {
    roles,
    loaded,
    async load(force = false): Promise<void> {
      if (loaded.value && !force) return;
      await read(force).catch(() => {});
    },
  };
}
