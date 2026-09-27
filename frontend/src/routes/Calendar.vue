<script setup lang="ts">
// The year at a glance: the days somebody marked, the deadlines the issues carry, and
// how much work went through each day — for the whole team or for one person.
import { computed, onMounted, ref, watch } from 'vue';
import { ChevronLeft, ChevronRight, X } from 'lucide-vue-next';
import TopBar from '../components/TopBar.vue';
import IssueView from '../components/IssueView.vue';
import MonthGrid from '../components/MonthGrid.vue';
import Select from '../components/Select.vue';
import Dialog from '../components/Dialog.vue';
import { api } from '../lib/api';
import {
  byDay,
  longDate,
  dayKey,
  monthName,
  type Activity,
  type DayInfo,
  type Due,
  type Mark,
} from '../lib/calendar';
import type { IssueTag } from '../lib/issues';
import { usePeople } from '../lib/people';
import { usePanelErrors } from '../lib/panelErrors';
import { useProjects } from '../lib/projects';
import { useSession } from '../lib/session';
import { useLive } from '../lib/live';

const session = useSession();
const { people, load: loadPeople } = usePeople();
const { projects, load: loadProjects } = useProjects();
const { errors, fail, clear } = usePanelErrors();

const now = new Date();
const year = ref(now.getFullYear());
const who = ref('');
const months = Array.from({ length: 12 }, (_, m) => m);
const loading = ref(true);

const marks = ref<Mark[]>([]);
const dues = ref<{ day: string; issues: Due[] }[]>([]);
const activity = ref<Activity[]>([]);

const days = computed<Map<string, DayInfo>>(() => byDay(marks.value, dues.value, activity.value));
const peak = computed(() => Math.max(1, ...[...days.value.values()].map((d) => d.worked)));
const yearMarks = computed(() => [...marks.value].sort((a, b) => a.day.localeCompare(b.day)));

const personChoices = computed(() =>
  people.value.map((p) => ({ value: p.login, label: p.fullName || p.login, color: p.roleColor }))
);
const projectChoices = computed(() => [
  { value: '', label: 'Everything' },
  ...projects.value.map((p) => ({ value: p.shortName, label: p.name })),
]);

async function load(): Promise<void> {
  clear('month');
  const from = dayKey(year.value, 0, 1);
  const to = dayKey(year.value, 11, 31);
  const user = who.value ? `&user=${encodeURIComponent(who.value)}` : '';
  try {
    const got = await api<{
      marks: Mark[];
      dues: { day: string; issues: Due[] }[];
      activity: Activity[];
    }>(`/calendar?from=${from}&to=${to}${user}`);
    marks.value = got.marks;
    dues.value = got.dues;
    activity.value = got.activity;
  } catch (err) {
    fail('month', err, 'Could not read the month.');
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadPeople();
  void loadProjects();
  void load();
});
watch([year, who], () => void load());
useLive((ev) => {
  if (['key-date.changed', 'issue.updated', 'issue.created', 'issue.deleted'].includes(ev.type)) {
    void load();
  }
});

function step(by: number): void {
  year.value += by;
}

// ── one day, opened ──
const picked = ref<string | null>(null);
const title = ref('');
const scope = ref('');
const busy = ref(false);
const pickedDay = computed(() => (picked.value ? days.value.get(picked.value) : null));

function openDay(key: string): void {
  picked.value = key;
  title.value = '';
  scope.value = '';
  clear('day');
}

async function addMark(): Promise<void> {
  const text = title.value.trim();
  if (!text || !picked.value || busy.value) return;
  busy.value = true;
  clear('day');
  try {
    await api('/key-dates', {
      method: 'POST',
      body: { day: picked.value, title: text, project: scope.value || null },
    });
    title.value = '';
    await load();
  } catch (err) {
    fail('day', err);
  } finally {
    busy.value = false;
  }
}

async function removeMark(m: Mark): Promise<void> {
  clear('day');
  try {
    await api(`/key-dates/${m.id}`, { method: 'DELETE' });
    await load();
  } catch (err) {
    fail('day', err);
  }
}

// The window wants the board it sits on and the tags its project can wear; neither is
// on this screen, so both are read when a deadline is opened.
interface OpenIssue {
  key: string;
  project: string;
  board: { id: string; name: string; states: { id: string; name: string; color: string }[] };
}
const open = ref<OpenIssue | null>(null);
const openTags = ref<IssueTag[]>([]);
const openBoards = computed(
  () => projects.value.find((p) => p.shortName === open.value?.project)?.boards ?? []
);

async function openIssue(d: Due): Promise<void> {
  clear('day');
  try {
    const [board, tags] = await Promise.all([
      api<OpenIssue['board']>(`/boards/${d.boardId}`),
      api<IssueTag[]>(`/tags?project=${encodeURIComponent(d.projectShort)}`),
    ]);
    openTags.value = tags;
    open.value = { key: d.key, project: d.projectShort, board };
    picked.value = null;
  } catch (err) {
    fail('day', err, 'Could not open the issue.');
  }
}

function closeIssue(): void {
  open.value = null;
  void load();
}
</script>

<template>
  <div class="page">
    <TopBar />
    <div class="page__body">
      <div class="sheet">
          <section class="panel sheet__wide">
            <header class="panel__h">
              <span class="key year">{{ year }}</span>
              <span class="panel__end">
                <Select
                  v-model="who"
                  :options="personChoices"
                  placeholder="Everyone"
                  keep-placeholder
                  small
                  label="Whose work to shade"
                />
                <button
                  class="btn btn--sm btn--icon btn--ghost"
                  type="button"
                  aria-label="Previous year"
                  @click="step(-1)"
                ><ChevronLeft class="ic" /></button>
                <button
                  class="btn btn--sm btn--icon btn--ghost"
                  type="button"
                  aria-label="Next year"
                  @click="step(1)"
                ><ChevronRight class="ic" /></button>
              </span>
            </header>
            <div class="panel__b year-grid">
              <template v-if="loading">
                <span v-for="n in 12" :key="n" class="sk cal-sk"></span>
              </template>
              <template v-else>
                <div v-for="m in months" :key="m" class="month">
                  <div class="month__h">{{ monthName(year, m) }}</div>
                  <MonthGrid
                    :year="year"
                    :month="m"
                    :days="days"
                    :peak="peak"
                    compact
                    @pick="openDay"
                  />
                </div>
              </template>
            </div>
          </section>
          <div v-if="errors.month" class="err panel__err sheet__wide">{{ errors.month }}</div>

          <section class="panel sheet__wide">
            <header class="panel__h">Marked days</header>
            <div class="panel__b days">
              <template v-if="loading">
                <span v-for="n in 2" :key="n" class="sk sk--line"></span>
              </template>
              <template v-else>
                <button
                  v-for="m in yearMarks"
                  :key="m.id"
                  class="day"
                  type="button"
                  @click="openDay(m.day)"
                >
                  <span class="stamp day__when">{{ longDate(m.day) }}</span>
                  <span v-if="m.project" class="key">{{ m.project.shortName }}</span>
                  <span class="day__title">{{ m.title }}</span>
                </button>
                <div v-if="!yearMarks.length" class="empty empty--sm">
                  <span class="empty__g">◇</span>Nothing marked this year.
                </div>
              </template>
            </div>
          </section>
      </div>
    </div>

    <Dialog v-if="picked" :title="longDate(picked)" :width="460" @close="picked = null">
      <div v-if="pickedDay?.marks.length" class="marks">
        <div v-for="m in pickedDay.marks" :key="m.id" class="mark">
          <span v-if="m.project" class="key">{{ m.project.shortName }}</span>
          <span class="mark__title">{{ m.title }}</span>
          <button
            class="btn btn--sm btn--icon btn--ghost"
            type="button"
            :disabled="!session.canDelete.value"
            :aria-label="`Delete ${m.title}`"
            @click="removeMark(m)"
          ><X class="ic ic--sm" /></button>
        </div>
      </div>

      <div v-if="pickedDay?.dues.length" class="marks">
        <button
          v-for="d in pickedDay.dues"
          :key="d.key"
          class="mark mark--due"
          type="button"
          @click="openIssue(d)"
        >
          <span class="key" :style="{ color: d.color }">{{ d.key }}</span>
          <span class="mark__title">{{ d.summary }}</span>
        </button>
      </div>

      <div class="addrow">
        <input
          v-model="title"
          class="input"
          placeholder="Mark this day…"
          maxlength="120"
          @keydown.enter.prevent="addMark"
        />
        <Select v-model="scope" class="scope" :options="projectChoices" />
        <button class="btn" type="button" :disabled="busy || !title.trim()" @click="addMark">
          Add
        </button>
      </div>
      <div v-if="errors.day" class="err">{{ errors.day }}</div>
    </Dialog>

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
      @deleted="closeIssue"
      @moved="closeIssue"
      @tag-created="openTags = [...openTags, $event]"
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
/* Four months across, two on a narrow window: the year reads as a wall of months. */
.year-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 18px;
}
.month__h {
  padding-bottom: 6px;
  color: var(--text-muted);
  font-size: 11.5px;
}
.year {
  font-size: 15px;
  color: var(--accent);
}
.cal-sk {
  display: block;
  height: 170px;
}
.days {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.day {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 30px;
  padding: 0 8px;
  border: 0;
  background: none;
  color: var(--text-dim);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.day:hover {
  background: var(--card-hover);
  color: var(--text);
}
.day__when {
  flex: 0 0 150px;
}
.marks {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mark {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 30px;
  padding: 0 4px 0 8px;
  border: 1px solid var(--line);
  background: none;
  color: var(--text);
  font-size: 13px;
  text-align: left;
}
.mark--due {
  cursor: pointer;
}
.mark--due:hover {
  border-color: var(--line-2);
}
.mark__title {
  flex: 1 1 auto;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.scope {
  flex: 0 0 150px;
}
</style>
