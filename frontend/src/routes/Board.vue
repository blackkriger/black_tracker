<script setup lang="ts">
// A board, its columns and the cards in them. Dragging a card is the whole editing surface here: everything else about an issue happens in the view that opens on it.
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import TopBar from '../components/TopBar.vue';
import IssueView from '../components/IssueView.vue';
import { api } from '../lib/api';
import { dueLabel, priorityClass, type Issue } from '../lib/issues';
import { lastBoard, lastProject } from '../lib/lastProject';
import { useLive } from '../lib/live';
import { useSession } from '../lib/session';

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
const session = useSession();
const project = ref<Project | null>(null);
const issues = ref<Issue[]>([]);
const issuesLoading = ref(true);

// The card being carried, and where it would land: the column under the cursor and the card it would go in front of.
const dragId = ref<string | null>(null);
const dropAt = ref<{ stateId: string; beforeId: string | null } | null>(null);

// The column a new issue is being written into, if any.
const creatingIn = ref<string | null>(null);

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
  if (!board || ev.boardId !== board.id) return;
  if (ev.by && ev.by === session.me.value?.login) return;
  if (!ev.type.startsWith('issue.')) return;
  if (ev.type === 'issue.deleted') {
    issues.value = issues.value.filter((i) => i.id !== ev.issueId);
    return;
  }
  void loadIssues(board.id).then(() => {
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
  issues.value.filter((i) => i.stateId === stateId).sort((a, b) => a.position - b.position);

async function loadIssues(boardId: string): Promise<void> {
  issuesLoading.value = true;
  try {
    issues.value = await api<Issue[]>(`/boards/${boardId}/issues`);
  } catch (err) {
    issues.value = [];
    error.value = err instanceof Error ? err.message : 'Could not load the issues.';
  } finally {
    issuesLoading.value = false;
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

  const column = issuesOf(target.stateId).filter((i) => i.id !== moved.id);
  const at = target.beforeId ? column.findIndex((i) => i.id === target.beforeId) : column.length;
  column.splice(at < 0 ? column.length : at, 0, moved);
  if (column.every((i, n) => i.id === issuesOf(target.stateId)[n]?.id)) return;

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

async function load(short: string): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const [loaded, tagRows] = await Promise.all([
      api<Project>(`/projects/${encodeURIComponent(short)}`),
      api<Tag[]>(`/tags?project=${encodeURIComponent(short)}`),
    ]);
    project.value = loaded;
    tags.value = tagRows;
    lastProject.set(loaded.shortName);
  } catch (err) {
    project.value = null;
    tags.value = [];
    error.value = err instanceof Error ? err.message : 'Could not load the project.';
  } finally {
    loading.value = false;
  }
}

onMounted(() => load(String(route.params.short)));
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

    <div v-if="tags.length" class="tagbar">
      <span
        v-for="t in tags"
        :key="t.id"
        class="taglabel taglabel--plain"
        :style="{ '--c': t.color }"
      >{{ t.name }}</span>
    </div>

    <div
      v-if="loading || error || !current"
      class="page__body"
      :class="{ 'page__body--tags': tags.length }"
    >
      <p v-if="loading" class="hint">Loading…</p>
      <div v-else-if="error" class="empty"><span class="empty__g">✕</span>{{ error }}</div>
      <div v-else-if="!current" class="empty"><span class="empty__g">◇</span>This project has no boards.</div>
    </div>

    <div v-if="current" class="board" :class="{ 'board--tags': tags.length }">
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
            >+</button>
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
