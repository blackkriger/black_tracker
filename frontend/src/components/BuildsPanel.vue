<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import BuildActions from './BuildActions.vue';
import BuildList from './BuildList.vue';
import { useBuilds } from '../lib/builds';
import { useLive } from '../lib/live';
import { useProjects } from '../lib/projects';

const props = defineProps<{ projects?: string[] }>();

const { t } = useI18n();
const { projects } = useProjects();
const { load } = useBuilds();

const shown = computed(() =>
  projects.value.filter((p) => !p.archived && (!props.projects?.length || props.projects.includes(p.shortName)))
);
const single = computed(() => (shown.value.length === 1 ? shown.value[0] : null));

const errors = ref<Record<string, string | null>>({});
const error = computed(() => shown.value.map((p) => errors.value[p.shortName]).find(Boolean) ?? null);
const setError = (project: string, message: string | null): void => {
  errors.value = { ...errors.value, [project]: message };
};

onMounted(() => void load());
useLive(
  (ev) => {
    if (ev.type === 'build.changed') void load(true);
  },
  () => void load(true)
);
</script>

<template>
  <div class="stack">
    <section class="panel">
      <header class="panel__h">
        {{ t('builds.title') }}
        <span v-if="single" class="panel__end">
          <BuildActions :project="single.shortName" @error="setError(single.shortName, $event)" />
        </span>
      </header>
      <div class="panel__b">
        <BuildList v-if="single" :project="single.shortName" />
        <div v-else class="builds">
          <div v-for="p in shown" :key="p.id" class="builds__proj">
            <div class="builds__h">
              <span class="proj__k">{{ p.shortName }}</span>
              <span class="builds__name">{{ p.name }}</span>
              <BuildActions class="builds__acts" :project="p.shortName" @error="setError(p.shortName, $event)" />
            </div>
            <BuildList :project="p.shortName" />
          </div>
        </div>
      </div>
    </section>
    <div v-if="error" class="err panel__err">{{ error }}</div>
  </div>
</template>

<style scoped>
.builds {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr));
  gap: 20px 24px;
}
.builds__proj {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.builds__h {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 28px;
}
.builds__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-dim);
  font-size: 13px;
}
.builds__acts {
  margin-left: auto;
}
</style>
