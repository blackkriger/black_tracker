import { ref } from 'vue';

const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
export const reducedMotion = ref(reducedQuery.matches);
reducedQuery.addEventListener('change', (ev) => (reducedMotion.value = ev.matches));
