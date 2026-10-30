<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import DateRangePicker from './DateRangePicker.vue';
import FilterMenu from './FilterMenu.vue';
import { useBoards } from '../lib/boards';
import { filtersQuery, noFilters, type Filters } from '../lib/filters';
import { toggled } from '../lib/lists';
import { useLive } from '../lib/live';
import { personChoice, usePeople } from '../lib/people';
import { useProjects } from '../lib/projects';
import { useTags } from '../lib/tags';

const { t } = useI18n();
type Menu = 'projects' | 'states' | 'assignees' | 'watchers' | 'authors';
const ALL_MENUS: Menu[] = ['projects', 'states', 'assignees', 'watchers', 'authors'];

const props = defineProps<{ modelValue: Filters; base?: Filters; dirty?: boolean; menus?: Menu[] }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: Filters): void; (e: 'clear'): void }>();

const { projects, loaded: projectsLoaded, load: loadProjects } = useProjects();
const { people, load: loadPeople } = usePeople();
const { tags, loaded: tagsLoaded, load: loadTags } = useTags();
const { boards, boardOf, forget } = useBoards();

const set = (part: Partial<Filters>): void => emit('update:modelValue', { ...props.modelValue, ...part });
const shown = computed(() => props.menus ?? ALL_MENUS);
const shows = (menu: Menu): boolean => shown.value.includes(menu);

const live = computed(() => projects.value.filter((p) => !p.archived));
const scope = computed(() =>
  props.modelValue.projects.length
    ? live.value.filter((p) => props.modelValue.projects.includes(p.shortName))
    : live.value
);
watch(
  scope,
  (now) => {
    if (!shows('states')) return;
    for (const p of now) for (const b of p.boards) void boardOf(b.id).catch(() => {});
  },
  { immediate: true }
);

const projectChoices = computed(() =>
  live.value.map((p) => ({ value: p.shortName, key: p.shortName, label: p.name }))
);
const stateChoices = computed(() => {
  const seen = new Map<string, string>();
  for (const p of scope.value)
    for (const b of p.boards)
      for (const s of boards.value.get(b.id)?.states ?? []) if (!seen.has(s.name)) seen.set(s.name, s.color);
  return [...seen].map(([name, color]) => ({ value: name, label: name, color }));
});
const personChoices = computed(() =>
  people.value.map((p) => personChoice(p, p.login))
);
const assigneeChoices = computed(() => [{ value: '-', label: t('fields.nobody') }, ...personChoices.value]);
const tagChoices = computed(() => {
  const onBoards = new Set(scope.value.flatMap((p) => p.boards.map((b) => b.id)));
  return tags.value.filter((t) => t.boardIds.some((id) => onBoards.has(id)));
});

function toggleTag(id: string): void {
  set({ tags: toggled(props.modelValue.tags, id) });
}

const periodOn = computed(() => {
  const base = props.base ?? noFilters();
  return props.modelValue.from !== base.from || props.modelValue.to !== base.to;
});
const changed = computed(() => {
  const base = props.base ?? noFilters();
  const own = filtersQuery(props.modelValue, base);
  return props.dirty || Object.keys(own).some((key) => !ALL_MENUS.includes(key as Menu) || shows(key as Menu));
});

function clearAll(): void {
  const base = props.base ?? noFilters();
  const cleared: Partial<Filters> = { tags: base.tags, from: base.from, to: base.to };
  for (const menu of shown.value) cleared[menu] = menu === 'projects' ? [] : base[menu];
  set(cleared);
  emit('clear');
}

useLive(
  (ev) => {
    if (ev.type === 'tag.changed') void loadTags(true);
    if (['board.changed', 'state.changed'].includes(ev.type)) forget();
  },
  () => void loadTags(true)
);

onMounted(() => {
  void loadProjects();
  void loadPeople();
  void loadTags();
});
</script>

<template>
  <div class="fbar">
    <FilterMenu
      v-if="shows('projects')"
      :model-value="modelValue.projects"
      :label="t('fields.projects')"
      :options="projectChoices"
      @update:model-value="set({ projects: $event })"
    />
    <FilterMenu
      v-if="shows('states')"
      :model-value="modelValue.states"
      :label="t('fields.status')"
      :options="stateChoices"
      @update:model-value="set({ states: $event })"
    />
    <FilterMenu
      v-if="shows('assignees')"
      :model-value="modelValue.assignees"
      :label="t('fields.assignee')"
      :options="assigneeChoices"
      @update:model-value="set({ assignees: $event })"
    />
    <FilterMenu
      v-if="shows('watchers')"
      :model-value="modelValue.watchers"
      :label="t('fields.watcher')"
      :options="personChoices"
      @update:model-value="set({ watchers: $event })"
    />
    <FilterMenu
      v-if="shows('authors')"
      :model-value="modelValue.authors"
      :label="t('fields.author')"
      :options="personChoices"
      @update:model-value="set({ authors: $event })"
    />
    <slot />
    <span class="vsep fbar__sep" aria-hidden="true"></span>
    <span class="fbar__period" :class="{ 'is-on': periodOn }">
      <DateRangePicker
        :from="modelValue.from"
        :to="modelValue.to"
        @change="set({ from: $event.from, to: $event.to })"
      />
    </span>
    <button
      v-for="t in tagChoices"
      :key="t.id"
      class="taglabel taglabel--plain taglabel--pick"
      :class="{ 'is-off': modelValue.tags.length && !modelValue.tags.includes(t.id) }"
      type="button"
      :aria-pressed="modelValue.tags.includes(t.id)"
      :style="{ '--c': t.color }"
      @click="toggleTag(t.id)"
    >{{ t.name }}</button>
    <template v-if="!tagsLoaded || !projectsLoaded">
      <span v-for="w in [40, 62]" :key="w" class="sk tag-sk" :style="{ width: `${w}px` }"></span>
    </template>
    <button v-if="changed" class="btn btn--sm btn--ghost" type="button" @click="clearAll">
      {{ t('filters.clearAll') }}
    </button>
  </div>
</template>

<style scoped>
.fbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.fbar__period:not(.is-on) :deep(.drp__trigger) {
  color: var(--text-muted);
}
@media (max-width: 760px) {
  .fbar__sep {
    display: none;
  }
}
</style>
