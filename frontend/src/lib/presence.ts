import { computed, reactive, ref, watch, type ComputedRef } from 'vue';
import { api } from './api';
import { listen } from './live';
import { useSession } from './session';

export interface BoardPresence {
  board: string[];
  issues: Record<string, string[]>;
}

const seen = ref<Record<string, BoardPresence>>({});
export const here = reactive<{ boardId: string | null; issueId: string | null }>({ boardId: null, issueId: null });

async function report(): Promise<void> {
  try {
    const now = await api<Record<string, BoardPresence>>('/presence', {
      method: 'POST',
      body: { boardId: here.boardId, issueId: here.issueId },
    });
    seen.value = { ...seen.value, ...now };
  } catch {}
}

let timer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => [here.boardId, here.issueId],
  () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void report(), 200);
  }
);

listen(
  (ev) => {
    if (ev.type === 'presence.changed' && ev.boardId && ev.presence) {
      seen.value = { ...seen.value, [ev.boardId]: ev.presence };
    }
  },
  () => {
    if (here.boardId || here.issueId) void report();
  }
);

const session = useSession();
const others = (logins: string[] | undefined): string[] =>
  (logins ?? []).filter((login) => login !== session.me.value?.login);

export const boardViewers = (boardId: () => string | null | undefined): ComputedRef<string[]> =>
  computed(() => {
    const id = boardId();
    return id ? others(seen.value[id]?.board) : [];
  });

export const issueViewers = (
  boardId: () => string | null | undefined,
  issueId: () => string | null | undefined
): ComputedRef<string[]> =>
  computed(() => {
    const board = boardId();
    const issue = issueId();
    return board && issue ? others(seen.value[board]?.issues[issue]) : [];
  });
