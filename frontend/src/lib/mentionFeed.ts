// Being named, shared between the bar that shows it and the window that causes it. A
// comment posted in this tab never comes back over the live channel — a tab ignores its
// own echo — so whoever writes one asks the feed to read itself again.
import { computed, ref } from 'vue';
import { api } from './api';

export interface Mention {
  commentId: string;
  said: string;
  by: string;
  key: string;
  projectShort: string;
  boardSlug: string;
  at: string;
  read: boolean;
}

const mentions = ref<Mention[]>([]);
const unread = computed(() => mentions.value.filter((m) => !m.read).length);
let inflight: Promise<void> | null = null;

export function useMentions() {
  return {
    mentions,
    unread,
    async load(): Promise<void> {
      inflight ??= api<Mention[]>('/mentions')
        .then((rows) => {
          mentions.value = rows;
        })
        .catch(() => {
          /* the bar simply shows no feed */
        })
        .finally(() => {
          inflight = null;
        });
      await inflight;
    },
    async markRead(commentId?: string): Promise<void> {
      await api('/mentions/read', { method: 'POST', body: { commentId } }).catch(() => {});
      mentions.value = mentions.value.map((m) =>
        !commentId || m.commentId === commentId ? { ...m, read: true } : m
      );
    },
  };
}
