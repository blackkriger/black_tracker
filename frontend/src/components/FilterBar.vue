<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import DateRangePicker from './DateRangePicker.vue';
import FilterMenu from './FilterMenu.vue';
import { useBoards } from '../lib/boards';
import { filtersQuery, noFilters, type Filters } from '../lib/filters';
import { useLive } from '../lib/live';
import { usePeople } from '../lib/people';
import { useProjects } from '../lib/projects';
import { useTags } from '../lib/tags';

const props = defineProps<{ modelValue: Filters; base?: Filters; dirty?: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: Filters): void; (e: 'clear'): void }>();

const { projects, loaded: projectsLoaded, load: loadProjects } = useProjects();
const { people, load: loadPeople } = usePeople();
const { tags, loaded: tagsLoaded, load: loadTags } = useTags();
const { boards, boardOf, forget } = useBoards();

const set = (part: Partial<Filters>): void => emit('update:modelValue', { ...props.modelValue, ...part });

const live = computed(() => projects.value.filter((p) => !p.archived));
const scope = computed(() =>
  props.modelValue.projects.length
    ? live.value.filter((p) => props.modelValue.projects.includes(p.shortName))
    : live.value
);
watch(
  scope,
  (now) => {
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
  people.value.map((p) => ({ value: p.login, label: p.fullName || p.login, color: p.roleColor }))
);
const assigneeChoices = computed(() => [{ value: '-', label: 'Nobody' }, ...personChoices.value]);
const tagChoices = computed(() => {
  const onBoards = new Set(scope.value.flatMap((p) => p.boards.map((b) => b.id)));
  return tags.value.filter((t) => t.boardIds.some((id) => onBoards.has(id)));
});

function toggleTag(id: string): void {
  const picked = props.modelValue.tags;
  set({ tags: picked.includes(id) ? picked.filter((t) => t !== id) : [...picked, id] });
}

const periodOn = computed(() => {
  const base = props.base ?? noFilters();
  return props.modelValue.from !== base.from || props.modelValue.to !== base.to;
});
const changed = computed(
  () => props.dirty || Object.keys(filtersQuery(props.modelValue, props.base ?? noFilters())).length > 0
);

function clearAll(): void {
  emit('update:modelValue', { ...(props.base ?? noFilters()), projects: [] });
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
      :model-value="modelValue.projects"
      label="Projects"
      :options="projectChoices"
      @update:model-value="set({ projects: $event })"
    />
    <FilterMenu
      :model-value="modelValue.states"
      label="Status"
      :options="stateChoices"
      @update:model-value="set({ states: $event })"
    />
    <FilterMenu
      :model-value="modelValue.assignees"
      label="Assignee"
      :options="assigneeChoices"
      @update:model-value="set({ assignees: $event })"
    />
    <FilterMenu
      :model-value="modelValue.watchers"
      label="Watcher"
      :options="personChoices"
      @update:model-value="set({ watchers: $event })"
    />
    <FilterMenu
      :model-value="modelValue.authors"
      label="Author"
      :options="personChoices"
      @update:model-value="set({ authors: $event })"
    />
    <span class="fbar__sep" aria-hidden="true"></span>
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
      Clear all
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
.taglabel--pick {
  border: 0;
  cursor: pointer;
  font-family: inherit;
}
.taglabel--pick.is-off {
  opacity: 0.35;
}
.fbar__sep {
  flex: none;
  width: 1px;
  height: 16px;
  margin: 0 6px;
  background: var(--line-2);
}
.tag-sk {
  display: block;
  height: 24px;
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
