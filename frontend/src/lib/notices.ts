import { computed, ref } from 'vue';
import { api, latestRead } from './api';
import { shortDate } from './calendar';

export type NoticeKind = 'mention' | 'reaction' | 'assigned' | 'starred';

export interface NoticeChange {
  field: string;
  from: string | null;
  to: string | null;
}

export interface Notice {
  id: string;
  kind: NoticeKind;
  commentId: string | null;
  emoji: string | null;
  changes: NoticeChange[];
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

export function showsAuthor(n: Notice, me: string | null | undefined): boolean {
  if (!n.by) return false;
  if (n.kind === 'reaction' || n.kind === 'assigned' || (n.kind === 'starred' && !n.commentId)) return true;
  return n.by !== me;
}

export function describeChanges(changes: NoticeChange[], name: (login: string) => string): string {
  const show = (c: NoticeChange, value: string | null): string => {
    if (!value) return '—';
    if (c.field === 'assignee') return name(value);
    if (c.field === 'due date') return shortDate(value, false);
    return value;
  };
  return changes
    .map((c) => {
      if (c.field === 'link added') return `linked ${c.to}`;
      if (c.field === 'link removed') return `unlinked ${c.to}`;
      const label = c.field === 'due date' ? 'due' : c.field;
      return `${label} ${show(c, c.from)} → ${show(c, c.to)}`;
    })
    .join(', ');
}

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
      notices.value = notices.value
        .map((n) => (!id || n.id === id ? { ...n, read: true } : n))
        .sort((a, b) => Number(a.read) - Number(b.read) || Date.parse(b.at) - Date.parse(a.at));
    },
  };
}
