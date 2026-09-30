<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import SettingsLayout from '../../components/SettingsLayout.vue';
import { useProjects } from '../../lib/projects';
import { lastProject } from '../../lib/lastProject';

const router = useRouter();
const { projects, load } = useProjects();

onMounted(async () => {
  await load();
  const live = projects.value.filter((p) => !p.archived);
  const remembered = live.find((p) => p.shortName === lastProject.get());
  const target = remembered ?? live[0];
  await router.replace(target ? `/settings/${target.shortName}` : '/settings/new');
});
</script>

<template>
  <SettingsLayout>
    <section class="panel sheet__wide">
      <header class="panel__h"><span class="sk sk--line head-sk"></span></header>
      <div class="panel__b p-row">
        <span class="sk sk--field" style="width: 120px"></span>
        <span class="sk sk--field" style="flex: 1 1 220px"></span>
      </div>
    </section>
  </SettingsLayout>
</template>

<style scoped>
.head-sk {
  width: 140px;
}
.p-row {
  display: flex;
  align-items: flex-end;
  gap: var(--space-4);
}
</style>
