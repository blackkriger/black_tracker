<script setup lang="ts">
// The work itself, counted: the shape of every board and every priority across the same
// run of statuses, what is late, who carries what and for how long, and how long a finished
// issue took. Every key opens its issue, so a number is never a dead end.
import { computed, onMounted, ref, watch } from 'vue';
import { ChevronDown, ChevronRight, Clock } from 'lucide-vue-next';
import TopBar from '../components/TopBar.vue';
import IssueView from '../components/IssueView.vue';
import RidgeRows, { type RidgeRow } from '../components/RidgeRows.vue';
import Select from '../components/Select.vue';
import { api } from '../lib/api';
import { dayAndMonth } from '../lib/calendar';
import { PRIORITIES, priorityColor, type IssueTag, type Priority } from '../lib/issues';
import { RIDGE_SMOOTH_KERNEL, smoothRidge } from '../lib/ridge';
import { usePanelErrors } from '../lib/panelErrors';
import { usePeople } from '../lib/people';
import { useProjects } from '../lib/projects';
import { settled, useLive } from '../lib/live';
import { ink } from '../lib/theme';

interface Where {
  key: string;
  summary: string;
  projectShort: string;
  boardSlug: string;
  color: string;
}
interface Dated extends Where {
  day: string;
  assignee: string | null;
}
interface Held extends Where {
  stateName: string;
  priority: string;
  due: string | null;
  days: number;
  hands: {
    login: string | null;
    days: number;
    current: boolean;
    states: { name: string; color: string | null; days: number }[];
  }[];
}
interface Person {
  login: string;
  color: string | null;
  open: number;
  late: number;
  closed: number;
  held: number | null;
  issues: Held[];
}
interface Numbers {
  statuses: string[];
  boards: {
    id: string;
    name: string;
    projectShort: string;
    slug: string;
    total: number;
    open: number;
    states: { name: string; color: string; count: number }[];
  }[];
  due: { overdue: Dated[]; soon: Dated[] };
  people: Person[];
  unassigned: number;
  priorities: { name: string; count: number; byState: Record<string, number> }[];
  cycle: {
    median: number | null;
    closed: number;
    months: { month: string; median: number | null; closed: number }[];
  };
}

const { projects, load: loadProjects } = useProjects();
const { errors, fail, clear } = usePanelErrors();
const { nameOf } = usePeople();

const project = ref('');
const status = ref('');
const loading = ref(true);
const data = ref<Numbers | null>(null);
const openPeople = ref<string[]>([]);
const openIssues = ref<string[]>([]);

// The way back to everything is the picker's own placeholder, so it is not listed again.
const projectChoices = computed(() =>
  projects.value.map((p) => ({ value: p.shortName, label: p.name }))
);
const statusChoices = computed(() =>
  (data.value?.statuses ?? []).map((s) => ({ value: s, label: s }))
);

// Each read is numbered, and only the latest one's answer is kept: a filter changed while a
// slower read was still out must not be overwritten by it.
let reads = 0;

async function load(): Promise<void> {
  clear('numbers');
  const mine = ++reads;
  try {
    const q = new URLSearchParams();
    if (project.value) q.set('project', project.value);
    if (status.value) q.set('status', status.value);
    const query = q.toString();
    const got = await api<Numbers>(`/analytics${query ? `?${query}` : ''}`);
    if (mine !== reads) return;
    data.value = got;
  } catch (err) {
    fail('numbers', err, 'Could not count anything.');
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadProjects(), load()]);
});
watch([project, status], () => void load());
const reload = settled(() => void load());
useLive((ev) => {
  if (
    ev.type.startsWith('issue.') ||
    ['state.changed', 'board.changed', 'project.changed', 'role.changed', 'user.changed'].includes(
      ev.type
    )
  ) {
    reload();
  }
});

// ── the two stacks, both read against the same run of statuses ──
const axis = computed(() => data.value?.statuses ?? []);

/** Five samples a status wide, so a run of four reads as hills rather than a zigzag. */
const WEIGHT = RIDGE_SMOOTH_KERNEL.reduce((all, k) => all + k, 0);
function shape(counts: number[]): number[] {
  // The kernel adds up to more than one, so the smoothed run is scaled back to the range
  // the counts themselves are in — otherwise every hill would sit clamped at the ceiling.
  return smoothRidge(counts.flatMap((n) => [n, n, n, n, n])).map((v) => v / WEIGHT);
}

const tallest = computed(() => {
  const all = [
    ...(data.value?.boards ?? []).flatMap((b) => b.states.map((s) => s.count)),
    ...(data.value?.priorities ?? []).flatMap((p) => Object.values(p.byState)),
  ];
  return Math.max(1, ...all);
});

// Narrowed to one status, every board wears that status's colour and counts what stands in
// it — open or not, since Done is as much a status to look at as Review.
const boardRows = computed<RidgeRow[]>(() => {
  const busiest = Math.max(0, ...(data.value?.boards ?? []).map((b) => b.open));
  return (data.value?.boards ?? []).map((b) => {
    const byName = new Map(b.states.map((s) => [s.name, s.count]));
    const tint = status.value ? b.states.find((s) => s.name === status.value)?.color : undefined;
    return {
      key: b.id,
      label: b.name,
      profile: shape(axis.value.map((name) => byName.get(name) ?? 0)),
      value: status.value ? b.total : b.open,
      highlight: !status.value && b.open === busiest && busiest > 0,
      color: tint,
    };
  });
});

const priorityRows = computed<RidgeRow[]>(() => {
  const found = new Map(data.value?.priorities.map((p) => [p.name, p]));
  return PRIORITIES.map((name) => {
    const p = found.get(name);
    return {
      key: name,
      label: name,
      profile: shape(axis.value.map((s) => p?.byState[s] ?? 0)),
      value: p?.count ?? 0,
      color: priorityColor(name as Priority),
    };
  });
});

const longestMonth = computed(() =>
  Math.max(1, ...(data.value?.cycle.months ?? []).map((m) => m.median ?? 0))
);

/** However long it lasted, in the unit that says it plainly, from seconds up to days. */
function days(n: number | null): string {
  if (n === null) return '—';
  const seconds = n * 86400;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(n * 10) / 10}d`;
}

/** The whole of a duration down to the second, for the hover over its rounded figure. */
function exact(n: number | null): string | undefined {
  if (n === null) return undefined;
  let rest = Math.round(n * 86400);
  const parts: string[] = [];
  for (const [unit, size] of [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]] as const) {
    const whole = Math.floor(rest / size);
    rest -= whole * size;
    if (whole || (unit === 's' && !parts.length)) parts.push(`${whole}${unit}`);
  }
  return parts.join(' ');
}
const monthLabel = (month: string): string => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
};

function togglePerson(login: string): void {
  openPeople.value = openPeople.value.includes(login)
    ? openPeople.value.filter((l) => l !== login)
    : [...openPeople.value, login];
}
function toggleIssue(key: string): void {
  openIssues.value = openIssues.value.includes(key)
    ? openIssues.value.filter((k) => k !== key)
    : [...openIssues.value, key];
}

// ── opening an issue from a number ──
interface OpenIssue {
  key: string;
  project: string;
  board: {
    id: string;
    name: string;
    slug: string;
    states: { id: string; name: string; color: string }[];
  };
}
const open = ref<OpenIssue | null>(null);
const openTags = ref<IssueTag[]>([]);
const openBoards = computed(
  () => projects.value.find((p) => p.shortName === open.value?.project)?.boards ?? []
);

async function openIssue(w: Where): Promise<void> {
  const board = projects.value
    .find((p) => p.shortName === w.projectShort)
    ?.boards.find((b) => b.slug === w.boardSlug);
  if (!board) return;
  clear('numbers');
  try {
    const [full, tags] = await Promise.all([
      api<OpenIssue['board']>(`/boards/${board.id}`),
      api<IssueTag[]>(`/tags?project=${encodeURIComponent(w.projectShort)}`),
    ]);
    openTags.value = tags;
    open.value = { key: w.key, project: w.projectShort, board: full };
  } catch (err) {
    fail('numbers', err, 'Could not open the issue.');
  }
}
</script>

<template>
  <div class="page">
    <TopBar />
    <div class="page__body">
      <div class="sheet">
        <section class="panel sheet__wide">
          <header class="panel__h">
            Boards
            <span class="panel__end">
              <Select
                v-model="status"
                :options="statusChoices"
                placeholder="Any status"
                keep-placeholder
                small
                label="Which status to count"
              />
              <Select
                v-model="project"
                :options="projectChoices"
                placeholder="All projects"
                keep-placeholder
                small
                label="Which project to count"
              />
            </span>
          </header>
          <div class="panel__b">
            <div v-if="loading" class="skel">
              <div v-for="n in 3" :key="n" class="skel__ridge">
                <span class="sk sk--line" style="width: 72px"></span>
                <span class="sk sk--line skel__hill"></span>
                <span class="sk sk--line" style="width: 20px"></span>
              </div>
            </div>
            <div v-else-if="!boardRows.length" class="hint faint">No boards to count.</div>
            <RidgeRows v-else :rows="boardRows" :full="tallest">
              <template #axis>
                <span v-for="s in axis" :key="s">{{ s }}</span>
              </template>
            </RidgeRows>
          </div>
        </section>

        <div class="stack">
          <section class="panel">
            <header class="panel__h">
              Deadlines
              <span v-if="data?.due.overdue.length" class="panel__end is-late">
                {{ data.due.overdue.length }} late
              </span>
            </header>
            <div class="panel__b nums nums--table">
              <template v-if="loading">
                <div v-for="w in [62, 48, 70]" :key="w" class="line skel__line">
                  <span class="sk sk--line" style="width: 46px"></span>
                  <span class="sk sk--line" :style="{ width: `${w}%` }"></span>
                  <span class="sk sk--line" style="width: 64px"></span>
                </div>
              </template>
              <button
                v-for="d in [...(data?.due.overdue ?? []), ...(data?.due.soon ?? [])]"
                :key="d.key"
                class="line"
                type="button"
                @click="openIssue(d)"
              >
                <span class="key" :style="{ color: ink(d.color) }">{{ d.key }}</span>
                <span class="line__what">{{ d.summary }}</span>
                <span
                  class="stamp"
                  :class="{ 'is-late': data?.due.overdue.includes(d) }"
                >{{ dayAndMonth(d.day) }}</span>
              </button>
              <div
                v-if="!loading && !data?.due.overdue.length && !data?.due.soon.length"
                class="hint faint"
              >Nothing is due this week.</div>
            </div>
          </section>

          <section class="panel">
            <header class="panel__h">Priorities</header>
            <div class="panel__b">
              <div v-if="loading" class="skel">
                <div v-for="n in 4" :key="n" class="skel__ridge">
                  <span class="sk sk--line" style="width: 64px"></span>
                  <span class="sk sk--line skel__hill"></span>
                  <span class="sk sk--line" style="width: 14px"></span>
                </div>
              </div>
              <RidgeRows v-else :rows="priorityRows" :full="tallest">
                <template #axis>
                  <span v-for="s in axis" :key="s">{{ s }}</span>
                </template>
              </RidgeRows>
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="panel">
            <header class="panel__h">
              Team
              <span class="panel__end who__head">
                <span class="stamp">open</span>
                <span class="stamp">late</span>
                <span class="stamp">closed</span>
                <span class="stamp">held</span>
              </span>
            </header>
            <div class="panel__b nums nums--table">
              <template v-if="loading">
                <div v-for="w in [96, 78]" :key="w" class="who skel__who">
                  <span class="sk sk--line" :style="{ width: `${w}px` }"></span>
                  <span class="sk sk--line skel__n"></span>
                  <span class="sk sk--line skel__n"></span>
                  <span class="sk sk--line skel__n"></span>
                  <span class="sk sk--line skel__n"></span>
                </div>
              </template>
              <template v-for="p in data?.people ?? []" :key="p.login">
                <button class="who who--go" type="button" @click="togglePerson(p.login)">
                  <span class="who__name">
                    <ChevronDown v-if="openPeople.includes(p.login)" class="ic ic--sm" />
                    <ChevronRight v-else class="ic ic--sm" />
                    <span :style="{ color: ink(p.color) }">{{ nameOf(p.login) }}</span>
                  </span>
                  <span class="n">{{ p.open }}</span>
                  <span class="n" :class="{ 'is-late': p.late }">{{ p.late }}</span>
                  <span class="n">{{ p.closed }}</span>
                  <span class="n" :title="exact(p.held)">{{ days(p.held) }}</span>
                </button>
                <div v-if="openPeople.includes(p.login)" class="held">
                  <div v-if="!p.issues.length" class="hint faint">Holding nothing.</div>
                  <template v-for="i in p.issues" :key="i.key">
                    <div class="held__row">
                      <button class="key held__key" type="button" @click="openIssue(i)">
                        <span :style="{ color: ink(i.color) }">{{ i.key }}</span>
                      </button>
                      <span class="held__what">{{ i.summary }}</span>
                      <span class="stamp" :style="{ color: ink(i.color) }">{{ i.stateName }}</span>
                      <button
                        class="held__days"
                        type="button"
                        :title="exact(i.days)"
                        @click="toggleIssue(i.key)"
                      >
                        <Clock class="ic ic--sm" />
                        {{ days(i.days) }}
                      </button>
                    </div>
                    <!-- The latest hands first. Each past stretch says which statuses it saw; the
                         current one does not, its status is already on the line above. -->
                    <div v-if="openIssues.includes(i.key)" class="hands">
                      <template v-for="(h, n) in [...i.hands].reverse()" :key="n">
                        <div class="hands__row">
                          <span :class="{ faint: !h.login }">{{ h.login ? nameOf(h.login) : 'Nobody' }}</span>
                          <span class="n" :title="exact(h.days)">{{ days(h.days) }}</span>
                          <span class="stamp">{{ h.current ? 'still' : '' }}</span>
                        </div>
                        <div v-if="!h.current && h.states.length" class="hands__states">
                          <span
                            v-for="st in [...h.states].reverse()"
                            :key="st.name"
                            class="hands__state"
                            :title="exact(st.days)"
                          >
                            <span :style="{ color: ink(st.color) }">{{ st.name }}</span>
                            {{ days(st.days) }}
                          </span>
                        </div>
                      </template>
                    </div>
                  </template>
                </div>
              </template>
              <div v-if="data?.unassigned" class="who who--loose">
                <span class="faint">Nobody</span>
                <span class="n">{{ data.unassigned }}</span>
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </section>

          <section class="panel">
            <header class="panel__h">
              Time to close
              <span class="panel__end">{{ data?.cycle.closed ?? 0 }}</span>
            </header>
            <div class="panel__b nums">
              <template v-if="loading">
                <span class="sk sk--line" style="width: 84px; height: 28px"></span>
                <div v-for="n in 3" :key="n" class="pri">
                  <span class="sk sk--line" style="width: 64px"></span>
                  <span class="sk sk--line skel__hill"></span>
                  <span class="sk sk--line" style="width: 36px"></span>
                </div>
              </template>
              <div v-else class="big" :title="exact(data?.cycle.median ?? null)">
                {{ days(data?.cycle.median ?? null) }}
              </div>
              <div v-for="m in data?.cycle.months ?? []" :key="m.month" class="pri">
                <span class="pri__name">{{ monthLabel(m.month) }}</span>
                <span class="bar">
                  <span
                    class="bar__part"
                    :style="{ width: `${((m.median ?? 0) / longestMonth) * 100}%` }"
                  ></span>
                </span>
                <span class="n" :title="exact(m.median)">{{ days(m.median) }}</span>
              </div>
              <div v-if="!loading && !data?.cycle.closed" class="hint faint">
                Nothing has been closed yet.
              </div>
            </div>
          </section>

        </div>

        <div v-if="errors.numbers" class="err sheet__wide">{{ errors.numbers }}</div>
      </div>
    </div>

    <IssueView
      v-if="open"
      :key="open.key"
      :issue-key="open.key"
      :board="open.board"
      :boards="openBoards"
      :tags="openTags"
      :project="open.project"
      @close="open = null"
      @changed="load"
      @deleted="open = null"
      @moved="open = null"
    />
  </div>
</template>

<style scoped>
.page__body {
  flex: 1 1 auto;
  min-height: 0;
  padding: var(--space-6) var(--space-5);
  overflow-y: auto;
}
.nums {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.bar {
  display: flex;
  flex: 1 1 auto;
  height: 8px;
  background: var(--bg);
}
.bar__part {
  display: block;
  height: 100%;
  background: var(--accent);
}
/* A row that opens what it counts: ruled like a table rather than boxed on its own. */
.line {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 30px;
  padding: 0 2px;
  border: 0;
  border-top: 1px solid var(--line);
  background: none;
  color: var(--text);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.line:hover {
  background: var(--card-hover);
}
.line__what {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.who {
  display: grid;
  grid-template-columns: 1fr 40px 40px 48px 52px;
  align-items: center;
  gap: 8px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text);
  font-size: 13px;
  text-align: left;
}
.who .n,
.who .stamp {
  text-align: right;
}
.who--go {
  min-height: 26px;
  cursor: pointer;
}
.who--go:hover .who__name {
  color: var(--text);
}
.who__name {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-dim);
}
/* The columns are named in the panel's own header, over the numbers they belong to: the
   header's gutter is four pixels narrower than the body's, hence the nudge. */
.who__head {
  display: grid;
  grid-template-columns: 40px 40px 48px 52px;
  gap: 8px;
  padding-right: 4px;
}
.who__head .stamp {
  text-align: right;
}
/* Ruled like a table: a line between people, none inside what one person is holding. */
.nums--table {
  gap: 0;
}
.who--go {
  padding: 5px 0;
}
.who--go + .who--go,
.held + .who--go {
  border-top: 1px solid var(--line);
}
.who--loose {
  border-top: 1px solid var(--line);
  padding-top: 8px;
  margin-top: 2px;
}
/* What one person is holding, and under an issue, whose hands it passed through. */
.held {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 2px 0 6px 22px;
}
.held__row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
}
.held__key,
.held__days {
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}
.held__key {
  flex: none;
}
.held__days {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  color: var(--text-dim);
  font: 12px var(--font-num);
}
.held__days:hover {
  color: var(--text);
}
.held__what {
  flex: 1 1 auto;
  overflow: hidden;
  color: var(--text-dim);
  white-space: nowrap;
  text-overflow: ellipsis;
}
.hands {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0 0 6px 22px;
  padding-left: 10px;
  border-left: 1px solid var(--line);
  font-size: 12px;
}
.hands__row {
  display: grid;
  grid-template-columns: 1fr 56px 40px;
  gap: 8px;
  color: var(--text-dim);
}
.hands__row .n {
  text-align: right;
}
/* Nested under the person it belongs to, one step in like every level above it. */
.hands__states {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 12px;
  margin-bottom: 4px;
  padding-left: 14px;
  color: var(--text-muted);
  font-size: 11.5px;
}
.hands__state {
  display: inline-flex;
  gap: 5px;
}
.pri {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}
.pri__name {
  flex: 0 0 96px;
}
.pri .n {
  flex: 0 0 52px;
  text-align: right;
}
.big {
  font: 28px/1 var(--font-num);
  color: var(--accent);
}
/* Placeholders drawn in the shape of what they stand for, so nothing moves when it lands. */
.skel {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 6px 2px 0;
}
.skel__ridge {
  display: grid;
  grid-template-columns: 96px 1fr 44px;
  gap: 12px;
  align-items: center;
}
.skel__ridge .sk:last-child {
  justify-self: end;
}
.skel__hill {
  flex: 1 1 auto;
  height: 6px;
}
.skel__line {
  cursor: default;
}
.skel__line:hover {
  background: none;
}
.skel__line .sk:last-child {
  justify-self: end;
}
.skel__who {
  padding: 8px 0;
}
.skel__n {
  justify-self: end;
  width: 18px;
}
</style>
