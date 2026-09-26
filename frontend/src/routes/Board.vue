<script setup lang="ts">
// A board, its columns and the cards in them. Dragging a card is the whole editing surface here: everything else about an issue happens in the view that opens on it.
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import TopBar from '../components/TopBar.vue';
import IssueView from '../components/IssueView.vue';
import { api } from '../lib/api';
import {
  PRIORITIES,
  dueLabel,
  priorityClass,
  priorityColor,
  type Issue,
  type Priority,
} from '../lib/issues';
import { lastBoard, lastProject } from '../lib/lastProject';
import { useLive } from '../lib/live';
import { Plus, Star } from 'lucide-vue-next';

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
}
interface Tag {
  id: string;
  name: string;
  color: string;
}
interface Project {
  id: string;
  shortName: string;
  name: string;
  archived: boolean;
  boards: Board[];
}

const route = useRoute();
const router = useRouter();
const project = ref<Project | null>(null);
const issues = ref<Issue[]>([]);
const issuesLoading = ref(true);
// Which read is the current one: an older answer landing late is dropped rather than painted.
let issuesRead = 0;
let projectRead = 0;

// The card being carried, and where it would land: the column under the cursor and the card it would go in front of.
const dragId = ref<string | null>(null);
const dropAt = ref<{ stateId: string; beforeId: string | null } | null>(null);

// The column a new issue is being written into, if any.
const creatingIn = ref<string | null>(null);

// What the board is narrowed to. Nothing is remembered between visits — a filter is a way of looking at the board right now, not a setting.
const byAssignee = ref('');
const byAuthor = ref('');
const byPriority = ref<Priority | ''>('');
const people = ref<{ id: string; login: string; fullName: string }[]>([]);
// Tags narrow the board too: pick several and a card has to wear all of them.
const byTags = ref<string[]>([]);
const starred = ref(false);

const filtering = computed(
  () =>
    !!byAssignee.value ||
    !!byAuthor.value ||
    !!byPriority.value ||
    byTags.value.length > 0 ||
    starred.value
);

function clearFilters(): void {
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

const filtered = computed(() =>
  issues.value.filter(
    (i) =>
      (!byAssignee.value ||
        (byAssignee.value === 'none' ? !i.assignee : i.assignee?.id === byAssignee.value)) &&
      (!byAuthor.value || i.author?.id === byAuthor.value) &&
      (!byPriority.value || i.priority === byPriority.value) &&
      byTags.value.every((id) => i.tags.some((t) => t.id === id)) &&
      (!starred.value || i.favourite)
  )
);

// Cards that changed under us a moment ago, lit until the animation is done.
const fresh = ref<Set<string>>(new Set());

function flash(issueId: string): void {
  fresh.value = new Set(fresh.value).add(issueId);
  setTimeout(() => {
    const next = new Set(fresh.value);
    next.delete(issueId);
    fresh.value = next;
  }, 2000);
}

// Someone else's work on this board, arriving as it happens. Our own changes are already on screen.
useLive((ev) => {
  const board = current.value;
  if (!board) return;
  // The board's own furniture — its columns, its name, the project's tags — changed in settings.
  if (['state.changed', 'board.changed', 'project.changed', 'tag.changed'].includes(ev.type)) {
    void load(String(route.params.short), true);
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
});
// What this project can tag an issue with: its own tags and the global ones, in the server's order.
const tags = ref<Tag[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const boards = computed(() =>
  [...(project.value?.boards ?? [])].sort((a, b) => a.position - b.position)
);
// The address names a board; without one, the board you were last on here, and failing that the first.
const current = computed(() => {
  const wanted = String(route.params.slug ?? '').toLowerCase();
  if (wanted)
    return boards.value.find((b) => b.slug.toLowerCase() === wanted) ?? boards.value[0] ?? null;
  const short = project.value?.shortName;
  const remembered = short ? boards.value.find((b) => b.slug === lastBoard.get(short)) : null;
  return remembered ?? boards.value[0] ?? null;
});

const openKey = computed(() => String(route.params.key ?? ''));

const issuesOf = (stateId: string): Issue[] =>
  filtered.value.filter((i) => i.stateId === stateId).sort((a, b) => a.position - b.position);

// `quiet` is for a board that is already on screen: a card moved by someone else must not collapse every column into skeletons.
async function loadIssues(boardId: string, quiet = false): Promise<void> {
  const mine = ++issuesRead;
  if (!quiet) issuesLoading.value = true;
  try {
    const rows = await api<Issue[]>(`/boards/${boardId}/issues`);
    // Two board switches in a row can answer out of order; only the newest read may paint.
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

// ── dragging a card ──────────────────────────────────────────────
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

  // The whole column, not just what is on screen: a filter hides cards, and sending only the visible ones would renumber them and leave the rest interleaved.
  const column = issues.value
    .filter((i) => i.stateId === target.stateId && i.id !== moved.id)
    .sort((a, b) => a.position - b.position);
  const at = target.beforeId ? column.findIndex((i) => i.id === target.beforeId) : column.length;
  column.splice(at < 0 ? column.length : at, 0, moved);

  // The board answers to the hand that moved the card; the server is told afterwards and only corrects us if it disagrees.
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

// A new issue is written in the same window it will be read in, and the card appears once it exists.
function issueCreated(created: Issue): void {
  issues.value = [...issues.value, created];
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

// What changed in the view is what the card shows, without reading the whole board again.
function issueChanged(updated: Issue): void {
  issues.value = issues.value.map((i) => (i.id === updated.id ? { ...i, ...updated } : i));
}

function issueGone(id: string): void {
  issues.value = issues.value.filter((i) => i.id !== id);
  closeIssue();
}

// Whatever you end up looking at is what this project opens on next time — and what the address says, so /TEST becomes /TEST/test the moment it is clear which board that is.
watch(current, (board) => {
  const short = project.value?.shortName;
  if (!board || !short) return;
  lastBoard.set(short, board.slug);
  if (!route.params.slug) void router.replace(`/${short}/${board.slug}`);
});

async function load(short: string, quiet = false): Promise<void> {
  const mine = ++projectRead;
  if (!quiet) {
    // A project left on screen while the next one loads is a board you can still click into by mistake.
    loading.value = true;
    project.value = null;
    issues.value = [];
    tags.value = [];
  }
  error.value = null;
  try {
    const [loaded, tagRows] = await Promise.all([
      api<Project>(`/projects/${encodeURIComponent(short)}`),
      api<Tag[]>(`/tags?project=${encodeURIComponent(short)}`),
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

onMounted(() => {
  void load(String(route.params.short));
  void api<{ id: string; login: string; fullName: string }[]>('/people')
    .then((rows) => (people.value = rows))
    .catch(() => {});
});
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
      <select v-model="byAssignee" class="input input--sm filter" aria-label="Filter by assignee">
        <option value="">Assignee</option>
        <option value="none">Nobody</option>
        <option v-for="p in people" :key="p.id" :value="p.id">{{ p.fullName || p.login }}</option>
      </select>
      <select v-model="byAuthor" class="input input--sm filter" aria-label="Filter by author">
        <option value="">Author</option>
        <option v-for="p in people" :key="p.id" :value="p.id">{{ p.fullName || p.login }}</option>
      </select>
      <select
        v-model="byPriority"
        class="input input--sm filter"
        aria-label="Filter by priority"
        :style="{ color: byPriority ? priorityColor(byPriority) : undefined }"
      >
        <option value="">Priority</option>
        <option v-for="p in PRIORITIES" :key="p" :value="p" :style="{ color: priorityColor(p) }">
          {{ p }}
        </option>
      </select>

      <button
        v-for="t in tags"
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
          <template v-if="issuesLoading">
            <span v-for="h in [64, 78]" :key="h" class="sk" :style="{ height: `${h}px` }"></span>
          </template>

          <template v-else>
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
              <div class="card__title">{{ i.summary }}</div>
              <div v-if="i.assignee || i.dueDate" class="card__meta">
                <span v-if="i.assignee" class="card__who">{{ i.assignee.login }}</span>
                <div class="sp"></div>
                <span
                  v-if="dueLabel(i.dueDate)"
                  class="due"
                  :class="{ 'due--late': dueLabel(i.dueDate)?.late }"
                >{{ dueLabel(i.dueDate)?.text }}</span>
              </div>
              <div v-if="i.tags.length" class="card__tags">
                <span
                  v-for="t in i.tags"
                  :key="t.id"
                  class="taglabel taglabel--plain taglabel--sm"
                  :style="{ '--c': t.color }"
                >{{ t.name }}</span>
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
      :tags="tags"
      @close="closeIssue"
      @changed="issueChanged"
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
/* The tag bar already spaces what follows off the header, so neither the body nor the board does it twice. */
.page__body--tags,
.board--tags {
  padding-top: 0;
}
/* A tag in the bar is a switch: once any of them is on, the ones that are off step back rather than disappear. */
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
/* A filter is as wide as what it says, and reads as one of the bar's own controls. */
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
.card {
  user-select: none;
}
.card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.card__who {
  font-size: 12.5px;
  color: var(--text-dim);
}
/* The plus is the only thing that lights up, the way the top bar's links do: no plate behind it. */
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
