<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-vue-next';
import DateRangePicker from '../components/DateRangePicker.vue';
import Dialog from '../components/Dialog.vue';
import FilterMenu from '../components/FilterMenu.vue';
import IssueView from '../components/IssueView.vue';
import Select from '../components/Select.vue';
import { api } from '../lib/api';
import { PRIORITIES, dueLabel, priorityClass, type Issue, type IssueTag } from '../lib/issues';
import { settled, useLive } from '../lib/live';
import { usePanelErrors } from '../lib/panelErrors';
import { usePeople } from '../lib/people';
import { useProjects } from '../lib/projects';
import { useSession } from '../lib/session';
import { ink } from '../lib/theme';

interface Row extends Omit<Issue, 'description'> {
  stateName: string;
  stateColor: string;
  resolved: boolean;
  boardName: string;
  boardSlug: string;
  projectShort: string;
}
interface TagOption extends IssueTag {
  boardIds: string[];
}
interface BoardFull {
  id: string;
  name: string;
  slug: string;
  states: { id: string; name: string; color: string }[];
  tagIds: string[];
  defaultStateId?: string | null;
  defaultAssigneeId?: string | null;
}
type Column = 'key' | 'priority' | 'board' | 'status' | 'due' | 'assignee';

const route = useRoute();
const router = useRouter();
const session = useSession();
const { projects, load: loadProjects } = useProjects();
const { people, nameOf, colorOf, load: loadPeople } = usePeople();
const { errors, fail, clear } = usePanelErrors();

const KEPT = 'tracker:issues-projects';
const listOf = (v: unknown): string[] => (typeof v === 'string' && v ? v.split(',').filter(Boolean) : []);

function keptProjects(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEPT) ?? '[]') as string[];
  } catch {
    return [];
  }
}

const byProjects = ref<string[]>([]);
const byStates = ref<string[]>([]);
const byAssignees = ref<string[]>([]);
const byAuthors = ref<string[]>([]);
const byTags = ref<string[]>([]);
const q = ref('');
const typed = ref('');
const closed = ref(false);
const period = ref({ from: '', to: '' });
const sort = ref('');

function keepProjects(): void {
  try {
    localStorage.setItem(KEPT, JSON.stringify(byProjects.value));
  } catch {}
}

function fromQuery(): void {
  const query = route.query;
  byProjects.value = query.projects !== undefined ? listOf(query.projects) : keptProjects();
  byStates.value = listOf(query.states);
  byAssignees.value = listOf(query.assignees);
  byAuthors.value = listOf(query.authors);
  byTags.value = listOf(query.tags);
  q.value = String(query.q ?? '');
  typed.value = q.value;
  closed.value = query.closed === '1';
  period.value = { from: String(query.from ?? ''), to: String(query.to ?? '') };
  sort.value = String(query.sort ?? '');
}

function toQuery(): Record<string, string> {
  const out: Record<string, string> = {};
  if (byProjects.value.length) out.projects = byProjects.value.join(',');
  if (byStates.value.length) out.states = byStates.value.join(',');
  if (byAssignees.value.length) out.assignees = byAssignees.value.join(',');
  if (byAuthors.value.length) out.authors = byAuthors.value.join(',');
  if (byTags.value.length) out.tags = byTags.value.join(',');
  if (q.value) out.q = q.value;
  if (closed.value) out.closed = '1';
  if (period.value.from) out.from = period.value.from;
  if (period.value.to) out.to = period.value.to;
  if (sort.value) out.sort = sort.value;
  return out;
}

const sameQuery = (a: Record<string, unknown>, b: Record<string, unknown>): boolean =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

fromQuery();

let typing: ReturnType<typeof setTimeout> | null = null;
watch(typed, (text) => {
  if (typing) clearTimeout(typing);
  typing = setTimeout(() => (q.value = text.trim()), 250);
});

const rows = ref<Row[]>([]);
const loading = ref(true);
let reads = 0;

async function load(): Promise<void> {
  const mine = ++reads;
  clear('list');
  const query = new URLSearchParams(toQuery());
  query.delete('sort');
  try {
    const got = await api<Row[]>(`/issues?${query}`);
    if (mine !== reads) return;
    rows.value = got;
    const alive = new Set(got.map((r) => r.id));
    picked.value = new Set([...picked.value].filter((id) => alive.has(id)));
  } catch (err) {
    if (mine === reads) fail('list', err);
  } finally {
    if (mine === reads) loading.value = false;
  }
}

watch(
  [byProjects, byStates, byAssignees, byAuthors, byTags, q, closed, period, sort],
  () => {
    const next = toQuery();
    keepProjects();
    if (!sameQuery(next, route.query as Record<string, unknown>)) {
      void router.replace({ name: 'issues', params: route.params, query: next });
    }
  },
  { deep: true }
);

watch(
  () => route.query,
  () => {
    if (route.name !== 'issues') return;
    if (!sameQuery(toQuery(), route.query as Record<string, unknown>)) fromQuery();
  }
);

watch([byProjects, byStates, byAssignees, byAuthors, byTags, q, closed, period], () => void load(), {
  deep: true,
});

const live = computed(() => projects.value.filter((p) => !p.archived));
const scope = computed(() =>
  byProjects.value.length ? live.value.filter((p) => byProjects.value.includes(p.shortName)) : live.value
);

const boardCache = ref(new Map<string, BoardFull>());
async function boardOf(id: string): Promise<BoardFull> {
  const kept = boardCache.value.get(id);
  if (kept) return kept;
  const got = await api<BoardFull>(`/boards/${id}`);
  boardCache.value = new Map(boardCache.value).set(id, got);
  return got;
}
watch(
  scope,
  (now) => {
    for (const p of now) for (const b of p.boards) void boardOf(b.id).catch(() => {});
  },
  { immediate: true }
);

const tags = ref<TagOption[]>([]);
async function loadTags(): Promise<void> {
  try {
    tags.value = await api<TagOption[]>('/tags');
  } catch {}
}

const projectChoices = computed(() =>
  live.value.map((p) => ({ value: p.shortName, label: `${p.shortName} ${p.name}` }))
);
const stateChoices = computed(() => {
  const seen = new Map<string, string>();
  for (const p of scope.value)
    for (const b of p.boards)
      for (const s of boardCache.value.get(b.id)?.states ?? []) if (!seen.has(s.name)) seen.set(s.name, s.color);
  return [...seen].map(([name, color]) => ({ value: name, label: name, color }));
});
const personChoices = computed(() =>
  people.value.map((p) => ({ value: p.login, label: p.fullName || p.login, color: p.roleColor }))
);
const assigneeChoices = computed(() => [{ value: '-', label: 'Nobody' }, ...personChoices.value]);
const tagChoices = computed(() => {
  const boards = new Set(scope.value.flatMap((p) => p.boards.map((b) => b.id)));
  return tags.value.filter((t) => t.boardIds.some((id) => boards.has(id)));
});

function toggleTag(id: string): void {
  byTags.value = byTags.value.includes(id) ? byTags.value.filter((t) => t !== id) : [...byTags.value, id];
}

const anyFilter = computed(
  () =>
    byProjects.value.length > 0 ||
    byStates.value.length > 0 ||
    byAssignees.value.length > 0 ||
    byAuthors.value.length > 0 ||
    byTags.value.length > 0 ||
    !!q.value ||
    closed.value ||
    !!period.value.from ||
    !!period.value.to
);

function clearAll(): void {
  byProjects.value = [];
  byStates.value = [];
  byAssignees.value = [];
  byAuthors.value = [];
  byTags.value = [];
  typed.value = '';
  q.value = '';
  closed.value = false;
  period.value = { from: '', to: '' };
}

const numberOf = (key: string): number => Number(key.split('-')[1] ?? 0);
const sortCol = computed(() => sort.value.replace(/^-/, '') as Column | '');
const sortDown = computed(() => sort.value.startsWith('-'));

function sortBy(col: Column): void {
  if (sortCol.value !== col) sort.value = col;
  else if (!sortDown.value) sort.value = `-${col}`;
  else sort.value = '';
}

const arrowOf = (col: Column) => (sortCol.value !== col ? ArrowUpDown : sortDown.value ? ArrowDown : ArrowUp);

const sorted = computed(() => {
  const col = sortCol.value;
  if (!col) return rows.value;
  const dir = sortDown.value ? -1 : 1;
  const text = (a: string, b: string) => a.localeCompare(b);
  const last = (a: string | null | undefined, b: string | null | undefined, then: () => number) =>
    !a && !b ? 0 : !a ? 1 : !b ? -1 : then() * dir;
  return [...rows.value].sort((a, b) => {
    if (col === 'key')
      return (text(a.projectShort, b.projectShort) || numberOf(a.key) - numberOf(b.key)) * dir;
    if (col === 'priority') return (PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority)) * dir;
    if (col === 'board') return text(a.boardName, b.boardName) * dir;
    if (col === 'status') return text(a.stateName, b.stateName) * dir;
    if (col === 'due') return last(a.dueDate, b.dueDate, () => text(a.dueDate ?? '', b.dueDate ?? ''));
    return last(a.assignee?.login, b.assignee?.login, () =>
      text(nameOf(a.assignee?.login), nameOf(b.assignee?.login))
    );
  });
});

const picked = ref(new Set<string>());
const pickedRows = computed(() => rows.value.filter((r) => picked.value.has(r.id)));
const allPicked = computed(() => sorted.value.length > 0 && sorted.value.every((r) => picked.value.has(r.id)));

function togglePick(id: string): void {
  const next = new Set(picked.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  picked.value = next;
}
function toggleAll(): void {
  picked.value = allPicked.value ? new Set() : new Set(sorted.value.map((r) => r.id));
}

watch(pickedRows, (now) => {
  for (const id of new Set(now.map((r) => r.boardId))) void boardOf(id).catch(() => {});
});

const bulkStates = computed(() => {
  const boards = [...new Set(pickedRows.value.map((r) => r.boardId))].map((id) => boardCache.value.get(id));
  if (!boards.length || boards.some((b) => !b)) return [];
  const [first, ...others] = boards as BoardFull[];
  return first.states
    .filter((s) => others.every((b) => b.states.some((o) => o.name === s.name)))
    .map((s) => ({ value: s.name, label: s.name, color: s.color }));
});
const pickedProject = computed(() => {
  const shorts = new Set(pickedRows.value.map((r) => r.projectShort));
  return shorts.size === 1 ? live.value.find((p) => shorts.has(p.shortName)) ?? null : null;
});
const moveChoices = computed(() =>
  (pickedProject.value?.boards ?? []).map((b) => ({ value: b.id, label: `${pickedProject.value?.shortName} ${b.name}` }))
);

const busy = ref(false);

async function each(work: (r: Row) => Promise<unknown> | null): Promise<void> {
  busy.value = true;
  clear('list');
  try {
    for (const r of pickedRows.value) {
      const job = work(r);
      if (job) await job;
    }
  } catch (err) {
    fail('list', err);
  } finally {
    busy.value = false;
    await load();
  }
}

const patch = (r: Row, body: Record<string, unknown>) => api(`/issues/${r.id}`, { method: 'PATCH', body });

function bulkStatus(name: string): void {
  void each((r) => {
    const state = boardCache.value.get(r.boardId)?.states.find((s) => s.name === name);
    return state && state.id !== r.stateId ? patch(r, { stateId: state.id }) : null;
  });
}
function bulkAssignee(login: string): void {
  const id = login === '-' ? null : (people.value.find((p) => p.login === login)?.id ?? null);
  void each((r) => ((r.assignee?.id ?? null) !== id ? patch(r, { assigneeId: id }) : null));
}
function bulkMove(boardId: string): void {
  void each((r) => (r.boardId !== boardId ? patch(r, { boardId }) : null));
}
function bulkDue(day: string | null): void {
  void each((r) => (r.dueDate !== day ? patch(r, { dueDate: day }) : null));
}

const deleting = ref(false);
async function bulkDelete(): Promise<void> {
  deleting.value = false;
  await each((r) => api(`/issues/${r.id}`, { method: 'DELETE' }));
  picked.value = new Set();
}

const openKey = computed(() => (route.name === 'issues' && route.params.key ? String(route.params.key) : null));
const open = ref<{ key: string; project: string; board: BoardFull } | null>(null);

async function showIssue(key: string | null): Promise<void> {
  if (!key) {
    open.value = null;
    return;
  }
  try {
    let row = rows.value.find((r) => r.key === key);
    let boardId = row?.boardId;
    let project = row?.projectShort;
    if (!boardId) {
      const got = await api<Issue>(`/issues/${encodeURIComponent(key)}`);
      boardId = got.boardId;
      project = projects.value.find((p) => p.id === got.projectId)?.shortName;
    }
    boardCache.value.delete(boardId);
    open.value = { key, project: project ?? '', board: await boardOf(boardId) };
  } catch (err) {
    fail('list', err);
  }
}
watch(openKey, (key) => void showIssue(key));

const boardsOf = (short: string) => live.value.find((p) => p.shortName === short)?.boards ?? [];
const tagsOf = (board: BoardFull): IssueTag[] => tags.value.filter((t) => board.tagIds.includes(t.id));

function openIssue(r: Row): void {
  void router.push({ name: 'issues', params: { key: r.key }, query: route.query });
}
function closeIssue(): void {
  void router.push({ name: 'issues', params: {}, query: route.query });
}

const reload = settled(() => void load());
useLive(
  (ev) => {
    if (ev.type === 'tag.changed') void loadTags();
    if (['board.changed', 'state.changed'].includes(ev.type)) boardCache.value = new Map();
    if (ev.type.startsWith('issue.') || ['board.changed', 'state.changed', 'project.changed'].includes(ev.type)) {
      reload();
    }
  },
  () => {
    void loadTags();
    reload();
  }
);

onMounted(() => {
  keepProjects();
  const next = toQuery();
  if (!sameQuery(next, route.query as Record<string, unknown>)) {
    void router.replace({ name: 'issues', params: route.params, query: next });
  }
  void loadProjects();
  void loadPeople();
  void loadTags();
  void load();
  void showIssue(openKey.value);
});
</script>

<template>
  <div class="page">
    <div class="page__body">
      <div class="sheet">
        <section class="panel sheet__wide">
          <header class="panel__h">
            Issues
            <span v-if="!loading" class="panel__end">{{ sorted.length }}</span>
          </header>

          <div class="panel__b list__tools">
            <div class="list__row">
              <span class="search list__search">
                <Search class="ic ic--sm search__i" />
                <input
                  v-model="typed"
                  class="input input--sm search__f"
                  placeholder="Search by summary or key…"
                  maxlength="100"
                  aria-label="Search the issues"
                />
              </span>
              <label class="flag">
                <input v-model="closed" type="checkbox" />
                With closed
              </label>
            </div>
            <div class="list__row">
              <FilterMenu v-model="byProjects" label="Projects" :options="projectChoices" />
              <FilterMenu v-model="byStates" label="Status" :options="stateChoices" />
              <FilterMenu v-model="byAssignees" label="Assignee" :options="assigneeChoices" />
              <FilterMenu v-model="byAuthors" label="Author" :options="personChoices" />
              <span class="list__sep" aria-hidden="true"></span>
              <span class="list__period" :class="{ 'is-on': period.from || period.to }">
                <DateRangePicker :from="period.from" :to="period.to" @change="period = $event" />
              </span>
              <button
                v-for="t in tagChoices"
                :key="t.id"
                class="taglabel taglabel--plain taglabel--pick"
                :class="{ 'is-off': byTags.length && !byTags.includes(t.id) }"
                type="button"
                :aria-pressed="byTags.includes(t.id)"
                :style="{ '--c': t.color }"
                @click="toggleTag(t.id)"
              >{{ t.name }}</button>
              <button v-if="anyFilter" class="btn btn--sm btn--ghost" type="button" @click="clearAll">
                Clear all
              </button>
            </div>
          </div>

          <div v-if="picked.size" class="list__bulk">
            <span>Selected: {{ picked.size }}</span>
            <Select
              model-value=""
              :options="bulkStates"
              placeholder="Status…"
              small
              :disabled="busy || !bulkStates.length"
              @update:model-value="bulkStatus"
            />
            <Select
              model-value=""
              :options="assigneeChoices"
              placeholder="Assignee…"
              small
              :disabled="busy"
              @update:model-value="bulkAssignee"
            />
            <Select
              model-value=""
              :options="moveChoices"
              placeholder="Move to…"
              small
              :disabled="busy || !moveChoices.length"
              @update:model-value="bulkMove"
            />
            <input
              class="input input--sm list__due"
              type="date"
              :disabled="busy"
              @change="bulkDue(($event.target as HTMLInputElement).value || null); ($event.target as HTMLInputElement).value = ''"
            />
            <button class="btn btn--sm btn--ghost" type="button" :disabled="busy" @click="bulkDue(null)">
              Clear due
            </button>
            <div class="sp"></div>
            <button
              v-if="session.canDelete.value"
              class="btn btn--sm btn--ghost list__delete"
              type="button"
              :disabled="busy"
              @click="deleting = true"
            >Delete</button>
            <button class="btn btn--sm btn--ghost" type="button" @click="picked = new Set()">
              Clear selection
            </button>
          </div>

          <div class="panel__table">
            <table class="tbl list">
              <thead>
                <tr>
                  <th class="list__pick">
                    <input
                      type="checkbox"
                      :checked="allPicked"
                      :disabled="!sorted.length"
                      aria-label="Select all"
                      @change="toggleAll"
                    />
                  </th>
                  <th class="list__key">
                    <button type="button" :class="{ sorted: sortCol === 'key' }" @click="sortBy('key')">
                      Key <component :is="arrowOf('key')" class="ic ic--sm" />
                    </button>
                  </th>
                  <th class="list__prio">
                    <button type="button" :class="{ sorted: sortCol === 'priority' }" @click="sortBy('priority')">
                      Priority <component :is="arrowOf('priority')" class="ic ic--sm" />
                    </button>
                  </th>
                  <th>Summary</th>
                  <th class="list__board">
                    <button type="button" :class="{ sorted: sortCol === 'board' }" @click="sortBy('board')">
                      Board <component :is="arrowOf('board')" class="ic ic--sm" />
                    </button>
                  </th>
                  <th class="list__state">
                    <button type="button" :class="{ sorted: sortCol === 'status' }" @click="sortBy('status')">
                      Status <component :is="arrowOf('status')" class="ic ic--sm" />
                    </button>
                  </th>
                  <th class="list__due-h">
                    <button type="button" :class="{ sorted: sortCol === 'due' }" @click="sortBy('due')">
                      Due <component :is="arrowOf('due')" class="ic ic--sm" />
                    </button>
                  </th>
                  <th class="list__who">
                    <button type="button" :class="{ sorted: sortCol === 'assignee' }" @click="sortBy('assignee')">
                      Assignee <component :is="arrowOf('assignee')" class="ic ic--sm" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody v-if="loading">
                <tr v-for="n in 6" :key="n">
                  <td class="list__pick"><span class="sk sk--line" style="width: 13px"></span></td>
                  <td><span class="sk sk--line" style="width: 46px"></span></td>
                  <td><span class="sk sk--line" style="width: 15px"></span></td>
                  <td><span class="sk sk--line" :style="{ width: `${40 + ((n * 17) % 45)}%` }"></span></td>
                  <td><span class="sk sk--line" style="width: 70px"></span></td>
                  <td><span class="sk sk--line" style="width: 60px"></span></td>
                  <td><span class="sk sk--line" style="width: 44px"></span></td>
                  <td><span class="sk sk--line" style="width: 70px"></span></td>
                </tr>
              </tbody>
              <tbody v-else>
                <tr
                  v-for="r in sorted"
                  :key="r.id"
                  class="list__row-i"
                  :class="{ 'is-closed': r.resolved }"
                  @click="openIssue(r)"
                >
                  <td class="list__pick" @click.stop>
                    <input
                      type="checkbox"
                      :checked="picked.has(r.id)"
                      :aria-label="`Select ${r.key}`"
                      @change="togglePick(r.id)"
                    />
                  </td>
                  <td class="key" :style="{ color: ink(r.stateColor) }">{{ r.key }}</td>
                  <td>
                    <span class="prio" :class="priorityClass(r.priority)" :aria-label="r.priority">
                      <i></i><i></i><i></i><i></i>
                    </span>
                  </td>
                  <td class="list__what">
                    <span class="list__text">{{ r.summary }}</span>
                    <span
                      v-for="t in r.tags"
                      :key="t.id"
                      class="taglabel taglabel--plain taglabel--sm list__tag"
                      :style="{ '--c': t.color }"
                    >{{ t.name }}</span>
                  </td>
                  <td class="list__dim">{{ r.boardName }}</td>
                  <td :style="{ color: ink(r.stateColor) }">{{ r.stateName }}</td>
                  <td class="stamp" :class="{ 'is-late': dueLabel(r.dueDate)?.late && !r.resolved }">
                    {{ dueLabel(r.dueDate)?.text }}
                  </td>
                  <td :style="{ color: ink(colorOf(r.assignee?.login)) }">
                    {{ r.assignee ? nameOf(r.assignee.login) : '' }}
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-if="!loading && !sorted.length" class="hint faint list__none">Nothing found.</div>
          </div>
        </section>
        <div v-if="errors.list" class="err sheet__wide">{{ errors.list }}</div>
      </div>
    </div>

    <IssueView
      v-if="open"
      :key="open.key"
      :issue-key="open.key"
      :board="open.board"
      :boards="boardsOf(open.project)"
      :tags="tagsOf(open.board)"
      :project="open.project"
      @close="closeIssue"
      @changed="reload"
      @moved="reload(); showIssue(open.key)"
      @deleted="closeIssue(); reload()"
    />

    <Dialog v-if="deleting" :title="`Delete ${picked.size} issues`" @close="deleting = false">
      <p>This takes their comments, files and history with them. This cannot be undone.</p>
      <template #footer>
        <button class="btn" type="button" @click="deleting = false">Cancel</button>
        <button class="btn btn--danger" type="button" @click="bulkDelete">Delete issues</button>
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.page__body {
  padding: var(--space-6) var(--space-5);
}
.list__tools {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-bottom: 14px;
}
.list__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.list__search {
  flex: 1 1 auto;
}
.list__search .search__f {
  width: 100%;
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
  padding-left: 25px;
}
.search__f::placeholder {
  color: var(--text-muted);
}
.flag {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.taglabel--pick {
  border: 0;
  cursor: pointer;
  font-family: inherit;
}
.taglabel--pick.is-off {
  opacity: 0.35;
}
.list__sep {
  flex: none;
  width: 1px;
  height: 16px;
  margin: 0 6px;
  background: var(--line-2);
}
.list__period:not(.is-on) :deep(.drp__trigger) {
  color: var(--text-muted);
}
.list__bulk {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 20px;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  color: var(--text);
  font-size: 13px;
}
.list__due {
  width: auto;
}
.list__delete:hover:enabled {
  color: var(--danger-text);
}
.list {
  table-layout: auto;
}
.list__pick {
  width: 28px;
  padding-right: 0;
}
.list__row-i {
  cursor: pointer;
}
.list__what {
  width: 100%;
  max-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.list__text {
  margin-right: 6px;
}
.list__tag {
  margin-right: 4px;
  vertical-align: middle;
}
.list__dim {
  color: var(--text-dim);
}
.is-closed .list__text {
  color: var(--text-muted);
  text-decoration: line-through;
}
.is-late {
  color: var(--danger-text);
}
.list__none {
  padding: 16px 12px 4px;
}
.prio {
  margin-left: 0;
}
</style>
