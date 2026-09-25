import { computed, ref } from 'vue';
import { api } from './api';

export interface Me {
  id: string;
  login: string;
  fullName: string;
  role: 'admin' | 'member';
  active: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  authKind: 'session' | 'token';
  /** Null until a token is minted; the raw value is never part of this — only its tail and dates. */
  token: { hint: string | null; createdAt: string | null; lastUsedAt: string | null } | null;
}

const me = ref<Me | null>(null);
const ready = ref(false);

export function useSession() {
  return {
    me,
    ready,
    isAdmin: computed(() => me.value?.role === 'admin'),
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
