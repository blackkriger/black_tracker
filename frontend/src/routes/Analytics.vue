<script setup lang="ts">
// The work itself, counted: what stands on each board, what is late, who carries what,
// how long a finished issue took, and what nobody has touched in a fortnight. Every key on
// the page opens its issue, so a number is never a dead end.
import { computed, onMounted, ref, watch } from 'vue';
import TopBar from '../components/TopBar.vue';
import IssueView from '../components/IssueView.vue';
import Select from '../components/Select.vue';
import { api } from '../lib/api';
import { dayAndMonth } from '../lib/calendar';
import { PRIORITIES, priorityColor, type IssueTag, type Priority } from '../lib/issues';
import { usePanelErrors } from '../lib/panelErrors';
import { useProjects } from '../lib/projects';
import { useLive } from '../lib/live';

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
interface Stale extends Where {
  stateName: string;
  days: number;
}
interface Numbers {
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
  people: { login: string; color: string | null; open: number; late: number; closed: number }[];
  unassigned: number;
  priorities: { name: string; count: number }[];
  cycle: {
    median: number | null;
    closed: number;
    months: { month: string; median: number | null; closed: number }[];
  };
  stale: Stale[];
}

const { projects, load: loadProjects } = useProjects();
const { errors, fail, clear } = usePanelErrors();

const project = ref('');
const loading = ref(true);
const data = ref<Numbers | null>(null);

const projectChoices = computed(() => [
  { value: '', label: 'All projects' },
  ...projects.value.map((p) => ({ value: p.shortName, label: p.name })),
]);

async function load(): Promise<void> {
  clear('numbers');
  try {
    const q = project.value ? `?project=${encodeURIComponent(project.value)}` : '';
    data.value = await api<Numbers>(`/analytics${q}`);
  } catch (err) {
    fail('numbers', err, 'Could not count anything.');
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadProjects(), load()]);
});
watch(project, () => void load());
useLive((ev) => {
  if (ev.type.startsWith('issue.') || ev.type.startsWith('state.')) void load();
});

// ── how each row is drawn ──
const priorityRows = computed(() => {
  const counts = new Map(data.value?.priorities.map((p) => [p.name, p.count]));
  return PRIORITIES.map((name) => ({
    name,
    count: counts.get(name) ?? 0,
    color: priorityColor(name as Priority),
  }));
});
const mostOfAPriority = computed(() => Math.max(1, ...priorityRows.value.map((p) => p.count)));
const widestBoard = computed(() => Math.max(1, ...(data.value?.boards ?? []).map((b) => b.total)));
const longestMonth = computed(() =>
  Math.max(1, ...(data.value?.cycle.months ?? []).map((m) => m.median ?? 0))
);

const days = (n: number | null): string => (n === null ? '—' : `${Math.round(n * 10) / 10} d`);
const monthLabel = (month: string): string => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
};

// ── opening an issue from a number ──
interface OpenIssue {
  key: string;
  project: string;
  board: { id: string; name: string; slug: string; states: { id: string; name: string; color: string }[] };
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
                v-model="project"
                :options="projectChoices"
                placeholder="All projects"
                keep-placeholder
                small
                label="Which project to count"
              />
            </span>
          </header>
          <div class="panel__b nums">
            <div v-if="loading" class="hint faint">Counting…</div>
            <div v-else-if="!data?.boards.length" class="hint faint">No boards to count.</div>
            <div v-for="b in data?.boards ?? []" v-else :key="b.id" class="load">
              <div class="load__h">
                <span class="key">{{ b.projectShort }}</span>
                <span class="load__name">{{ b.name }}</span>
                <span class="n">{{ b.open }} open</span>
                <span class="stamp">of {{ b.total }}</span>
              </div>
              <div class="bar" :style="{ width: `${(b.total / widestBoard) * 100}%` }">
                <span
                  v-for="s in b.states.filter((x) => x.count)"
                  :key="s.name"
                  class="bar__part"
                  :style="{ flexGrow: s.count, background: s.color }"
                ></span>
              </div>
              <div class="legend">
                <span v-for="s in b.states" :key="s.name" class="legend__i">
                  <span :style="{ color: s.color }">{{ s.name }}</span>
                  <span class="n">{{ s.count }}</span>
                </span>
              </div>
            </div>
          </div>
        </section>

        <div class="stack">
          <section class="panel">
            <header class="panel__h">Deadlines</header>
            <div class="panel__b nums">
              <template v-if="data?.due.overdue.length">
                <div class="sec-h">Overdue</div>
                <button
                  v-for="d in data.due.overdue"
                  :key="d.key"
                  class="line"
                  type="button"
                  @click="openIssue(d)"
                >
                  <span class="key" :style="{ color: d.color }">{{ d.key }}</span>
                  <span class="line__what">{{ d.summary }}</span>
                  <span class="stamp is-late">{{ dayAndMonth(d.day) }}</span>
                </button>
              </template>
              <template v-if="data?.due.soon.length">
                <div class="sec-h">This week</div>
                <button
                  v-for="d in data.due.soon"
                  :key="d.key"
                  class="line"
                  type="button"
                  @click="openIssue(d)"
                >
                  <span class="key" :style="{ color: d.color }">{{ d.key }}</span>
                  <span class="line__what">{{ d.summary }}</span>
                  <span class="stamp">{{ dayAndMonth(d.day) }}</span>
                </button>
              </template>
              <div
                v-if="!loading && !data?.due.overdue.length && !data?.due.soon.length"
                class="hint faint"
              >Nothing is due this week.</div>
            </div>
          </section>

          <section class="panel">
            <header class="panel__h">People</header>
            <div class="panel__b nums">
              <div class="who who--h">
                <span></span>
                <span class="stamp">open</span>
                <span class="stamp">late</span>
                <span class="stamp">closed</span>
              </div>
              <div v-for="p in data?.people ?? []" :key="p.login" class="who">
                <span :style="{ color: p.color ?? undefined }">{{ p.login }}</span>
                <span class="n">{{ p.open }}</span>
                <span class="n" :class="{ 'is-late': p.late }">{{ p.late }}</span>
                <span class="n">{{ p.closed }}</span>
              </div>
              <div v-if="data?.unassigned" class="who who--loose">
                <span class="faint">Nobody</span>
                <span class="n">{{ data.unassigned }}</span>
                <span></span>
                <span></span>
              </div>
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="panel">
            <header class="panel__h">Priorities</header>
            <div class="panel__b nums">
              <div v-for="p in priorityRows" :key="p.name" class="pri">
                <span class="pri__name" :style="{ color: p.color }">{{ p.name }}</span>
                <span class="bar bar--one">
                  <span
                    class="bar__part"
                    :style="{ width: `${(p.count / mostOfAPriority) * 100}%`, background: p.color }"
                  ></span>
                </span>
                <span class="n">{{ p.count }}</span>
              </div>
            </div>
          </section>

          <section class="panel">
            <header class="panel__h">
              Time to close
              <span class="panel__end">{{ data?.cycle.closed ?? 0 }} closed</span>
            </header>
            <div class="panel__b nums">
              <div class="big">{{ days(data?.cycle.median ?? null) }}</div>
              <div v-for="m in data?.cycle.months ?? []" :key="m.month" class="pri">
                <span class="pri__name">{{ monthLabel(m.month) }}</span>
                <span class="bar bar--one">
                  <span
                    class="bar__part"
                    :style="{ width: `${((m.median ?? 0) / longestMonth) * 100}%` }"
                  ></span>
                </span>
                <span class="n">{{ days(m.median) }}</span>
              </div>
              <div v-if="!loading && !data?.cycle.closed" class="hint faint">
                Nothing has been closed yet.
              </div>
            </div>
          </section>

          <section class="panel">
            <header class="panel__h">Untouched</header>
            <div class="panel__b nums">
              <button
                v-for="s in data?.stale ?? []"
                :key="s.key"
                class="line"
                type="button"
                @click="openIssue(s)"
              >
                <span class="key" :style="{ color: s.color }">{{ s.key }}</span>
                <span class="line__what">{{ s.summary }}</span>
                <span class="stamp">{{ s.days }} d</span>
              </button>
              <div v-if="!loading && !data?.stale.length" class="hint faint">
                Everything has been looked at.
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
/* One board: its name over a bar as wide as its share of the busiest board. The
   plain name is taken by the kanban strip, hence its own. */
.load__h {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.load__name {
  margin-right: auto;
}
.bar {
  display: flex;
  height: 8px;
  margin-top: 6px;
  background: var(--bg);
}
.bar__part {
  display: block;
  height: 100%;
}
.bar--one {
  flex: 1 1 auto;
  margin-top: 0;
}
.bar--one .bar__part {
  background: var(--accent);
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin-top: 6px;
  font-size: 12px;
}
.legend__i {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
/* A row that opens what it counts. */
.line {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 28px;
  padding: 0 8px;
  border: 1px solid var(--line);
  background: none;
  color: var(--text);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.line:hover {
  border-color: var(--line-2);
}
.line__what {
  flex: 1 1 auto;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.who {
  display: grid;
  grid-template-columns: 1fr 44px 44px 52px;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.who .n,
.who .stamp {
  text-align: right;
}
.who--h {
  border-bottom: 1px solid var(--line);
  padding-bottom: 6px;
}
.who--loose {
  border-top: 1px solid var(--line);
  padding-top: 8px;
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
</style>
