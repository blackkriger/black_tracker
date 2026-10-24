import { onBeforeUnmount, onMounted, ref, watchEffect } from 'vue';

const titles = ref<(() => string)[]>([]);

watchEffect(() => {
  document.title = titles.value.map((get) => get()).filter(Boolean).pop() ?? '';
});

export function useTitle(get: () => string): void {
  onMounted(() => {
    titles.value = [...titles.value, get];
  });
  onBeforeUnmount(() => {
    titles.value = titles.value.filter((g) => g !== get);
  });
}
