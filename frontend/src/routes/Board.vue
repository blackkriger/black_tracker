<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import TopBar from '../components/TopBar.vue';
import IssueView from '../components/IssueView.vue';
import Select from '../components/Select.vue';
import { usePeople } from '../lib/people';
import { api } from '../lib/api';
import {
  PRIORITIES,
  dueLabel,
  priorityClass,
  priorityColor,
  type Issue,
} from '../lib/issues';
import { lastBoard, lastProject } from '../lib/lastProject';
import { useLive } from '../lib/live';
import { Plus, Search, Star } from 'lucide-vue-next';
import { ink } from '../lib/theme';
import { vSplitLine } from '../lib/splitLine';

interface State {
  id: string;
  name: string;
  position: number;
  isOpen: boolean;
  isResolved: boolean;
  color: string;
}
interface Board {
  id: string;
  name: string;
  slug: string;
  position: number;
  states: State[];
  tagIds: string[];
}
interface Tag {
  id: string;
  name: string;
  color: string;
}
interface Project {
  id: string;
  shortName: string;
  nextKey: string;
  name: string;
  archived: boolean;
  boards: Board[];
}

const route = useRoute();
const router = useRouter();
const project = ref<Project | null>(null);
const issues = ref<Issue[]>([]);
const issuesLoading = ref(true);
let issuesRead = 0;
let projectRead = 0;

const dragId = ref<string | null>(null);
const dropAt = ref<{ stateId: string; beforeId: string | null } | null>(null);

const creatingIn = ref<string | null>(null);

const q = ref('');
const search = ref<HTMLInputElement | null>(null);
const byAssignee = ref('');
const byAuthor = ref('');
const byPriority = ref('');
const { people, colorOf, nameOf, load: loadPeople } = usePeople();
const byTags = ref<string[]>([]);
const starred = ref(false);

const personChoices = computed(() =>
  people.value.map((p) => ({ value: p.id, label: p.fullName || p.login, color: p.roleColor }))
);
const assigneeChoices = computed(() => [
  { value: 'none', label: 'Nobody' },
  ...personChoices.value,
]);
const priorityChoices = PRIORITIES.map((p) => ({ value: p, label: p, color: priorityColor(p) }));

const filtering = computed(
  () =>
    !!q.value.trim() ||
    !!byAssignee.value ||
    !!byAuthor.value ||
    !!byPriority.value ||
    byTags.value.length > 0 ||
    starred.value
);

function clearFilters(): void {
  q.value = '';
  byAssignee.value = '';
  byAuthor.value = '';
  byPriority.value = '';
  byTags.value = [];
  starred.value = false;
}

function toggleTag(id: string): void {
  byTags.value = byTags.value.includes(id)
    ? byTags.value.filter((t) => t !== id)
    : [...byTags.value, id];
}

const filtered = computed(() => {
  const needle = q.value.trim().toLowerCase();
  return issues.value.filter(
    (i) =>
      (!needle ||
        i.key.toLowerCase().includes(needle) ||
        i.summary.toLowerCase().includes(needle)) &&
      (!byAssignee.value ||
        (byAssignee.value === 'none' ? !i.assignee : i.assignee?.id === byAssignee.value)) &&
      (!byAuthor.value || i.author?.id === byAuthor.value) &&
      (!byPriority.value || i.priority === byPriority.value) &&
      byTags.value.every((id) => i.tags.some((t) => t.id === id)) &&
      (!starred.value || i.favourite)
  );
});

function tagCreated(tag: Tag): void {
  if (!tags.value.some((t) => t.id === tag.id)) {
    tags.value = [...tags.value, tag].sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    );
  }
  const board = current.value;
  if (board && !board.tagIds.includes(tag.id)) board.tagIds = [...board.tagIds, tag.id];
}

const fresh = ref<Set<string>>(new Set());

function flash(issueId: string): void {
  fresh.value = new Set(fresh.value).add(issueId);
  setTimeout(() => {
    const next = new Set(fresh.value);
    next.delete(issueId);
    fresh.value = next;
  }, 2000);
}

useLive((ev) => {
  const board = current.value;
  if (!board) return;
  if (['state.changed', 'board.changed', 'project.changed', 'tag.changed'].includes(ev.type)) {
    void load(String(route.params.short), true);
    if (ev.type !== 'project.changed') void loadIssues(board.id, true);
    return;
  }
  if (!ev.type.startsWith('issue.') || ev.boardId !== board.id) return;
  if (ev.type === 'issue.deleted') {
    issues.value = issues.value.filter((i) => i.id !== ev.issueId);
    return;
  }
  void loadIssues(board.id, true).then(() => {
    if (ev.issueId) flash(ev.issueId);
  });
}, () => {
  void load(String(route.params.short), true);
  if (current.value) void loadIssues(current.value.id, true);
});
const tags = ref<Tag[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const boards = computed(() =>
  [...(project.value?.boards ?? [])].sort((a, b) => a.position - b.position)
);
const current = computed(() => {
  const wanted = String(route.params.slug ?? '').toLowerCase();
  if (wanted)
    return boards.value.find((b) => b.slug.toLowerCase() === wanted) ?? boards.value[0] ?? null;
  const short = project.value?.shortName;
  const remembered = short ? boards.value.find((b) => b.slug === lastBoard.get(short)) : null;
  return remembered ?? boards.value[0] ?? null;
});

const boardTags = computed(() => tags.value.filter((t) => current.value?.tagIds.includes(t.id)));

const openKey = computed(() => String(route.params.key ?? ''));

const issuesOf = (stateId: string): Issue[] =>
  filtered.value.filter((i) => i.stateId === stateId).sort((a, b) => a.position - b.position);

async function loadIssues(boardId: string, quiet = false): Promise<void> {
  const mine = ++issuesRead;
  if (!quiet) issuesLoading.value = true;
  try {
    const rows = await api<Issue[]>(`/boards/${boardId}/issues`);
    if (mine !== issuesRead) return;
    issues.value = rows;
    error.value = null;
  } catch (err) {
    if (mine !== issuesRead) return;
    issues.value = [];
    error.value = err instanceof Error ? err.message : 'Could not load the issues.';
  } finally {
    if (mine === issuesRead) issuesLoading.value = false;
  }
}

watch(
  () => current.value?.id,
  (boardId) => {
    if (boardId) void loadIssues(boardId);
    else issues.value = [];
  }
);

function onDragOver(stateId: string, beforeId: string | null): void {
  if (!dragId.value) return;
  dropAt.value = { stateId, beforeId };
}

async function onDrop(): Promise<void> {
  const target = dropAt.value;
  const moved = issues.value.find((i) => i.id === dragId.value);
  dragId.value = null;
  dropAt.value = null;
  const board = current.value;
  if (!target || !moved || !board) return;
  if (target.beforeId === moved.id) return;
  issuesRead += 1;

  // Send the whole column, not the filtered view, or hidden cards get renumbered out of place.
  const column = issues.value
    .filter((i) => i.stateId === target.stateId && i.id !== moved.id)
    .sort((a, b) => a.position - b.position);
  const at = target.beforeId ? column.findIndex((i) => i.id === target.beforeId) : column.length;
  column.splice(at < 0 ? column.length : at, 0, moved);

  moved.stateId = target.stateId;
  column.forEach((i, n) => (i.position = n));
  try {
    await api(`/boards/${board.id}/issues/order`, {
      method: 'POST',
      body: { issueId: moved.id, stateId: target.stateId, ids: column.map((i) => i.id) },
    });
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not move the card.';
    await loadIssues(board.id);
  }
}

const carried = ref<{ key: string; message: string } | null>(null);

function issueCreated(created: Issue, problem?: string): void {
  issues.value = issues.value.some((i) => i.id === created.id)
    ? issues.value.map((i) => (i.id === created.id ? created : i))
    : [...issues.value, created];
  carried.value = problem ? { key: created.key, message: problem } : null;
  creatingIn.value = null;
  openIssue(created);
}

function openIssue(issue: Issue): void {
  const short = project.value?.shortName;
  const slug = current.value?.slug;
  if (short && slug) void router.push(`/${short}/${slug}/${issue.key}`);
}

function closeIssue(): void {
  creatingIn.value = null;
  const short = project.value?.shortName;
  const slug = current.value?.slug;
  if (openKey.value && short && slug) void router.push(`/${short}/${slug}`);
}

function issueChanged(updated: Issue): void {
  issues.value = issues.value.map((i) => (i.id === updated.id ? { ...i, ...updated } : i));
}

function linksChanged(): void {
  if (current.value) void loadIssues(current.value.id, true);
}

function issueMoved(boardId: string): void {
  const short = project.value?.shortName;
  const to = boards.value.find((b) => b.id === boardId);
  if (!short || !to) return;
  void router.push(`/${short}/${to.slug}/${openKey.value}`);
}

function issueGone(id: string): void {
  issues.value = issues.value.filter((i) => i.id !== id);
  closeIssue();
}

watch(current, (board) => {
  const short = project.value?.shortName;
  if (!board || !short) return;
  lastBoard.set(short, board.slug);
  if (!route.params.slug) void router.replace(`/${short}/${board.slug}`);
});

async function load(short: string, quiet = false): Promise<void> {
  const mine = ++projectRead;
  if (!quiet) {
    loading.value = true;
    project.value = null;
    issues.value = [];
    tags.value = [];
  }
  error.value = null;
  try {
    const [loaded, tagRows] = await Promise.all([
      api<Project>(`/projects/${encodeURIComponent(short)}`),
      api<Tag[]>('/tags'),
    ]);
    if (mine !== projectRead) return;
    project.value = loaded;
    tags.value = tagRows;
    lastProject.set(loaded.shortName);
  } catch (err) {
    if (mine !== projectRead) return;
    project.value = null;
    tags.value = [];
    error.value = err instanceof Error ? err.message : 'Could not load the project.';
  } finally {
    if (mine === projectRead) loading.value = false;
  }
}

function onKeydown(ev: KeyboardEvent): void {
  if (!ev.altKey || ev.key !== 'Enter') return;
  ev.preventDefault();
  search.value?.focus();
  search.value?.select();
}

onMounted(() => {
  void load(String(route.params.short));
  void loadPeople();
  window.addEventListener('keydown', onKeydown);
});
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
watch(
  () => route.params.short,
  (short) => {
    if (short) void load(String(short));
  }
);
</script>

<template>
  <div class="page">
    <TopBar :project="project" :board="current" />

    <div v-if="current" class="tagbar">
      <span class="search">
        <Search class="ic ic--sm search__i" />
        <input
          ref="search"
          v-model="q"
          class="input input--sm filter search__f"
          placeholder="Search by summary…"
          maxlength="80"
          aria-label="Search the board"
        />
      </span>
      <Select
        v-model="byPriority"
        class="filter"
        :options="priorityChoices"
        placeholder="Priority"
        keep-placeholder
        small
        label="Filter by priority"
      />
      <Select
        v-model="byAssignee"
        class="filter"
        :options="assigneeChoices"
        placeholder="Assignee"
        keep-placeholder
        small
        label="Filter by assignee"
      />
      <Select
        v-model="byAuthor"
        class="filter"
        :options="personChoices"
        placeholder="Author"
        keep-placeholder
        small
        label="Filter by author"
      />

      <button
        v-for="t in boardTags"
        :key="t.id"
        class="taglabel taglabel--plain taglabel--pick"
        :class="{ 'is-off': byTags.length && !byTags.includes(t.id) }"
        type="button"
        :aria-pressed="byTags.includes(t.id)"
        :style="{ '--c': t.color }"
        @click="toggleTag(t.id)"
      >{{ t.name }}</button>

      <button
        class="btn btn--sm btn--icon btn--ghost star"
        :class="{ 'is-on': starred }"
        type="button"
        title="Only my favourites"
        :aria-pressed="starred"
        @click="starred = !starred"
      >
        <Star class="ic" :fill="starred ? 'currentColor' : 'none'" />
      </button>

      <button
        v-if="filtering"
        class="btn btn--sm btn--ghost"
        type="button"
        @click="clearFilters"
      >
        Clear filters
      </button>
    </div>

    <div
      v-if="loading || error || !current"
      class="page__body"
      :class="{ 'page__body--tags': current }"
    >
      <p v-if="loading" class="hint">Loading…</p>
      <div v-else-if="error" class="empty"><span class="empty__g">✕</span>{{ error }}</div>
      <div v-else-if="!current" class="empty"><span class="empty__g">◇</span>This project has no boards.</div>
    </div>

    <div v-if="current" class="board board--tags">
      <section
        v-for="s in current.states"
        :key="s.id"
        class="col"
        :class="{ 'col--drop': dropAt?.stateId === s.id }"
        :style="{ '--c': s.color }"
        :aria-label="`${s.name}, ${issuesOf(s.id).length} issues`"
        @dragover.prevent="onDragOver(s.id, null)"
        @drop.prevent="onDrop"
      >
        <header class="col__head">
          <h2 class="col__name">{{ s.name }}</h2>
          <span class="col__count">{{ issuesOf(s.id).length }}</span>
        </header>

        <div class="col__body">
          <template v-if="!issuesLoading">
            <article
              v-for="i in issuesOf(s.id)"
              :key="i.id"
              class="card"
              :class="{ 'card--ghost': dragId === i.id, 'is-fresh': fresh.has(i.id) }"
              draggable="true"
              tabindex="0"
              @dragstart="dragId = i.id"
              @dragend="dragId = null; dropAt = null"
              @dragover.prevent.stop="onDragOver(s.id, i.id)"
              @drop.prevent.stop="onDrop"
              @click="openIssue(i)"
              @keydown.enter="openIssue(i)"
            >
              <div class="card__top">
                <span class="key">{{ i.key }}</span>
                <span class="prio" :class="priorityClass(i.priority)" :aria-label="i.priority">
                  <i></i><i></i><i></i><i></i>
                </span>
              </div>
              <div v-split-line class="card__title">
                <span>{{ i.summary }}</span>
                <span v-if="i.tags.length" class="card__tags">
                  <span
                    v-for="t in i.tags"
                    :key="t.id"
                    class="taglabel taglabel--plain taglabel--sm"
                    :style="{ '--c': t.color }"
                  >{{ t.name }}</span>
                </span>
              </div>
              <div v-if="i.assignee || i.dueDate || i.subtasks" class="card__meta">
                <span
                  v-if="i.assignee"
                  class="card__who"
                  :style="{ color: ink(colorOf(i.assignee.login)) }"
                >{{ nameOf(i.assignee.login) }}</span>
                <div class="sp"></div>
                <span v-if="i.subtasks" class="card__subs">{{ i.subtasks.done }}/{{ i.subtasks.total }}</span>
                <span
                  v-if="dueLabel(i.dueDate)"
                  class="due"
                  :class="{ 'due--late': dueLabel(i.dueDate)?.late }"
                >{{ dueLabel(i.dueDate)?.text }}</span>
              </div>
            </article>

            <button
              class="add add--plus"
              type="button"
              :aria-label="`Add an issue to ${s.name}`"
              @click="creatingIn = s.id"
            ><Plus class="ic" /></button>
          </template>
        </div>
      </section>
    </div>

    <IssueView
      v-if="current && (openKey || creatingIn)"
      :key="openKey || 'new'"
      :issue-key="openKey || undefined"
      :create-in="creatingIn"
      :board="current"
      :boards="boards"
      :tags="boardTags"
      :project="project?.shortName ?? ''"
      :next-key="project?.nextKey ?? ''"
      :focus-comment="String(route.query.c ?? '') || undefined"
      :carried-error="carried?.key === openKey ? carried.message : undefined"
      @close="closeIssue"
      @tag-created="tagCreated"
      @moved="issueMoved"
      @changed="issueChanged"
      @linked="linksChanged"
      @created="issueCreated"
      @deleted="issueGone"
    />
  </div>
</template>

<style scoped>
.page {
  height: 100vh;
  display: flex;
  flex-direction: column;
}
.page__body {
  flex: 1 1 auto;
  padding: var(--space-5);
  overflow-x: auto;
}
.page__body--tags,
.board--tags {
  padding-top: 0;
}
.taglabel--pick {
  border: 0;
  cursor: pointer;
  font-family: inherit;
}
.taglabel--pick.is-off {
  opacity: 0.35;
}
.star.is-on {
  color: var(--accent);
}
.filter {
  width: auto;
  height: 26px;
  padding: 0 6px;
  border-color: var(--line);
  color: var(--text-dim);
  font-size: 12.5px;
}
.filter:hover {
  color: var(--text);
}
.search {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.search__i {
  position: absolute;
  left: 7px;
  color: var(--text-muted);
  pointer-events: none;
}
.search__f {
  width: 170px;
  padding-left: 25px;
}
.search__f::placeholder {
  color: var(--text-muted);
}
.card {
  user-select: none;
}
.card__tags .taglabel {
  margin-left: 6px;
  vertical-align: middle;
}
.card__title.is-split {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.card__title.is-split .card__tags {
  display: flex;
  flex: none;
  gap: 6px;
}
.card__title.is-split .card__tags .taglabel {
  margin-left: 0;
}
.card__subs {
  font: 11px/1 var(--font-num);
  color: var(--text-muted);
  white-space: nowrap;
}
.card__who {
  font-size: 12.5px;
  color: var(--text-dim);
}
.add--plus {
  width: auto;
  padding: 0 8px;
  font-size: 16px;
  line-height: 1;
  color: var(--text-muted);
}
.add--plus:hover {
  background: none;
  color: var(--text);
}
</style>
