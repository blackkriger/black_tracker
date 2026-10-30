import { defineAsyncComponent } from 'vue';

const load = () => import('../components/IssueView.vue');

export const IssueView = defineAsyncComponent(load);

export const preloadIssueView = (): void => void load();
