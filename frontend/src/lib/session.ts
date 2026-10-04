import { computed, ref } from 'vue';
import { api } from './api';

export interface Me {
  id: string;
  login: string;
  fullName: string;
  isAdmin: boolean;
  active: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  authKind: 'session' | 'token';
  canDelete: boolean;
  canManageRoles: boolean;
  role: { id: string; name: string; color: string } | null;
  token: { hint: string | null; createdAt: string | null; lastUsedAt: string | null } | null;
  autoStar: { created: boolean; assigned: boolean; commented: boolean };
  githubLogin: string | null;
}

const me = ref<Me | null>(null);
const ready = ref(false);

export function useSession() {
  return {
    me,
    ready,
    isAdmin: computed(() => me.value?.isAdmin === true),
    canDelete: computed(() => me.value?.canDelete === true),
    canManageRoles: computed(() => me.value?.canManageRoles === true),
    async refresh(): Promise<void> {
      try {
        me.value = await api<Me>('/me');
      } catch {
        me.value = null;
      } finally {
        ready.value = true;
      }
    },
    async signIn(login: string, password: string): Promise<void> {
      await api('/login', { method: 'POST', body: { login, password } });
      me.value = await api<Me>('/me');
    },
    async signOut(): Promise<void> {
      await api('/logout', { method: 'POST' }).catch(() => {});
      me.value = null;
    },
  };
}
