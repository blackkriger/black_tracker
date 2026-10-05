import { ref } from 'vue';
import { latestRead } from './api';
import type { IssueTag } from './issues';

export interface TagOption extends IssueTag {
  boardIds: string[];
}

const tags = ref<TagOption[]>([]);
const loaded = ref(false);
const read = latestRead<TagOption[]>('/tags', (rows) => {
  tags.value = rows;
  loaded.value = true;
});

export function useTags() {
  return {
    tags,
    loaded,
    async load(force = false): Promise<void> {
      if (loaded.value && !force) return;
      await read(force).catch(() => {
        loaded.value = true;
      });
    },
  };
}
