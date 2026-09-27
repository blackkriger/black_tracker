// What somebody was told about, shared between the bar that shows it, the calendar that
// lays it out by day and the window that causes it. A comment written in this tab never
// comes back over the live channel — a tab ignores its own echo — so whoever writes one
// asks the feed to read itself again.
import { computed, ref } from 'vue';
import { api } from './api';

export type NoticeKind = 'mention' | 'reaction';

export interface Notice {
  id: string;
  kind: NoticeKind;
  /** The reaction itself, when that is what this is. */
  emoji: string | null;
  said: string;
  by: string | null;
  key: string;
  /** The colour of the status the issue stands in. */
  color: string | null;
  projectShort: string;
  boardSlug: string;
  at: string;
  read: boolean;
}

const OFF = 'tracker:notices:off';

const notices = ref<Notice[]>([]);
const off = ref<NoticeKind[]>(read());
let inflight: Promise<void> | null = null;

function read(): NoticeKind[] {
  try {
    return JSON.parse(localStorage.getItem(OFF) ?? '[]') as NoticeKind[];
  } catch {
    return [];
  }
}

/** The day a notice landed on, as the calendar spells a day. */
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
    unread: computed(() => shown.value.filter((n) => !n.read).length),
    /** A kind switched off is simply not shown; nothing stops being recorded. */
    toggleKind(kind: NoticeKind): void {
      off.value = off.value.includes(kind)
        ? off.value.filter((k) => k !== kind)
        : [...off.value, kind];
      try {
        localStorage.setItem(OFF, JSON.stringify(off.value));
      } catch {
        /* the choice simply does not outlive the tab */
      }
    },
    async load(): Promise<void> {
      inflight ??= api<Notice[]>('/notices')
        .then((rows) => {
          notices.value = rows;
        })
        .catch(() => {
          /* the bar simply shows no feed */
        })
        .finally(() => {
          inflight = null;
        });
      await inflight;
    },
    async markRead(id?: string): Promise<void> {
      await api('/notices/read', { method: 'POST', body: { id } }).catch(() => {});
      notices.value = notices.value.map((n) => (!id || n.id === id ? { ...n, read: true } : n));
    },
  };
}
