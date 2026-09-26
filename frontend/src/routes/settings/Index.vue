<script setup lang="ts">
// /settings is a junction like the root: it opens the first project's setup, or the workspace tags when there is no project yet.
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useProjects } from '../../lib/projects';
import { lastProject } from '../../lib/lastProject';

const router = useRouter();
const { projects, load } = useProjects();

onMounted(async () => {
  await load();
  const live = projects.value.filter((p) => !p.archived);
  const remembered = live.find((p) => p.shortName === lastProject.get());
  const target = remembered ?? live[0];
  await router.replace(target ? `/settings/p/${target.shortName}` : '/settings/new');
});
</script>

<template>
  <p class="hint" style="padding: var(--space-5)">Loading…</p>
</template>
