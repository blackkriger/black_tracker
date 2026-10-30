<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { ExternalLink } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import RollText from './RollText.vue';
import { stamp } from '../lib/issues';
import { useLive } from '../lib/live';
import { useProjects } from '../lib/projects';
import { useVersion } from '../lib/version';

const { t } = useI18n();
const { projects, loaded, load } = useProjects();

const { updatedAt, refresh } = useVersion();
const nav = ref<HTMLElement | null>(null);

const live = computed(() => projects.value.filter((p) => !p.archived));
const archived = computed(() => projects.value.filter((p) => p.archived));

async function showCurrent(): Promise<void> {
  await nextTick();
  const box = nav.value;
  const here = box?.querySelector<HTMLElement>('[aria-current]');
  if (!box || !here || box.scrollWidth <= box.clientWidth) return;
  const offset = here.getBoundingClientRect().left - box.getBoundingClientRect().left;
  box.scrollLeft += offset - (box.clientWidth - here.offsetWidth) / 2;
}
watch(loaded, () => void showCurrent());

onMounted(() => {
  void load();
  void showCurrent();
  void refresh();
});

useLive(
  (ev) => {
    if (['project.changed', 'board.changed'].includes(ev.type)) void load(true);
  },
  () => void load(true)
);
</script>

<template>
  <div class="page">

    <div class="page__body">
      <nav ref="nav" class="side settings__side" :aria-label="t('settings.sections')">
        <div class="side__h">{{ t('settings.profile') }}</div>
        <RouterLink to="/settings/profile">{{ t('settings.profile') }}</RouterLink>
        <RouterLink to="/settings/preferences">{{ t('settings.preferences') }}</RouterLink>
        <RouterLink to="/settings/api">API</RouterLink>

        <div class="side__h">{{ t('fields.projects') }}</div>
        <span v-for="n in loaded ? 0 : 3" :key="n" class="sk sk--row side__sk"></span>
        <RouterLink v-for="p in live" :key="p.id" :to="`/settings/${p.shortName}`">
          <span><span class="proj__k">{{ p.shortName }}</span> {{ p.name }}</span>
        </RouterLink>
        <RouterLink v-for="p in archived" :key="p.id" :to="`/settings/${p.shortName}`">
          <span><span class="proj__k">{{ p.shortName }}</span> {{ p.name }} {{ t('settings.archivedMark') }}</span>
        </RouterLink>
        <RouterLink to="/settings/new">{{ t('settings.newProjectLink') }}</RouterLink>

        <div class="side__h">{{ t('settings.workspace') }}</div>
        <RouterLink to="/settings/users">{{ t('settings.usersAccess') }}</RouterLink>
        <RouterLink to="/settings/tags">{{ t('fields.tags') }}</RouterLink>

        <a class="side__db" href="/db/" target="_blank" rel="noopener noreferrer">
          DB
          <ExternalLink class="ic ic--sm" />
        </a>

        <span class="side__foot stamp">
          <RollText v-if="updatedAt" :text="t('settings.updated', { date: stamp(updatedAt) })" />
        </span>
        <i18n-t keypath="settings.by" tag="span" class="side__by stamp">
          <template #name>
            <a href="https://github.com/blackkriger" target="_blank" rel="noopener noreferrer">blackkriger</a>
          </template>
        </i18n-t>
      </nav>

      <div class="sheet">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.side .proj__k {
  font-size: 13px;
}
.side__sk {
  margin: 0 10px;
}
.page__body {
  flex: 1 1 auto;
  display: flex;
  gap: var(--space-5);
  padding: var(--space-5);
  align-items: flex-start;
  justify-content: center;
  min-height: 0;
}
.settings__side {
  position: sticky;
  top: calc(var(--top-h) + var(--space-5));
  display: flex;
  flex-direction: column;
  width: 220px;
  flex: none;
  height: calc(100vh - var(--top-h) - var(--space-5) * 2);
  overflow-y: auto;
}
.side__db {
  margin-top: auto;
}
.side__foot {
  display: block;
  min-height: 31px;
  padding: 14px 10px 4px;
}
.side__by {
  padding: 0 10px 4px;
}
.side__by a {
  display: inline;
  height: auto;
  padding: 0;
  font: inherit;
  color: var(--text-dim);
}
.side__by a:hover {
  background: none;
  color: var(--text);
}
@media (max-width: 1240px) {
  .page__body {
    justify-content: flex-start;
  }
}
@media (max-width: 860px) {
  .page__body {
    flex-direction: column;
  }
  .settings__side {
    position: static;
    width: 100%;
    height: auto;
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
  }
  .settings__side .side__h,
  .side__foot {
    display: none;
  }
  .settings__side a {
    flex: none;
    white-space: nowrap;
  }
  .settings__side .side__sk {
    flex: 0 0 120px;
  }
}
</style>
