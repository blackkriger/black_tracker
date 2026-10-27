<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  AtSign,
  Bell,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ContactRound,
  Smile,
  Star,
} from 'lucide-vue-next';
import IssueView from '../components/IssueView.vue';
import DayWindow from '../components/DayWindow.vue';
import MonthGrid from '../components/MonthGrid.vue';
import StickyNotes from '../components/StickyNotes.vue';
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
import { features } from '../lib/features';
import { noticeLine, showsAuthor, useNotices, type Notice } from '../lib/notices';
import { usePanelErrors } from '../lib/panelErrors';
import { useProjects } from '../lib/projects';
import { useSession } from '../lib/session';
import { settled, useLive } from '../lib/live';
import { ink } from '../lib/theme';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const session = useSession();
const { nameOf, colorOf, genderOf, load: loadPeople } = usePeople();
const { projects, load: loadProjects } = useProjects();
const { errors, fail, clear } = usePanelErrors();
const { ask } = useFocus();
const { off, markRead, toggleKind } = useNotices();

const now = new Date();
const year = ref(now.getFullYear());
const loading = ref(true);

interface Mine {
  key: string;
  summary: string;
  priority: string;
  due: string | null;
  projectShort: string;
  boardSlug: string;
  boardName: string;
  stateName: string;
  color: string;
}
const mine = ref<Mine[]>([]);
const mineLoading = ref(true);

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

function refresh(): void {
  void load();
  void loadMine();
  void loadStarred();
}

async function loadStarred(): Promise<void> {
  clear('starred');
  try {
    starred.value = await api<Starred[]>('/my-favourites');
  } catch (err) {
    fail('starred', err, t('me.starredFailed'));
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

let feedReads = 0;

async function loadFeed(): Promise<void> {
  const mine = ++feedReads;
  const { from, to } = feedDays.value;
  try {
    const got = await api<Notice[]>(`/notices?from=${from}&to=${to}`);
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
  clear('mine');
  try {
    mine.value = await api<Mine[]>('/my-issues');
  } catch (err) {
    fail('mine', err, t('me.mineFailed'));
  } finally {
    mineLoading.value = false;
  }
}

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

let reads = 0;

async function load(): Promise<void> {
  clear('month');
  const mine = ++reads;
  const first = shownMonths.value[0];
  const last = shownMonths.value[shownMonths.value.length - 1];
  const from = dayKey(first.year, first.month, 1);
  const to = dayKey(last.year, last.month, daysInMonth(last.year, last.month));
  const login = session.me.value?.login;
  const user = login ? `&user=${encodeURIComponent(login)}` : '';
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
    fail('month', err, t('me.monthFailed'));
  } finally {
    loading.value = false;
  }
}

const SHEET_W = 960;
const NOTES_W = 240;
const GAP = 24;
const PAGE_PAD = 48;
const pageBody = ref<HTMLElement | null>(null);
const notesAside = ref<boolean | null>(null);
const fits = new ResizeObserver(() => measureNotes());

function measureNotes(): void {
  if (pageBody.value) notesAside.value = pageBody.value.clientWidth >= SHEET_W + GAP + NOTES_W + PAGE_PAD;
}

onMounted(() => {
  measureNotes();
  if (pageBody.value) fits.observe(pageBody.value);
  void loadPeople();
  void loadProjects();
  void loadFeed();
  void load();
  void loadMine();
  void loadStarred();
  window.addEventListener('pointermove', onPickMove);
  window.addEventListener('pointerup', onPickUp);
});
onBeforeUnmount(() => {
  fits.disconnect();
  window.removeEventListener('pointermove', onPickMove);
  window.removeEventListener('pointerup', onPickUp);
});
watch(
  () => route.query.calendar,
  (asked) => (wide.value = asked === 'full')
);
watch([year, wide], () => void load());
const reloadDays = settled(() => void load());
const reloadLists = settled(() => {
  void loadMine();
  void loadStarred();
});
const RELOAD_ON = ['history.added', 'state.changed', 'board.changed', 'project.changed'];
useLive((ev) => {
  if (
    ev.type.startsWith('issue.') ||
    ev.type.startsWith('comment.') ||
    ev.type === 'key-date.changed' ||
    RELOAD_ON.includes(ev.type)
  ) {
    reloadDays();
  }
  if (ev.type.startsWith('issue.') || ev.type === 'favourite.changed' || RELOAD_ON.includes(ev.type)) {
    reloadLists();
  }
  if (ev.type.startsWith('comment.') || ev.type.startsWith('notice.')) void loadFeed();
}, () => {
  reloadDays();
  reloadLists();
  void loadFeed();
});

function step(by: number): void {
  year.value += by;
}

const picked = ref<string | null>(null);

function openDay(key: string): void {
  picked.value = key;
}

interface OpenIssue {
  key: string;
  project: string;
  comment?: string;
  board: {
    id: string;
    name: string;
    states: { id: string; name: string; color: string }[];
    tagIds: string[];
  };
}
const open = ref<OpenIssue | null>(null);
const lookAt = ref<string | undefined>(undefined);
const openTags = ref<IssueTag[]>([]);
const openBoards = computed(
  () => projects.value.find((p) => p.shortName === open.value?.project)?.boards ?? []
);

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
      api<IssueTag[]>('/tags'),
    ]);
    openTags.value = tags.filter((t) => board.tagIds.includes(t.id));
    open.value = { key: d.key, project: d.projectShort, board, comment: lookAt.value };
    lookAt.value = undefined;
    picked.value = null;
  } catch (err) {
    fail('day', err, t('me.openFailed'));
  }
}

function closeIssue(): void {
  open.value = null;
  refresh();
}
</script>

<template>
  <div class="page">
    <div ref="pageBody" class="page__body">
      <div class="me" :class="{ 'me--aside': notesAside }">
      <div class="sheet sheet--cal">
          <section class="panel sheet__wide">
            <header class="panel__h">
              {{ t('me.yourIssues') }}
              <span class="panel__end">{{ mine.length }}</span>
            </header>
            <div class="panel__b mine">
              <template v-if="mineLoading">
                <div v-for="w in [58, 44, 66]" :key="w" class="mine__row mine__sk">
                  <span class="sk sk--line mine__key" style="width: 46px"></span>
                  <span class="sk sk--line mine__pri" style="width: 44px"></span>
                  <span class="sk sk--line mine__what" :style="{ width: `${w}%` }"></span>
                  <span class="sk sk--line mine__board" style="width: 80px"></span>
                  <span class="sk sk--line mine__state" style="width: 64px"></span>
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
                <span class="key mine__key" :style="{ color: ink(i.color) }">{{ i.key }}</span>
                <span class="mine__pri" :style="{ color: priorityColor(i.priority as Priority) }">
                  {{ t(`priority.${i.priority}`) }}
                </span>
                <span class="mine__what">{{ i.summary }}</span>
                <span class="mine__board">{{ i.boardName }}</span>
                <span class="stamp mine__state" :style="{ color: ink(i.color) }">{{ i.stateName }}</span>
                <span
                  class="stamp mine__due"
                  :class="{ 'is-late': i.due && i.due < today }"
                >{{ i.due ? dayAndMonth(i.due) : '—' }}</span>
              </button>
              <div v-if="!mineLoading && !mine.length" class="hint faint">{{ t('me.nothingOnYou') }}</div>
            </div>
          </section>
          <div v-if="errors.mine" class="err panel__err sheet__wide">{{ errors.mine }}</div>
          <div v-if="errors.day" class="err panel__err sheet__wide">{{ errors.day }}</div>

        <div class="stack dates">
          <section class="panel">
            <header class="panel__h">
              <span class="key year">{{ wide ? year : monthName(now.getFullYear(), now.getMonth()) }}</span>
              <template v-if="wide">
                <button
                  class="btn btn--sm btn--icon btn--ghost"
                  type="button"
                  :aria-label="t('me.prevYear')"
                  @click="step(-1)"
                ><ChevronLeft class="ic" /></button>
                <button
                  class="btn btn--sm btn--icon btn--ghost"
                  type="button"
                  :aria-label="t('me.nextYear')"
                  @click="step(1)"
                ><ChevronRight class="ic" /></button>
              </template>
              <span class="panel__end">
                <button
                  class="btn btn--sm btn--icon btn--ghost"
                  type="button"
                  :aria-label="wide ? t('me.threeMonths') : t('me.wholeYear')"
                  @click="unfold"
                >
                  <ChevronsDownUp v-if="wide" class="ic" />
                  <ChevronsUpDown v-else class="ic" />
                </button>
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
                    @pick="pickDay"
                  />
                </div>
              </template>
            </div>
          </section>
          <div v-if="errors.month" class="err panel__err">{{ errors.month }}</div>

          <section class="panel">
            <header class="panel__h">{{ t('me.markedDays') }}</header>
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
                  <span class="empty__g">◇</span>{{ t('me.nothingMarked') }}
                </div>
              </template>
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="panel">
            <header class="panel__h">
              <Star class="ic star" fill="currentColor" :aria-label="t('me.starred')" />
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
              <div v-if="!starredLoading && !starred.length" class="hint faint">{{ t('me.nothingStarred') }}</div>
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
                  :aria-label="t('notices.kinds.mention')"
                  @click="toggleKind('mention').catch(() => {})"
                ><AtSign class="ic" /></button>
                <span class="selbar kind__what">{{ t('notices.kinds.mention') }}</span>
              </span>
              <span class="kind__hold">
                <button
                  class="btn btn--sm btn--icon btn--ghost kind"
                  :class="{ 'is-off': off.includes('reaction') }"
                  type="button"
                  :aria-label="t('notices.kinds.reaction')"
                  @click="toggleKind('reaction').catch(() => {})"
                ><Smile class="ic" /></button>
                <span class="selbar kind__what">{{ t('notices.kinds.reaction') }}</span>
              </span>
              <span class="kind__hold">
                <button
                  class="btn btn--sm btn--icon btn--ghost kind"
                  :class="{ 'is-off': off.includes('assigned') }"
                  type="button"
                  :aria-label="t('notices.kinds.assigned')"
                  @click="toggleKind('assigned').catch(() => {})"
                ><ContactRound class="ic" /></button>
                <span class="selbar kind__what">{{ t('notices.kinds.assigned') }}</span>
              </span>
              <span class="kind__hold">
                <button
                  class="btn btn--sm btn--icon btn--ghost kind"
                  :class="{ 'is-off': off.includes('starred') }"
                  type="button"
                  :aria-label="t('notices.kinds.starred')"
                  @click="toggleKind('starred').catch(() => {})"
                ><Star class="ic" /></button>
                <span class="selbar kind__what">{{ t('notices.kinds.starred') }}</span>
              </span>
              <span v-if="features.pings" class="kind__hold">
                <button
                  class="btn btn--sm btn--icon btn--ghost kind"
                  :class="{ 'is-off': off.includes('ping') }"
                  type="button"
                  :aria-label="t('notices.kinds.ping')"
                  @click="toggleKind('ping').catch(() => {})"
                ><Bell class="ic" /></button>
                <span class="selbar kind__what">{{ t('notices.kinds.ping') }}</span>
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
                  <span
                    v-if="showsAuthor(n, session.me.value?.login)"
                    class="note__by"
                    :style="{ color: ink(colorOf(n.by)) }"
                  >{{ nameOf(n.by) }}</span>
                  <span class="note__said">
                    {{ noticeLine(n, nameOf, genderOf) }}
                  </span>
                </span>
              </button>
              <div v-if="feedLoaded && !shownFeed.length" class="empty empty--sm">
                <span class="empty__g">◇</span>{{ t('me.nothingForYou') }}
              </div>
            </div>
          </section>
          <StickyNotes v-if="notesAside === false" />
        </div>
      </div>
      <aside v-if="notesAside" class="me__notes">
        <StickyNotes />
      </aside>
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
      @linked="refresh"
      @deleted="closeIssue"
      @moved="closeIssue"
      @tag-created="openTags = [...openTags, $event]"
    />
  </div>
</template>

<style scoped>
.mine {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mine__row {
  display: grid;
  grid-template-columns: 84px 72px minmax(0, 1fr) 120px 110px 96px;
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
  border-radius: var(--radius);
}
.mine__row:hover {
  border-color: var(--line-2);
}
.mine__pri {
  font-size: 12px;
}
.mine__board {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--text-dim);
  font-size: 12.5px;
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
.sheet--cal {
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
}
.me--aside {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  gap: var(--space-5);
}
.me--aside > .sheet {
  flex: none;
  margin: 0;
}
.me__notes {
  flex: none;
  width: 240px;
}
@media (max-width: 880px) {
  .sheet--cal {
    grid-template-columns: minmax(0, 1fr);
  }
  .dates {
    order: 1;
  }
}
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
  border-radius: var(--radius-sm);
}
.day__what {
  display: flex;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
}
.day__what .key,
.note__by {
  flex: none;
}
.note__said {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.note.is-new {
  color: var(--text);
}
.kind.is-off {
  opacity: 0.35;
}
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
.star {
  color: var(--accent);
}
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

@media (max-width: 760px) {
  .mine__row {
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    grid-template-areas:
      'key pri . state'
      'what what what what'
      'board board . due';
    gap: 4px 10px;
    padding: 8px 10px;
  }
  .mine__key {
    grid-area: key;
  }
  .mine__pri {
    grid-area: pri;
  }
  .mine__what {
    grid-area: what;
    white-space: normal;
  }
  .mine__board {
    grid-area: board;
  }
  .mine__state {
    grid-area: state;
    justify-self: end;
  }
  .mine__due {
    grid-area: due;
    justify-self: end;
  }
  .year-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
