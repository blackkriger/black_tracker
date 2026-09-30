import { ref } from 'vue';
import { api } from './api';

export interface RoleMini {
  id: string;
  name: string;
  color: string;
}

const roles = ref<RoleMini[]>([]);
const loaded = ref(false);
let inflight: Promise<void> | null = null;

export function useRoles() {
  return {
    roles,
    loaded,
    async load(force = false): Promise<void> {
      if (loaded.value && !force) return;
      inflight ??= api<RoleMini[]>('/roles')
        .then((rows) => {
          roles.value = rows;
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
