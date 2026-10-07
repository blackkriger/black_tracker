import { computed, ref, watch } from 'vue';
import { api } from './api';
import { shortDate } from './calendar';
import { useSession, type Me } from './session';

export type NoticeKind = 'mention' | 'reaction' | 'assigned' | 'starred' | 'ping';

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
  if (n.kind === 'reaction' || n.kind === 'assigned' || n.kind === 'ping' || (n.kind === 'starred' && !n.commentId)) {
    return true;
  }
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

const PAGE = 10;

const notices = ref<Notice[]>([]);
const loaded = ref(false);
const hasMore = ref(true);
const counts = ref<Partial<Record<NoticeKind, number>>>({});
const session = useSession();
const off = computed<NoticeKind[]>(() => session.me.value?.noticesOff ?? []);
let reads = 0;
let paging: Promise<void> | null = null;

async function setOff(next: NoticeKind[]): Promise<void> {
  const before = session.me.value;
  if (!before) return;
  session.me.value = { ...before, noticesOff: next };
  try {
    const updated = await api<Me>('/me', { method: 'PATCH', body: { noticesOff: next } });
    if (session.me.value) session.me.value = { ...session.me.value, ...updated };
  } catch (err) {
    if (session.me.value) session.me.value = { ...session.me.value, noticesOff: before.noticesOff };
    throw err;
  }
}

watch(
  () => session.me.value?.id,
  (id) => {
    if (!id) return;
    let kept: NoticeKind[] = [];
    try {
      kept = JSON.parse(localStorage.getItem(OFF) ?? '[]') as NoticeKind[];
      localStorage.removeItem(OFF);
    } catch {}
    if (kept.length && !session.me.value?.noticesOff.length) void setOff(kept).catch(() => {});
  },
  { immediate: true }
);

async function readCounts(): Promise<void> {
  try {
    counts.value = await api<Partial<Record<NoticeKind, number>>>('/notices/unread');
  } catch {}
}

async function refresh(): Promise<void> {
  const mine = ++reads;
  const size = Math.min(200, Math.max(PAGE, notices.value.length));
  try {
    const [rows, unread] = await Promise.all([
      api<Notice[]>(`/notices?limit=${size}`),
      api<Partial<Record<NoticeKind, number>>>('/notices/unread'),
    ]);
    if (mine !== reads) return;
    notices.value = rows;
    counts.value = unread;
    hasMore.value = rows.length >= size;
  } catch {}
  loaded.value = true;
}

function loadMore(): Promise<void> {
  const last = notices.value[notices.value.length - 1];
  if (paging || !hasMore.value || !last) return paging ?? Promise.resolve();
  const mine = reads;
  paging = api<Notice[]>(`/notices?limit=${PAGE}&after=${last.id}`)
    .then((rows) => {
      if (mine !== reads) return;
      const seen = new Set(notices.value.map((n) => n.id));
      notices.value = [...notices.value, ...rows.filter((r) => !seen.has(r.id))];
      hasMore.value = rows.length >= PAGE;
    })
    .catch(() => {})
    .finally(() => {
      paging = null;
    });
  return paging;
}

export function useNotices() {
  const shown = computed(() => notices.value.filter((n) => !off.value.includes(n.kind)));
  const unreadOf = computed(() => (kind: NoticeKind) => (off.value.includes(kind) ? 0 : counts.value[kind] ?? 0));
  return {
    notices,
    shown,
    off,
    loaded,
    hasMore,
    loadMore,
    unreadOf,
    toggleKind(kind: NoticeKind): Promise<void> {
      return setOff(off.value.includes(kind) ? off.value.filter((k) => k !== kind) : [...off.value, kind]);
    },
    load: refresh,
    async markRead(id?: string): Promise<void> {
      await api('/notices/read', { method: 'POST', body: { id } }).catch(() => {});
      notices.value = notices.value
        .map((n) => (!id || n.id === id ? { ...n, read: true } : n))
        .sort((a, b) => Number(a.read) - Number(b.read) || Date.parse(b.at) - Date.parse(a.at));
      await readCounts();
    },
  };
}
