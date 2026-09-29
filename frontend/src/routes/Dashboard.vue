<script setup lang="ts">
// Where the tracker opens: what is on your own hands, and under it the calendar — three
// months of it by default, the whole year when it is asked for. The days somebody marked,
// the deadlines the issues carry, and how much work went through each day.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  AtSign,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ContactRound,
  Smile,
  Star,
} from 'lucide-vue-next';
import TopBar from '../components/TopBar.vue';
import IssueView from '../components/IssueView.vue';
import DayWindow from '../components/DayWindow.vue';
import MonthGrid from '../components/MonthGrid.vue';
import Select from '../components/Select.vue';
import { api } from '../lib/api';
import {
  byDay,
  dayAndMonth,
  longDate,
  dayKey,
  daysInMonth,
  monthName,
  spanLabel,
  type Activity,
  type DayInfo,
  type DayMentions,
  type Due,
  type Mark,
} from '../lib/calendar';
import type { IssueTag } from '../lib/issues';
import { priorityColor, stampAt, type Priority } from '../lib/issues';
import { usePeople } from '../lib/people';
import { useFocus } from '../lib/focus';
import { useNotices, type Notice } from '../lib/notices';
import { usePanelErrors } from '../lib/panelErrors';
import { useProjects } from '../lib/projects';
import { useSession } from '../lib/session';
import { settled, useLive } from '../lib/live';
import { ink } from '../lib/theme';

const route = useRoute();
const router = useRouter();
const session = useSession();
const { people, nameOf, load: loadPeople } = usePeople();
const { projects, load: loadProjects } = useProjects();
const { errors, fail, clear } = usePanelErrors();
const { ask } = useFocus();
const { off, markRead, toggleKind } = useNotices();

const now = new Date();
const year = ref(now.getFullYear());
const who = ref('');
const loading = ref(true);

/** What is on your own hands, nearest deadline first and the undated ones after them. */
interface Mine {
  key: string;
  summary: string;
  priority: string;
  due: string | null;
  projectShort: string;
  boardSlug: string;
  stateName: string;
  color: string;
}
const mine = ref<Mine[]>([]);
const mineLoading = ref(true);

/** The issues you have starred, the latest star first. */
interface Starred {
  key: string;
  summary: string;
  projectShort: string;
  boardSlug: string;
  stateName: string;
  color: string;
}
const starred = ref<Starred[]>([]);
const starredLoading = ref(true);

// A change made in a window opened from here comes back as this tab's own echo, which the
// live channel drops; so whatever the window changed, everything this screen lists is re-read.
function refresh(): void {
  void load();
  void loadMine();
  void loadStarred();
}

async function loadStarred(): Promise<void> {
  try {
    starred.value = await api<Starred[]>('/my-favourites');
  } catch (err) {
    fail('starred', err, 'Could not read your starred issues.');
  } finally {
    starredLoading.value = false;
  }
}
const today = dayKey(now.getFullYear(), now.getMonth(), now.getDate());

const feedDays = ref({ from: today, to: today });
const dragging = ref<{ start: string; end: string } | null>(null);
const feed = ref<Notice[]>([]);
const feedLoaded = ref(false);
const shownFeed = computed(() => feed.value.filter((n) => !off.value.includes(n.kind)));

function ordered(a: string, b: string): { from: string; to: string } {
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}
const pickedDays = computed(() =>
  dragging.value ? ordered(dragging.value.start, dragging.value.end) : feedDays.value
);

function midnightOf(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

let feedReads = 0;

async function loadFeed(): Promise<void> {
  const mine = ++feedReads;
  const { from, to } = feedDays.value;
  const end = midnightOf(to);
  end.setDate(end.getDate() + 1);
  const range = `from=${encodeURIComponent(midnightOf(from).toISOString())}&to=${encodeURIComponent(end.toISOString())}`;
  try {
    const got = await api<Notice[]>(`/notices?${range}`);
    if (mine === feedReads) feed.value = got;
  } catch {
    if (mine === feedReads) feed.value = [];
  } finally {
    if (mine === feedReads) feedLoaded.value = true;
  }
}

function pickDay(key: string): void {
  feedDays.value = { from: key, to: key };
}
function pickFrom(key: string): void {
  dragging.value = { start: key, end: key };
}
function onPickMove(ev: PointerEvent): void {
  if (!dragging.value) return;
  const cell = document
    .elementFromPoint(ev.clientX, ev.clientY)
    ?.closest<HTMLElement>('.cal--range .cal__day');
  const key = cell?.dataset.key;
  if (key && key !== dragging.value.end) dragging.value = { ...dragging.value, end: key };
}
function onPickUp(): void {
  if (!dragging.value) return;
  feedDays.value = ordered(dragging.value.start, dragging.value.end);
  dragging.value = null;
}
watch(feedDays, () => void loadFeed());

async function loadMine(): Promise<void> {
  try {
    mine.value = await api<Mine[]>('/my-issues');
  } catch (err) {
    fail('mine', err, 'Could not read your issues.');
  } finally {
    mineLoading.value = false;
  }
}

// Folded, the calendar is the month before, this one and the next; opened, it is the year.
const wide = ref(route.query.calendar === 'full');

const shownMonths = computed<{ year: number; month: number }[]>(() => {
  if (wide.value) {
    return Array.from({ length: 12 }, (_, m) => ({ year: year.value, month: m }));
  }
  return [-1, 0, 1].map((step) => {
    const at = new Date(now.getFullYear(), now.getMonth() + step, 1);
    return { year: at.getFullYear(), month: at.getMonth() };
  });
});

function unfold(): void {
  wide.value = !wide.value;
  void router.replace({
    query: { ...route.query, calendar: wide.value ? 'full' : undefined },
  });
}

const marks = ref<Mark[]>([]);
const dues = ref<{ day: string; issues: Due[] }[]>([]);
const activity = ref<Activity[]>([]);
const mentions = ref<DayMentions[]>([]);

const days = computed<Map<string, DayInfo>>(() =>
  byDay(marks.value, dues.value, activity.value, mentions.value)
);
const peak = computed(() => Math.max(1, ...[...days.value.values()].map((d) => d.worked)));
const yearMarks = computed(() => [...marks.value].sort((a, b) => a.day.localeCompare(b.day)));

const personChoices = computed(() =>
  people.value.map((p) => ({ value: p.login, label: p.fullName || p.login, color: p.roleColor }))
);

// Only the latest read's answer is kept: the year or the person changed while a slower read
// was still out must not be overwritten by it.
let reads = 0;

async function load(): Promise<void> {
  clear('month');
  const mine = ++reads;
  const first = shownMonths.value[0];
  const last = shownMonths.value[shownMonths.value.length - 1];
  const from = dayKey(first.year, first.month, 1);
  const to = dayKey(last.year, last.month, daysInMonth(last.year, last.month));
  const user = who.value ? `&user=${encodeURIComponent(who.value)}` : '';
  try {
    const got = await api<{
      marks: Mark[];
      dues: { day: string; issues: Due[] }[];
      activity: Activity[];
      mentions: DayMentions[];
    }>(`/calendar?from=${from}&to=${to}${user}`);
    if (mine !== reads) return;
    marks.value = got.marks;
    dues.value = got.dues;
    activity.value = got.activity;
    mentions.value = got.mentions;
  } catch (err) {
    fail('month', err, 'Could not read the month.');
  } finally {
    loading.value = false;
  }
}

// The top bar hands a day over in the address; the screen opens on it.
function fromAddress(): void {
  const day = String(route.query.day ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  year.value = Number(day.slice(0, 4));
  pickDay(day);
}

onMounted(() => {
  void loadPeople();
  void loadProjects();
  void loadFeed();
  void load();
  void loadMine();
  void loadStarred();
  fromAddress();
  window.addEventListener('pointermove', onPickMove);
  window.addEventListener('pointerup', onPickUp);
});
onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPickMove);
  window.removeEventListener('pointerup', onPickUp);
});
watch(() => route.query.day, fromAddress);
watch(
  () => route.query.calendar,
  (asked) => (wide.value = asked === 'full')
);
watch([year, who, wide], () => void load());
// The whole screen is made of what other people are doing, so almost everything redraws it.
const reloadDays = settled(() => void load());
const reloadLists = settled(() => {
  void loadMine();
  void loadStarred();
});
useLive((ev) => {
  if (
    ev.type.startsWith('issue.') ||
    ev.type.startsWith('comment.') ||
    ev.type.startsWith('mention.') ||
    ev.type === 'key-date.changed'
  ) {
    reloadDays();
  }
  if (ev.type.startsWith('issue.') || ev.type === 'favourite.changed') reloadLists();
  if (ev.type.startsWith('comment.') || ev.type.startsWith('notice.')) void loadFeed();
});

function step(by: number): void {
  year.value += by;
}

// ── one day, opened ──
const picked = ref<string | null>(null);

function openDay(key: string): void {
  picked.value = key;
}

// The window wants the board it sits on and the tags its project can wear; neither is
// on this screen, so both are read when a deadline is opened.
interface OpenIssue {
  key: string;
  project: string;
  comment?: string;
  board: { id: string; name: string; states: { id: string; name: string; color: string }[] };
}
const open = ref<OpenIssue | null>(null);
const lookAt = ref<string | undefined>(undefined);
const openTags = ref<IssueTag[]>([]);
const openBoards = computed(
  () => projects.value.find((p) => p.shortName === open.value?.project)?.boards ?? []
);

// A notice points at an issue by its board's slug; the window wants the board itself.
async function openNotice(n: Notice): Promise<void> {
  if (!n.read) {
    await markRead(n.id);
    feed.value = feed.value.map((f) => (f.id === n.id ? { ...f, read: true } : f));
  }
  const board = projects.value
    .find((p) => p.shortName === n.projectShort)
    ?.boards.find((b) => b.slug === n.boardSlug);
  if (!board) return;
  lookAt.value = n.commentId ?? undefined;
  ask(n.commentId);
  await openIssue({
    key: n.key,
    summary: '',
    projectShort: n.projectShort,
    boardId: board.id,
    boardSlug: n.boardSlug,
    color: '',
    done: false,
  });
}

async function openFromDay(where: {
  key: string;
  projectShort: string;
  boardSlug: string;
  comment?: string;
}): Promise<void> {
  const board = projects.value
    .find((p) => p.shortName === where.projectShort)
    ?.boards.find((b) => b.slug === where.boardSlug);
  if (!board) return;
  if (where.comment) ask(where.comment);
  picked.value = null;
  await openIssue({
    key: where.key,
    summary: '',
    projectShort: where.projectShort,
    boardId: board.id,
    boardSlug: where.boardSlug,
    color: '',
    done: false,
    assignee: null,
  } as unknown as Due);
}

async function openIssue(d: Due): Promise<void> {
  clear('day');
  try {
    const [board, tags] = await Promise.all([
      api<OpenIssue['board']>(`/boards/${d.boardId}`),
      api<IssueTag[]>(`/tags?project=${encodeURIComponent(d.projectShort)}`),
    ]);
    openTags.value = tags;
    open.value = { key: d.key, project: d.projectShort, board, comment: lookAt.value };
    lookAt.value = undefined;
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
      <div class="sheet sheet--cal">
          <section class="panel sheet__wide">
            <header class="panel__h">
              Your issues
              <span class="panel__end">{{ mine.length }}</span>
            </header>
            <div class="panel__b mine">
              <template v-if="mineLoading">
                <div v-for="w in [58, 44, 66]" :key="w" class="mine__row mine__sk">
                  <span class="sk sk--line" style="width: 46px"></span>
                  <span class="sk sk--line" style="width: 44px"></span>
                  <span class="sk sk--line" :style="{ width: `${w}%` }"></span>
                  <span class="sk sk--line" style="width: 64px"></span>
                  <span class="sk sk--line mine__due" style="width: 72px"></span>
                </div>
              </template>
              <button
                v-for="i in mine"
                :key="i.key"
                class="mine__row"
                type="button"
                @click="openFromDay({ key: i.key, projectShort: i.projectShort, boardSlug: i.boardSlug })"
              >
                <span class="key" :style="{ color: ink(i.color) }">{{ i.key }}</span>
                <span class="mine__pri" :style="{ color: priorityColor(i.priority as Priority) }">
                  {{ i.priority }}
                </span>
                <span class="mine__what">{{ i.summary }}</span>
                <span class="stamp" :style="{ color: ink(i.color) }">{{ i.stateName }}</span>
                <span
                  class="stamp mine__due"
                  :class="{ 'is-late': i.due && i.due < today }"
                >{{ i.due ? dayAndMonth(i.due) : '—' }}</span>
              </button>
              <div v-if="!mineLoading && !mine.length" class="hint faint">Nothing is on you.</div>
            </div>
          </section>
          <div v-if="errors.mine" class="err panel__err sheet__wide">{{ errors.mine }}</div>

        <div class="stack">
          <section class="panel">
            <header class="panel__h">
              <span class="key year">{{ wide ? year : monthName(now.getFullYear(), now.getMonth()) }}</span>
              <template v-if="wide">
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
              </template>
              <span class="panel__end">
                <button
                  class="btn btn--sm btn--icon btn--ghost"
                  type="button"
                  :aria-label="wide ? 'Show three months' : 'Show the whole year'"
                  @click="unfold"
                >
                  <ChevronsDownUp v-if="wide" class="ic" />
                  <ChevronsUpDown v-else class="ic" />
                </button>
                <Select
                  v-model="who"
                  :options="personChoices"
                  placeholder="Everyone"
                  keep-placeholder
                  small
                  label="Whose work to shade"
                />
              </span>
            </header>
            <div class="panel__b year-grid">
              <template v-if="loading">
                <span v-for="n in shownMonths.length" :key="n" class="sk cal-sk"></span>
              </template>
              <template v-else>
                <div v-for="m in shownMonths" :key="`${m.year}-${m.month}`" class="month">
                  <div class="month__h">{{ monthName(m.year, m.month) }}</div>
                  <MonthGrid
                    :year="m.year"
                    :month="m.month"
                    :days="days"
                    :peak="peak"
                    compact
                    :range="pickedDays"
                    @down="pickFrom"
                  />
                </div>
              </template>
            </div>
          </section>
          <div v-if="errors.month" class="err panel__err">{{ errors.month }}</div>

          <section class="panel">
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
                  <span class="stamp">{{ longDate(m.day) }}</span>
                  <span class="day__what">
                    <span v-if="m.project" class="key">{{ m.project.shortName }}</span>
                    {{ m.title }}
                  </span>
                </button>
                <div v-if="!yearMarks.length" class="empty empty--sm">
                  <span class="empty__g">◇</span>Nothing marked this year.
                </div>
              </template>
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="panel">
            <header class="panel__h">
              <Star class="ic star" fill="currentColor" aria-label="Starred" />
              <span class="panel__end">{{ starredLoading ? '' : starred.length }}</span>
            </header>
            <div class="panel__b days days--starred">
              <template v-if="starredLoading">
                <div v-for="w in [70, 52]" :key="w" class="day day--one day--sk">
                  <span class="day__what">
                    <span class="sk sk--line" style="width: 46px"></span>
                    <span class="sk sk--line" :style="{ width: `${w}%` }"></span>
                  </span>
                </div>
              </template>
              <button
                v-for="f in starred"
                :key="f.key"
                class="day day--one"
                type="button"
                @click="openFromDay({ key: f.key, projectShort: f.projectShort, boardSlug: f.boardSlug })"
              >
                <span class="day__what">
                  <span class="key" :style="{ color: ink(f.color) }">{{ f.key }}</span>
                  <span class="note__said">{{ f.summary }}</span>
                </span>
              </button>
              <div v-if="!starredLoading && !starred.length" class="hint faint">Nothing starred.</div>
            </div>
          </section>
          <div v-if="errors.starred" class="err panel__err">{{ errors.starred }}</div>

          <section class="panel">
            <header class="panel__h">
              <span class="kind__hold">
                <button
                  class="btn btn--sm btn--icon btn--ghost kind"
                  :class="{ 'is-off': off.includes('mention') }"
                  type="button"
                  aria-label="Mentions"
                  @click="toggleKind('mention')"
                ><AtSign class="ic" /></button>
                <span class="selbar kind__what">Mentions</span>
              </span>
              <span class="kind__hold">
                <button
                  class="btn btn--sm btn--icon btn--ghost kind"
                  :class="{ 'is-off': off.includes('reaction') }"
                  type="button"
                  aria-label="Reactions"
                  @click="toggleKind('reaction')"
                ><Smile class="ic" /></button>
                <span class="selbar kind__what">Reactions</span>
              </span>
              <span class="kind__hold">
                <button
                  class="btn btn--sm btn--icon btn--ghost kind"
                  :class="{ 'is-off': off.includes('assigned') }"
                  type="button"
                  aria-label="Assigned to you"
                  @click="toggleKind('assigned')"
                ><ContactRound class="ic" /></button>
                <span class="selbar kind__what">Assigned to you</span>
              </span>
              <span class="panel__end">{{ spanLabel(pickedDays.from, pickedDays.to, false) }}</span>
            </header>
            <div class="panel__b days">
              <template v-if="!feedLoaded">
                <div v-for="w in [74, 58, 66]" :key="w" class="day day--sk">
                  <span class="sk sk--line" style="width: 96px"></span>
                  <span class="sk sk--line" :style="{ width: `${w}%` }"></span>
                </div>
              </template>
              <button
                v-for="n in shownFeed"
                :key="n.id"
                class="day note"
                :class="{ 'is-new': !n.read }"
                type="button"
                @click="openNotice(n)"
              >
                <span class="stamp">{{ stampAt(n.at) }}</span>
                <span class="day__what">
                  <span class="key" :style="{ color: ink(n.color) }">{{ n.key }}</span>
                  <span v-if="n.emoji">{{ n.emoji }}</span>
                  <span class="note__said">
                    <template v-if="n.kind === 'reaction'">{{ nameOf(n.by) }} reacted</template>
                    <template v-else-if="n.kind === 'assigned'">{{ nameOf(n.by) }} assigned you</template>
                    <template v-else>
                      <template v-if="n.by && n.by !== session.me.value?.login">
                        {{ nameOf(n.by) }}:
                      </template>
                      {{ n.said }}
                    </template>
                  </span>
                </span>
              </button>
              <div v-if="feedLoaded && !shownFeed.length" class="empty empty--sm">
                <span class="empty__g">◇</span>Nothing for you yet.
              </div>
            </div>
          </section>


        </div>
      </div>
    </div>

    <DayWindow
      v-if="picked"
      :day="picked"
      @close="picked = null"
      @changed="refresh"
      @open="openFromDay"
    />

    <IssueView
      v-if="open"
      :key="open.key"
      :issue-key="open.key"
      :board="open.board"
      :boards="openBoards"
      :tags="openTags"
      :project="open.project"
      :focus-comment="open.comment"
      @close="open = null"
      @changed="refresh"
      @deleted="closeIssue"
      @moved="closeIssue"
      @tag-created="openTags = [...openTags, $event]"
    />
  </div>
</template>

<style scoped>
/* What is on your own hands: one row per issue, the summary taking whatever is left. */
.mine {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mine__row {
  display: grid;
  grid-template-columns: 84px 72px minmax(0, 1fr) 110px 96px;
  align-items: center;
  gap: 10px;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid var(--line);
  background: none;
  color: var(--text);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.mine__row:hover {
  border-color: var(--line-2);
}
.mine__pri {
  font-size: 12px;
}
.mine__what {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.mine__due {
  text-align: right;
}
.page__body {
  flex: 1 1 auto;
  min-height: 0;
  padding: var(--space-6) var(--space-5);
  overflow-y: auto;
}
/* The year takes two thirds of the measure and what is marked on it stands beside it. */
.sheet--cal {
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
}
/* Three months across, a quarter of the year to a row. */
.year-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.month__h {
  padding-bottom: 6px;
  color: var(--text-muted);
  font-size: 11.5px;
}
.year {
  font-size: 15px;
  color: var(--text);
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
/* Two lines, because the column beside the year is a narrow one. */
.day {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 6px 8px;
  border: 0;
  background: none;
  color: var(--text-dim);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.day__what {
  display: flex;
  gap: 8px;
  min-width: 0;
}
/* A line of the feed: who said what, cut where the column ends. */
.note__said {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.note.is-new {
  color: var(--text);
}
/* A kind switched off is still there, just not listened to. */
.kind.is-off {
  opacity: 0.35;
}
/* What the icon stands for, held over it until the pointer leaves. */
.kind__hold {
  position: relative;
  display: inline-flex;
}
.kind__what {
  position: absolute;
  left: 50%;
  bottom: 100%;
  display: none;
  padding: 5px 10px;
  transform: translate(-50%, -8px);
  color: var(--text-dim);
  font-size: 12px;
  white-space: nowrap;
}
.kind__hold:hover .kind__what {
  display: block;
}
.day:hover {
  background: var(--card-hover);
  color: var(--text);
}
/* A placeholder row keeps the two lines of a real one and answers nothing. */
.day--sk {
  width: 100%;
  cursor: default;
}
.day--sk:hover {
  background: none;
}
.mine__sk {
  cursor: default;
}
.mine__sk:hover {
  border-color: var(--line);
}
/* The starred list is named by its star alone, in the colour a star wears when it is on. */
.star {
  color: var(--accent);
}
/* The starred list is a shortcut, not a feed: one line a row, and never taller than the
   feed under it — past five it scrolls in place. */
.days--starred {
  max-height: 176px;
  overflow-y: auto;
}
.day--one {
  padding: 4px 8px;
}
.day--one .day__what {
  width: 100%;
  align-items: center;
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
/* A marked day can carry the event's picture, and the picture is the way to it. */
.mark--kept {
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  padding: 0;
}
.mark__banner {
  display: block;
  border-bottom: 1px solid var(--line);
}
.mark__banner img {
  display: block;
  width: 100%;
  max-height: 150px;
  object-fit: cover;
}
.mark__line {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 30px;
  padding: 0 4px 0 8px;
}
a.mark__title {
  color: var(--accent);
  text-decoration: none;
}
a.mark__title:hover {
  color: var(--accent-bright);
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

</style>
