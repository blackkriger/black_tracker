<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-vue-next';
import BuildsPanel from '../components/BuildsPanel.vue';
import FilterBar from '../components/FilterBar.vue';
import IssueView from '../components/IssueView.vue';
import { api } from '../lib/api';
import { useBoards, type BoardFull } from '../lib/boards';
import { filtersOf, filtersQuery, noFilters, remember, sameQuery, type Filters } from '../lib/filters';
import { PRIORITIES, dueLabel, priorityClass, type Issue, type IssueTag } from '../lib/issues';
import { small, tiny } from '../lib/layout';
import { settled, useLive } from '../lib/live';
import { usePanelErrors } from '../lib/panelErrors';
import { usePeople } from '../lib/people';
import { useProjects } from '../lib/projects';
import { useTags } from '../lib/tags';
import { ink } from '../lib/theme';

interface Row extends Omit<Issue, 'description'> {
  stateName: string;
  stateColor: string;
  resolved: boolean;
  boardName: string;
  boardSlug: string;
  projectShort: string;
}
type Column = 'key' | 'priority' | 'board' | 'status' | 'due' | 'assignee';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { projects, load: loadProjects } = useProjects();
const { nameOf, colorOf, load: loadPeople } = usePeople();
const { tags, load: loadTags } = useTags();
const { boardOf, forget } = useBoards();
const { errors, fail, clear } = usePanelErrors();

const filters = ref<Filters>(filtersOf(route.query));
const q = ref('');
const typed = ref('');
const closed = ref(false);
const sort = ref('');

function fromQuery(): void {
  const query = route.query;
  filters.value = filtersOf(query);
  q.value = String(query.q ?? '');
  typed.value = q.value;
  closed.value = query.closed === '1';
  sort.value = String(query.sort ?? '');
}

function toQuery(): Record<string, string> {
  const out = filtersQuery(filters.value);
  if (q.value) out.q = q.value;
  if (closed.value) out.closed = '1';
  if (sort.value) out.sort = sort.value;
  return out;
}

fromQuery();

let typing: ReturnType<typeof setTimeout> | null = null;
watch(typed, (text) => {
  if (typing) clearTimeout(typing);
  typing = setTimeout(() => (q.value = text.trim()), 250);
});

const rows = ref<Row[]>([]);
const loading = ref(true);
const skBody = ref<HTMLElement | null>(null);
const skRows = ref(6);
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
  } catch (err) {
    if (mine === reads) fail('list', err);
  } finally {
    if (mine === reads) loading.value = false;
  }
}

watch(
  [filters, q, closed, sort],
  () => {
    const next = toQuery();
    remember(filters.value, noFilters());
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

watch([filters, q, closed], () => void load(), {
  deep: true,
});

const live = computed(() => projects.value.filter((p) => !p.archived));

function clearOwn(): void {
  typed.value = '';
  q.value = '';
  closed.value = false;
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
    forget(boardId);
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
    if (ev.type === 'tag.changed') void loadTags(true);
    if (['board.changed', 'state.changed'].includes(ev.type)) forget();
    if (
      ev.type.startsWith('issue.') ||
      ['board.changed', 'state.changed', 'project.changed', 'tag.changed', 'history.added'].includes(ev.type)
    ) {
      reload();
    }
  },
  () => {
    void loadTags(true);
    reload();
  }
);

onMounted(() => {
  remember(filters.value, noFilters());
  const next = toQuery();
  if (!sameQuery(next, route.query as Record<string, unknown>)) {
    void router.replace({ name: 'issues', params: route.params, query: next });
  }
  void loadProjects();
  void loadPeople();
  void loadTags();
  void load();
  void showIssue(openKey.value);
  const body = skBody.value;
  const row = body?.querySelector('tr');
  if (body && row) {
    const room = window.innerHeight - body.getBoundingClientRect().top;
    skRows.value = Math.max(skRows.value, Math.ceil(room / row.getBoundingClientRect().height));
  }
});
</script>

<template>
  <div class="page">
    <div class="page__body">
      <div class="sheet">
        <BuildsPanel class="sheet__wide" :projects="filters.projects" />
        <section class="panel sheet__wide">
          <header class="panel__h">
            {{ t('nav.issues') }}
            <span v-if="!loading" class="panel__end">{{ sorted.length }}</span>
          </header>

          <div class="panel__b list__tools">
            <div class="list__row">
              <span class="search list__search">
                <Search class="ic ic--sm search__i" />
                <input
                  v-model="typed"
                  class="input input--sm search__f"
                  :placeholder="tiny ? t('issues.searchTiny') : small ? t('issues.searchSmall') : t('issues.search')"
                  maxlength="100"
                  :aria-label="t('issues.searchLabel')"
                />
              </span>
              <div class="seg" role="radiogroup" :aria-label="t('issues.shown')">
                <label class="seg__i" :class="{ 'is-on': !closed }">
                  <input v-model="closed" class="sr" type="radio" name="issues-shown" :value="false" />
                  {{ t('issues.open') }}
                </label>
                <label class="seg__i" :class="{ 'is-on': closed }">
                  <input v-model="closed" class="sr" type="radio" name="issues-shown" :value="true" />
                  {{ t('issues.all') }}
                </label>
              </div>
            </div>
            <FilterBar v-model="filters" :dirty="!!q || closed" @clear="clearOwn" />
          </div>

          <div class="panel__table">
            <table class="tbl list">
              <thead>
                <tr>
                  <th class="list__key">
                    <button type="button" :class="{ sorted: sortCol === 'key' }" @click="sortBy('key')">
                      {{ t('issues.key') }} <component :is="arrowOf('key')" class="ic ic--sm" />
                    </button>
                  </th>
                  <th class="list__prio">
                    <button type="button" :class="{ sorted: sortCol === 'priority' }" @click="sortBy('priority')">
                      {{ t('fields.priority') }} <component :is="arrowOf('priority')" class="ic ic--sm" />
                    </button>
                  </th>
                  <th class="list__summary">{{ t('issues.summary') }}</th>
                  <th class="list__board">
                    <button type="button" :class="{ sorted: sortCol === 'board' }" @click="sortBy('board')">
                      {{ t('fields.board') }} <component :is="arrowOf('board')" class="ic ic--sm" />
                    </button>
                  </th>
                  <th class="list__state">
                    <button type="button" :class="{ sorted: sortCol === 'status' }" @click="sortBy('status')">
                      {{ t('fields.status') }} <component :is="arrowOf('status')" class="ic ic--sm" />
                    </button>
                  </th>
                  <th class="list__when">
                    <button type="button" :class="{ sorted: sortCol === 'due' }" @click="sortBy('due')">
                      {{ t('fields.due') }} <component :is="arrowOf('due')" class="ic ic--sm" />
                    </button>
                  </th>
                  <th class="list__who">
                    <button type="button" :class="{ sorted: sortCol === 'assignee' }" @click="sortBy('assignee')">
                      {{ t('fields.assignee') }} <component :is="arrowOf('assignee')" class="ic ic--sm" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody v-if="loading" ref="skBody">
                <tr v-for="n in skRows" :key="n">
                  <td class="list__key"><span class="sk sk--line" style="width: 42px"></span></td>
                  <td class="list__prio"><span class="sk sk--line" style="width: 18px"></span></td>
                  <td class="list__what"><span class="sk sk--line" :style="{ width: `${40 + ((n * 17) % 45)}%` }"></span></td>
                  <td class="list__board"><span class="sk sk--line" style="width: 73px"></span></td>
                  <td class="list__state"><span class="sk sk--line" style="width: 66px"></span></td>
                  <td class="list__when"><span class="sk sk--line" style="width: 40px"></span></td>
                  <td class="list__who"><span class="sk sk--line" style="width: 48px"></span></td>
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
                  <td class="key list__key" :style="{ color: ink(r.stateColor) }">{{ r.key }}</td>
                  <td class="list__prio">
                    <span class="prio" :class="priorityClass(r.priority)" :aria-label="t(`priority.${r.priority}`)">
                      <i></i><i></i><i></i><i></i>
                    </span>
                  </td>
                  <td class="list__what">
                    <span class="list__text">{{ r.summary }}</span>
                    <span
                      v-for="tag in r.tags"
                      :key="tag.id"
                      class="taglabel taglabel--plain taglabel--sm list__tag"
                      :style="{ '--c': tag.color }"
                    >{{ tag.name }}</span>
                  </td>
                  <td class="list__dim list__board">{{ r.boardName }}</td>
                  <td class="list__state" :style="{ color: ink(r.stateColor) }">{{ r.stateName }}</td>
                  <td class="stamp list__when" :class="{ 'is-late': dueLabel(r.dueDate)?.late && !r.resolved }">
                    {{ dueLabel(r.dueDate)?.text }}
                  </td>
                  <td class="list__who" :style="{ color: ink(colorOf(r.assignee?.login)) }">
                    {{ r.assignee ? nameOf(r.assignee.login) : '' }}
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-if="!loading && !sorted.length" class="hint faint list__none">{{ t('issues.nothingFound') }}</div>
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
      @linked="reload"
      @moved="reload(); showIssue(open.key)"
      @deleted="closeIssue(); reload()"
    />

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
  flex: 1 1 0;
  min-width: 0;
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
.seg {
  display: inline-flex;
  height: 30px;
  border: 1px solid var(--line-2);
  background: var(--bg);
  border-radius: var(--radius);
}
.seg__i {
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  color: var(--text-muted);
  font-size: 13px;
  cursor: pointer;
}
.seg__i + .seg__i {
  border-left: 1px solid var(--line-2);
}
.seg__i:hover,
.seg__i.is-on {
  color: var(--text);
}
.seg__i:has(input:focus-visible) {
  box-shadow: var(--focus-ring);
}
.list {
  table-layout: auto;
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
.panel__table {
  container-type: inline-size;
}
@container (max-width: 720px) {
  .list,
  .list thead,
  .list tbody {
    display: block;
  }
  .list thead tr {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    border-bottom: 1px solid var(--line);
  }
  .list th {
    height: 32px;
    border-bottom: 0;
  }
  .list th.list__summary {
    display: none;
  }
  .list tbody tr {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    grid-template-areas:
      'key prio . state'
      'what what what what'
      'board when . who';
    align-items: center;
    gap: 6px 10px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--line);
  }
  .list tbody td {
    height: auto;
    padding: 0;
    border-bottom: 0;
  }
  .list tbody .list__key {
    grid-area: key;
  }
  .list tbody .list__prio {
    grid-area: prio;
  }
  .list tbody .list__what {
    grid-area: what;
    width: auto;
    max-width: none;
    white-space: normal;
  }
  .list tbody .list__board {
    grid-area: board;
  }
  .list tbody .list__state {
    grid-area: state;
    justify-self: end;
  }
  .list tbody .list__when {
    grid-area: when;
  }
  .list tbody .list__who {
    grid-area: who;
    justify-self: end;
  }
}
</style>
