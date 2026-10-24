import { ref } from 'vue';
import { latestRead } from './api';

const updatedAt = ref<string | null>(null);
const read = latestRead<{ updatedAt: string }>('/version', (got) => {
  updatedAt.value = got.updatedAt;
});

export function useVersion() {
  return {
    updatedAt,
    async refresh(): Promise<void> {
      await read(true).catch(() => {});
    },
  };
}
