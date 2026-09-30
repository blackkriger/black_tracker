import { computed, ref } from 'vue';
import { api, latestRead } from './api';

export type NoticeKind = 'mention' | 'reaction' | 'assigned';

export interface Notice {
  id: string;
  kind: NoticeKind;
  commentId: string | null;
  emoji: string | null;
  said: string;
  by: string | null;
  key: string;
  color: string | null;
  projectShort: string;
  boardSlug: string;
  at: string;
  read: boolean;
}

const OFF = 'tracker:notices:off';

const notices = ref<Notice[]>([]);
const loaded = ref(false);
const off = ref<NoticeKind[]>(read());
const readNotices = latestRead<Notice[]>('/notices', (rows) => {
  notices.value = rows;
});

function read(): NoticeKind[] {
  try {
    return JSON.parse(localStorage.getItem(OFF) ?? '[]') as NoticeKind[];
  } catch {
    return [];
  }
}

export function dayOf(n: Notice): string {
  const d = new Date(n.at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export function useNotices() {
  const shown = computed(() => notices.value.filter((n) => !off.value.includes(n.kind)));
  return {
    notices,
    shown,
    off,
    loaded,
    unread: computed(() => shown.value.filter((n) => !n.read).length),
    toggleKind(kind: NoticeKind): void {
      off.value = off.value.includes(kind)
        ? off.value.filter((k) => k !== kind)
        : [...off.value, kind];
      try {
        localStorage.setItem(OFF, JSON.stringify(off.value));
      } catch {}
    },
    async load(): Promise<void> {
      await readNotices(true).catch(() => {});
      loaded.value = true;
    },
    async markRead(id?: string): Promise<void> {
      await api('/notices/read', { method: 'POST', body: { id } }).catch(() => {});
      notices.value = notices.value.map((n) => (!id || n.id === id ? { ...n, read: true } : n));
    },
  };
}
