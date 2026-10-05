import { ref } from 'vue';
import { api } from './api';

export interface BoardFull {
  id: string;
  name: string;
  slug: string;
  states: { id: string; name: string; color: string }[];
  tagIds: string[];
  defaultStateId?: string | null;
  defaultAssigneeId?: string | null;
}

const cache = ref(new Map<string, BoardFull>());

export function useBoards() {
  return {
    boards: cache,
    async boardOf(id: string): Promise<BoardFull> {
      const kept = cache.value.get(id);
      if (kept) return kept;
      const got = await api<BoardFull>(`/boards/${id}`);
      cache.value = new Map(cache.value).set(id, got);
      return got;
    },
    forget(id?: string): void {
      if (!id) {
        cache.value = new Map();
        return;
      }
      const next = new Map(cache.value);
      next.delete(id);
      cache.value = next;
    },
  };
}
