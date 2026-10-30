<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ChevronDown, ChevronRight, Clock } from 'lucide-vue-next';
import { IssueView } from '../lib/issueView';
import RidgeRows, { type RidgeRow } from '../components/RidgeRows.vue';
import FilterBar from '../components/FilterBar.vue';
import { api } from '../lib/api';
import { filtersOf, filtersQuery, monthFilters, remember, sameQuery, type Filters } from '../lib/filters';
import { dayAndMonth } from '../lib/calendar';
import { PRIORITIES, priorityColor, type IssueTag, type Priority } from '../lib/issues';
import { ridgeShape } from '../lib/ridge';
import { RU_MONTHS_SHORT } from '../lib/calendar';
import { locale } from '../i18n';
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
interface Worker {
  login: string;
  color: string | null;
  days: number;
  issues: (Where & { states: { name: string; color: string | null; days: number }[]; days: number })[];
}
interface Numbers {
  statuses: { name: string; color: string }[];
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
  worked: Worker[];
  unassigned: number;
  priorities: { name: string; count: number; byState: Record<string, number> }[];
  cycle: {
    median: number | null;
    closed: number;
    months: { month: string; median: number | null; closed: number; buckets: number[] }[];
  };
}

const { t } = useI18n();
const { projects, load: loadProjects } = useProjects();
const { errors, fail, clear } = usePanelErrors();
const { nameOf, load: loadPeople } = usePeople();

const route = useRoute();
const router = useRouter();
const base = monthFilters();
const filters = ref<Filters>(filtersOf(route.query, base));
watch(
  filters,
  (now) => {
    remember(now, base);
    const next = filtersQuery(now, base);
    if (!sameQuery(next, route.query as Record<string, unknown>)) {
      void router.replace({ name: 'analytics', query: next });
    }
  },
  { deep: true, immediate: true }
);
watch(
  () => route.query,
  (query) => {
    if (route.name !== 'analytics') return;
    if (!sameQuery(filtersQuery(filters.value, base), query as Record<string, unknown>)) {
      filters.value = filtersOf(query, base);
    }
  }
);
const loading = ref(true);
const data = ref<Numbers | null>(null);
const openPeople = ref<string[]>([]);
const openWorkers = ref<string[]>([]);
const foldedSplits = ref<string[]>([]);
const flippedIssues = ref<string[]>([]);

let reads = 0;

async function load(): Promise<void> {
  clear('numbers');
  const mine = ++reads;
  try {
    const query = new URLSearchParams(filtersQuery(filters.value)).toString();
    const got = await api<Numbers>(`/analytics${query ? `?${query}` : ''}`);
    if (mine !== reads) return;
    data.value = got;
  } catch (err) {
    fail('numbers', err, t('analytics.countFailed'));
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  void loadPeople();
  await Promise.all([loadProjects(), load()]);
});
watch(filters, () => void load(), { deep: true });
const reload = settled(() => void load());
useLive((ev) => {
  if (
    ev.type.startsWith('issue.') ||
    ['history.added', 'state.changed', 'board.changed', 'project.changed', 'role.changed', 'user.changed'].includes(
      ev.type
    )
  ) {
    reload();
  }
}, () => {
  reload();
});

const axis = computed(() => (data.value?.statuses ?? []).map((s) => s.name));

const tallest = computed(() => {
  const all = [
    ...(data.value?.boards ?? []).flatMap((b) => b.states.map((s) => s.count)),
    ...(data.value?.priorities ?? []).flatMap((p) => Object.values(p.byState)),
  ];
  return Math.max(1, ...all);
});

const boardRows = computed<RidgeRow[]>(() => {
  const busiest = Math.max(0, ...(data.value?.boards ?? []).map((b) => b.open));
  return (data.value?.boards ?? []).map((b) => {
    const byName = new Map(b.states.map((s) => [s.name, s.count]));
    const picked = filters.value.states;
    const tint = picked.length === 1 ? b.states.find((s) => s.name === picked[0])?.color : undefined;
    return {
      key: b.id,
      label: b.name,
      profile: ridgeShape(axis.value.map((name) => byName.get(name) ?? 0)),
      value: picked.length ? b.total : b.open,
      highlight: !picked.length && b.open === busiest && busiest > 0,
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
      label: t(`priority.${name}`),
      hint: t(`priority.${name}`),
      profile: ridgeShape(axis.value.map((s) => p?.byState[s] ?? 0)),
      value: p?.count ?? 0,
      color: priorityColor(name as Priority),
    };
  });
});

const CLOSE_AXIS = computed(() =>
  locale.value === 'ru' ? ['<1ч', '<1д', '<3д', '<1н', '<1м', '1м+'] : ['<1h', '<1d', '<3d', '<1w', '<1m', '1m+']
);
const UNITS = computed(() =>
  locale.value === 'ru' ? { s: 'с', m: 'мин', h: 'ч', d: 'д' } : { s: 's', m: 'm', h: 'h', d: 'd' }
);
const closeTallest = computed(() =>
  Math.max(1, ...(data.value?.cycle.months ?? []).flatMap((m) => m.buckets))
);

function days(n: number | null): string {
  if (n === null) return '—';
  const seconds = n * 86400;
  const u = UNITS.value;
  if (seconds < 60) return `${Math.round(seconds)}${u.s}`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}${u.m}`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}${u.h}`;
  return `${(Math.round(n * 10) / 10).toLocaleString(locale.value)}${u.d}`;
}

function exact(n: number | null): string | undefined {
  if (n === null) return undefined;
  let rest = Math.round(n * 86400);
  const parts: string[] = [];
  for (const [unit, size] of [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]] as const) {
    const whole = Math.floor(rest / size);
    rest -= whole * size;
    if (whole || (unit === 's' && !parts.length)) parts.push(`${whole}${UNITS.value[unit]}`);
  }
  return parts.join(' ');
}
const monthLabel = (month: string): string => {
  const [y, m] = month.split('-').map(Number);
  if (locale.value === 'ru') return `${RU_MONTHS_SHORT[m - 1]} ${y}`;
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
};

const closeRows = computed<RidgeRow[]>(() =>
  (data.value?.cycle.months ?? []).map((m) => ({
    key: m.month,
    label: monthLabel(m.month),
    profile: ridgeShape(m.buckets),
    value: days(m.median),
  }))
);

function togglePerson(login: string): void {
  openPeople.value = openPeople.value.includes(login)
    ? openPeople.value.filter((l) => l !== login)
    : [...openPeople.value, login];
}
function toggleWorker(login: string): void {
  openWorkers.value = openWorkers.value.includes(login)
    ? openWorkers.value.filter((l) => l !== login)
    : [...openWorkers.value, login];
}
function toggleSplit(id: string): void {
  foldedSplits.value = foldedSplits.value.includes(id)
    ? foldedSplits.value.filter((k) => k !== id)
    : [...foldedSplits.value, id];
}
const handsOpen = (i: Held): boolean => i.hands.length > 1 !== flippedIssues.value.includes(i.key);
function toggleIssue(key: string): void {
  flippedIssues.value = flippedIssues.value.includes(key)
    ? flippedIssues.value.filter((k) => k !== key)
    : [...flippedIssues.value, key];
}

interface OpenIssue {
  key: string;
  project: string;
  board: {
    id: string;
    name: string;
    slug: string;
    states: { id: string; name: string; color: string }[];
    tagIds: string[];
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
      api<IssueTag[]>('/tags'),
    ]);
    openTags.value = tags.filter((t) => full.tagIds.includes(t.id));
    open.value = { key: w.key, project: w.projectShort, board: full };
  } catch (err) {
    fail('numbers', err, t('me.openFailed'));
  }
}
</script>

<template>
  <div class="page">
    <div class="page__body">
      <div class="sheet">
        <FilterBar v-model="filters" class="sheet__wide" :base="base" />
        <section class="panel sheet__wide">
          <header class="panel__h">{{ t('analytics.boards') }}</header>
          <div class="panel__b">
            <div v-if="loading" class="skel">
              <div v-for="n in 3" :key="n" class="skel__ridge">
                <span class="sk sk--line" style="width: 72px"></span>
                <span class="sk sk--line skel__hill"></span>
                <span class="sk sk--line" style="width: 20px"></span>
              </div>
            </div>
            <div v-else-if="!boardRows.length" class="hint faint">{{ t('analytics.noBoards') }}</div>
            <RidgeRows v-else :rows="boardRows" :full="tallest">
              <template #axis>
                <span v-for="s in axis" :key="s">{{ s }}</span>
              </template>
            </RidgeRows>
          </div>
        </section>

        <section class="panel sheet__wide">
          <header class="panel__h">{{ t('analytics.priorities') }}</header>
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

        <div class="stack">
          <section class="panel">
            <header class="panel__h">
              {{ t('analytics.timeToClose') }}
              <span
                v-if="data?.cycle.median != null"
                class="panel__end"
                :title="exact(data.cycle.median)"
              >{{ days(data.cycle.median) }}</span>
            </header>
            <div class="panel__b">
              <div v-if="loading" class="skel">
                <div v-for="n in 2" :key="n" class="skel__ridge">
                  <span class="sk sk--line" style="width: 64px"></span>
                  <span class="sk sk--line skel__hill"></span>
                  <span class="sk sk--line" style="width: 20px"></span>
                </div>
              </div>
              <div v-else-if="!data?.cycle.closed" class="hint faint">
                {{ t('analytics.nothingClosed') }}
              </div>
              <RidgeRows v-else :rows="closeRows" :full="closeTallest">
                <template #axis>
                  <span v-for="b in CLOSE_AXIS" :key="b">{{ b }}</span>
                </template>
              </RidgeRows>
            </div>
          </section>

          <section class="panel">
            <header class="panel__h">
              {{ t('analytics.deadlines') }}
              <span v-if="data?.due.overdue.length" class="panel__end is-late">
                {{ t('analytics.late', { n: data.due.overdue.length }) }}
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
              >{{ t('analytics.nothingDue') }}</div>
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="panel">
            <header class="panel__h">
              {{ t('analytics.team') }}
              <span class="panel__end who__head">
                <span class="stamp">{{ t('analytics.colOpen') }}</span>
                <span class="stamp">{{ t('analytics.colLate') }}</span>
                <span class="stamp">{{ t('analytics.colClosed') }}</span>
                <span class="stamp">{{ t('analytics.colHeld') }}</span>
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
                    <span v-if="nameOf(p.login) !== p.login" class="who__login">{{ p.login }}</span>
                  </span>
                  <span class="n">{{ p.open }}</span>
                  <span class="n" :class="{ 'is-late': p.late }">{{ p.late }}</span>
                  <span class="n">{{ p.closed }}</span>
                  <span class="n" :title="exact(p.held)">{{ days(p.held) }}</span>
                </button>
                <div v-if="openPeople.includes(p.login)" class="held">
                  <div v-if="!p.issues.length" class="hint faint">{{ t('analytics.holdingNothing') }}</div>
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
                    <div v-if="handsOpen(i)" class="hands">
                      <template v-for="(h, n) in [...i.hands].reverse()" :key="n">
                        <div class="hands__row">
                          <span :class="{ faint: !h.login }">{{ h.login ? nameOf(h.login) : t('fields.nobody') }}</span>
                          <span class="n" :title="exact(h.days)">{{ days(h.days) }}</span>
                          <span class="stamp">{{ h.current ? t('analytics.still') : '' }}</span>
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
                <span class="faint">{{ t('fields.nobody') }}</span>
                <span class="n">{{ data.unassigned }}</span>
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </section>

          <section class="panel">
            <header class="panel__h">
              {{ t('analytics.workedOn') }}
              <span class="panel__end who__head who__head--worked">
                <span class="stamp">{{ t('analytics.colIssues') }}</span>
                <span class="stamp">{{ t('analytics.colTime') }}</span>
              </span>
            </header>
            <div class="panel__b nums nums--table">
              <template v-if="loading">
                <div v-for="w in [96, 78]" :key="w" class="who who--worked skel__who">
                  <span class="sk sk--line" :style="{ width: `${w}px` }"></span>
                  <span class="sk sk--line skel__n"></span>
                  <span class="sk sk--line skel__n"></span>
                </div>
              </template>
              <template v-for="p in data?.worked ?? []" :key="p.login">
                <button class="who who--go who--worked" type="button" @click="toggleWorker(p.login)">
                  <span class="who__name">
                    <ChevronDown v-if="openWorkers.includes(p.login)" class="ic ic--sm" />
                    <ChevronRight v-else class="ic ic--sm" />
                    <span :style="{ color: ink(p.color) }">{{ nameOf(p.login) }}</span>
                    <span v-if="nameOf(p.login) !== p.login" class="who__login">{{ p.login }}</span>
                  </span>
                  <span class="n">{{ p.issues.length }}</span>
                  <span class="n" :title="exact(p.days)">{{ days(p.days) }}</span>
                </button>
                <div v-if="openWorkers.includes(p.login)" class="held">
                  <template v-for="i in p.issues" :key="i.key">
                    <div class="held__row">
                      <button class="key held__key" type="button" @click="openIssue(i)">
                        <span :style="{ color: ink(i.color) }">{{ i.key }}</span>
                      </button>
                      <span class="held__what">{{ i.summary }}</span>
                      <span class="stamp">
                        <template v-for="(st, n) in i.states" :key="st.name">{{ n ? ', ' : ''
                        }}<span :style="{ color: ink(st.color) }">{{ st.name }}</span></template>
                      </span>
                      <button
                        v-if="i.states.length > 1"
                        class="held__days"
                        type="button"
                        :title="exact(i.days)"
                        @click="toggleSplit(`${p.login}:${i.key}`)"
                      >
                        <Clock class="ic ic--sm" />
                        {{ days(i.days) }}
                      </button>
                      <span v-else class="held__time" :title="exact(i.days)">
                        <Clock class="ic ic--sm" />
                        {{ days(i.days) }}
                      </span>
                    </div>
                    <div
                      v-if="i.states.length > 1 && !foldedSplits.includes(`${p.login}:${i.key}`)"
                      class="hands"
                    >
                      <div v-for="st in i.states" :key="st.name" class="hands__row">
                        <span :style="{ color: ink(st.color) }">{{ st.name }}</span>
                        <span class="n" :title="exact(st.days)">{{ days(st.days) }}</span>
                        <span></span>
                      </div>
                    </div>
                  </template>
                </div>
              </template>
              <div v-if="!loading && !data?.worked.length" class="hint faint">
                {{ t('analytics.nothingWorked') }}
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
      @linked="load"
      @deleted="open = null; load()"
      @moved="open = null; load()"
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
.who--worked {
  grid-template-columns: 1fr 48px 52px;
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
.who__login {
  font: 11px/1 var(--font-num);
  color: var(--text-muted);
}
.who__head {
  display: grid;
  grid-template-columns: 40px 40px 48px 52px;
  gap: 8px;
  padding-right: 4px;
}
.who__head--worked {
  grid-template-columns: 48px 52px;
}
.who__head .stamp {
  text-align: right;
}
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
.held__row .stamp {
  flex: none;
  white-space: nowrap;
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
.held__days,
.held__time {
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
@media (max-width: 760px) {
  .panel__h {
    flex-wrap: wrap;
    height: auto;
    min-height: 48px;
    padding-top: 8px;
    padding-bottom: 8px;
  }
  .skel__ridge {
    grid-template-columns: 72px 1fr 36px;
  }
  .who {
    grid-template-columns: minmax(0, 1fr) 32px 32px 40px 44px;
    gap: 6px;
  }
  .who--worked {
    grid-template-columns: minmax(0, 1fr) 40px 44px;
  }
  .who__head {
    grid-template-columns: 32px 32px 40px 44px;
    gap: 6px;
  }
  .who__head--worked {
    grid-template-columns: 40px 44px;
  }
  .who__name {
    min-width: 0;
  }
  .who__login {
    display: none;
  }
}
</style>
