import { computed, ref } from 'vue';
import { api, onUnauthorized } from './api';
import type { NoticeKind } from './notices';

export type Messenger = 'telegram' | 'vk';

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
  messengers: Record<Messenger, { ready: boolean; name: string | null }>;
  noticesOff: NoticeKind[];
  lang: 'system' | 'en' | 'ru';
  langSeen: 'en' | 'ru' | null;
  gender: 'm' | 'f' | null;
}

const me = ref<Me | null>(null);
const ready = ref(false);
const signedOut = ref<string | null>(null);

onUnauthorized((message) => {
  if (me.value) signedOut.value = message;
});

export function useSession() {
  return {
    me,
    ready,
    signedOut,
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
