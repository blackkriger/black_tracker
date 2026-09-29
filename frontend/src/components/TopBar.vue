<script setup lang="ts">
// The bar every screen but sign-in carries: the projects side by side with their boards beside them, and who you are.
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useProjects } from '../lib/projects';
import { usePeople } from '../lib/people';
import { useFocus } from '../lib/focus';
import { useNotices, type Notice } from '../lib/notices';
import { useRoles } from '../lib/roles';
import { useLive } from '../lib/live';
import { useSession } from '../lib/session';
import DayWindow from './DayWindow.vue';
import MonthGrid from './MonthGrid.vue';
import { api } from '../lib/api';
import {
  byDay,
  dayAndMonth,
  monthName,
  monthRange,
  todayKey,
  type Activity,
  type DayInfo,
  type DayMentions,
  type Due,
  type Mark,
} from '../lib/calendar';
import { stamp } from '../lib/issues';
import { buddyAvatarStyle } from '../lib/avatar';
import { ArrowRight, AtSign, ChevronLeft, ChevronRight } from 'lucide-vue-next';

const props = defineProps<{
  /** The project this screen belongs to, when it belongs to one. */
  project?: { shortName: string; name: string } | null;
  /** The board being looked at, named beside its project so you can see where you are. */
  board?: { name: string; slug: string } | null;
}>();

const session = useSession();
const router = useRouter();
const { projects, load } = useProjects();
// Kept fresh from here because this bar is on every screen; the lists themselves are shared.
const { load: loadPeople } = usePeople();
// What is waiting for you is written in the colour of your own role.
const mine = computed(() => session.me.value?.role?.color ?? undefined);
const { load: loadRoles } = useRoles();

// No role is no access, so the one screen such a person has is not worth pointing at.
const hasRole = computed(() => session.me.value?.isAdmin === true || !!session.me.value?.role);

const live = computed(() => projects.value.filter((p) => !p.archived));
const currentShort = computed(() => props.project?.shortName ?? null);

// Today, and the month behind it. The month is read the first time the chip is opened —
// no screen needs it until then.
const now = new Date();
const today = stamp(now.toISOString());
const dateOpen = ref(false);
const calYear = ref(now.getFullYear());
const calMonth = ref(now.getMonth());
const calDays = ref(new Map<string, DayInfo>());
const calPeak = ref(1);

async function readMonth(): Promise<void> {
  const { from, to } = monthRange(calYear.value, calMonth.value);
  try {
    const got = await api<{
      marks: Mark[];
      dues: { day: string; issues: Due[] }[];
      activity: Activity[];
      mentions: DayMentions[];
    }>(`/calendar?from=${from}&to=${to}`);
    calDays.value = byDay(got.marks, got.dues, got.activity, got.mentions);
    calPeak.value = Math.max(1, ...[...calDays.value.values()].map((d) => d.worked));
  } catch {
    /* the chip still opens; it simply has nothing to shade */
  }
}

// How far off the next marked day is, read once and kept in step with the live channel.
const soon = ref<Mark | null>(null);
const daysOff = computed(() => {
  if (!soon.value) return null;
  const at = Date.parse(`${soon.value.day}T00:00:00Z`);
  const now = Date.parse(`${todayKey()}T00:00:00Z`);
  return Math.round((at - now) / 86400000);
});
const countdown = computed(() => {
  const left = daysOff.value;
  const what = soon.value?.title ?? '';
  if (left === null || left < 0) return '';
  if (left === 0) return `${what} is today`;
  if (left === 1) return `1 day till ${what}`;
  return `${left} days till ${what}`;
});

// Being named somewhere. The feed lives behind the same chip: what is waiting for you,
// and which day it landed on, are the same question asked twice.
const { shown: notices, unread, load: readNotices, markRead } = useNotices();
const { ask } = useFocus();

async function openNotice(n: Notice): Promise<void> {
  dateOpen.value = false;
  if (!n.read) await markRead(n.id);
  ask(n.commentId);
  await router.push({
    path: `/${n.projectShort}/${n.boardSlug}/${n.key}`,
    query: n.commentId ? { c: n.commentId } : {},
  });
}

async function readNext(): Promise<void> {
  try {
    soon.value = await api<Mark | null>('/calendar/next');
  } catch {
    /* the chip simply shows the date alone */
  }
}

function toggleDate(): void {
  dateOpen.value = !dateOpen.value;
  // Read again on every open: a day marked on the calendar screen is already old news here.
  if (dateOpen.value) void readMonth();
}

function stepMonth(by: number): void {
  const d = new Date(calYear.value, calMonth.value + by, 1);
  calYear.value = d.getFullYear();
  calMonth.value = d.getMonth();
  void readMonth();
}

async function toCalendar(): Promise<void> {
  dateOpen.value = false;
  await router.push({ name: 'home', query: { calendar: 'full' } });
}

// A day picked here opens where you are: the screen behind the bar is not disturbed.
const pickedDay = ref<string | null>(null);

function toDay(key: string): void {
  dateOpen.value = false;
  pickedDay.value = key;
}

async function fromDay(where: {
  key: string;
  projectShort: string;
  boardSlug: string;
  comment?: string;
}): Promise<void> {
  pickedDay.value = null;
  if (where.comment) ask(where.comment);
  await router.push(`/${where.projectShort}/${where.boardSlug}/${where.key}`);
}

onMounted(() => {
  void load();
  void readNext();
  void readNotices();
  window.addEventListener('click', closeMenu);
  window.addEventListener('keydown', onKeydown);
});
onUnmounted(() => {
  window.removeEventListener('click', closeMenu);
  window.removeEventListener('keydown', onKeydown);
});

function closeMenu(): void {
  dateOpen.value = false;
}
function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') dateOpen.value = false;
}

// Someone added a project or a board while this bar was on screen.
useLive((ev) => {
  if (['project.changed', 'board.changed'].includes(ev.type)) void load(true);
  if (ev.type === 'key-date.changed') void readNext();
  // A name is written in the colour of a role, so both lists follow whoever edits either.
  if (['role.changed', 'user.changed'].includes(ev.type)) {
    void loadPeople(true);
    void loadRoles(true);
  }
  if (ev.type.startsWith('comment.') || ev.type.startsWith('notice.')) void readNotices();
});

async function signOut(): Promise<void> {
  await session.signOut();
  await router.push({ name: 'login' });
}
</script>

<template>
  <header class="top">
    <nav v-if="live.length" class="topitems" aria-label="Projects">
      <span v-for="p in live" :key="p.id" class="topproj">
        <RouterLink
          class="topitem topitem--project"
          :to="`/${p.shortName}`"
          :aria-current="p.shortName === currentShort ? 'page' : undefined"
        >
          <span class="proj__k">{{ p.shortName }}</span>
          <span class="topitem__name">{{ p.name }}</span>
        </RouterLink>

        <span class="topboards" :class="{ 'is-one': p.boards.length < 2 }">
          <RouterLink
            v-for="b in p.boards"
            :key="b.id"
            class="topitem topitem__board"
            :class="{ 'is-here': p.shortName === currentShort && b.slug === board?.slug }"
            :to="`/${p.shortName}/${b.slug}`"
          >{{ b.name }}</RouterLink>
        </span>
      </span>
    </nav>

    <div class="sp"></div>

    <nav class="topitems" aria-label="Account">
      <span class="datepick" @click.stop>
        <button
          class="topitem topitem--caret datechip"
          type="button"
          :aria-expanded="dateOpen"
          aria-label="Calendar"
          @click="toggleDate"
        >
          <span v-if="countdown" class="stamp topcount">{{ countdown }}</span>
          <span class="datechip__now">
            <span v-if="unread" class="stamp topat" :style="{ color: mine }">
              <AtSign class="ic ic--sm" />{{ unread }}
            </span>
            <span class="stamp">{{ today }}</span>
          </span>
        </button>
        <div v-if="dateOpen" class="menu datemenu">
          <div class="datemenu__h">
            {{ monthName(calYear, calMonth) }}
            <div class="sp"></div>
            <button
              class="btn btn--sm btn--icon btn--ghost"
              type="button"
              aria-label="Previous month"
              @click="stepMonth(-1)"
            ><ChevronLeft class="ic ic--sm" /></button>
            <button
              class="btn btn--sm btn--icon btn--ghost"
              type="button"
              aria-label="Next month"
              @click="stepMonth(1)"
            ><ChevronRight class="ic ic--sm" /></button>
          </div>
          <div class="datemenu__grid">
            <MonthGrid
              :year="calYear"
              :month="calMonth"
              :days="calDays"
              :peak="calPeak"
              compact
              @pick="toDay"
            />
          </div>
          <!-- What the countdown counts to, under the month it falls in. -->
          <template v-if="soon">
            <hr v-if="!soon.banner" />
            <div class="soon" :class="{ 'soon--banner': soon.banner }">
              <a
                v-if="soon.banner"
                class="soon__banner"
                :href="soon.url ?? soon.banner"
                target="_blank"
                rel="noopener noreferrer"
              ><img :src="soon.banner" :alt="soon.title" /></a>
              <div class="soon__line">
                <span class="soon__text">
                  <a
                    v-if="soon.url"
                    class="soon__title"
                    :href="soon.url"
                    target="_blank"
                    rel="noopener noreferrer"
                  >{{ soon.title }}</a>
                  <span v-else class="soon__title">{{ soon.title }}</span>
                  <span class="stamp">{{ dayAndMonth(soon.day) }}</span>
                </span>
                <!-- A day that belongs to one project says which, against both lines. -->
                <span v-if="soon.project" class="key">{{ soon.project.shortName }}</span>
              </div>
            </div>
          </template>
          <template v-if="notices.length">
            <hr />
            <button
              v-for="n in notices.slice(0, 5)"
              :key="n.id"
              class="menu__i men"
              :class="{ 'men--new': !n.read }"
              type="button"
              @click="openNotice(n)"
            >
              <span class="key" :style="{ color: n.color ?? undefined }">{{ n.key }}</span>
              <span v-if="n.emoji" class="men__emoji">{{ n.emoji }}</span>
              <span class="men__said">
                <template v-if="n.kind === 'reaction'">{{ n.by }} reacted</template>
                <template v-else-if="n.kind === 'assigned'">{{ n.by }} assigned you</template>
                <template v-else>
                  <template v-if="n.by && n.by !== session.me.value?.login">{{ n.by }}: </template>
                  {{ n.said }}
                </template>
              </span>
            </button>
          </template>
          <hr />
          <button class="menu__i" type="button" @click="toCalendar">
            Full calendar
            <ArrowRight class="ic ic--sm" />
          </button>
        </div>
      </span>
      <RouterLink class="topitem" :to="{ name: 'home' }">
        <span class="av" :style="buddyAvatarStyle(session.me.value?.login ?? '')"></span>
        {{ session.me.value?.login }}
      </RouterLink>
      <RouterLink v-if="hasRole" class="topitem" to="/analytics">Analytics</RouterLink>
      <RouterLink v-if="hasRole" class="topitem" to="/settings">Settings</RouterLink>
      <button class="topitem topitem--danger" type="button" @click="signOut">Sign out</button>
    </nav>

    <DayWindow
      v-if="pickedDay"
      :day="pickedDay"
      @close="pickedDay = null"
      @changed="readNext(); readMonth()"
      @open="fromDay"
    />
  </header>
</template>

<style scoped>
/* Nothing in the bar takes a background: the text itself does the talking. It brightens on hover, turns gold on a project — the bright gold, a shade up from the key beside it — and red on the one action you would not want to hit by accident. */
.topitems {
  display: flex;
  align-items: center;
  gap: 2px;
}
.topitem {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 10px;
  border: 0;
  background: none;
  color: var(--text-dim);
  font: 13px var(--font-ui);
  text-decoration: none;
  cursor: pointer;
}
.topitem:hover {
  color: var(--text);
}
.topitem--project:hover,
.topitem--project[aria-current] {
  color: var(--accent-bright);
}
.topitem:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
.topitem__name {
  font-weight: 500;
}
.topproj {
  position: relative;
  display: inline-flex;
  align-items: center;
}
/* One project's boards must not run into the next project's key. */
.topproj + .topproj {
  margin-left: 10px;
}
.topitem--caret {
  gap: 6px;
  padding: 0 6px;
}
/* The boards stand two to a column, the way the date stands over the countdown: the bar
   keeps its height however many boards a project has, and each name is its own link. */
.topboards {
  display: grid;
  grid-template-rows: repeat(2, 16px);
  grid-auto-flow: column;
  justify-items: start;
  column-gap: 4px;
}
.topboards.is-one {
  grid-template-rows: 32px;
}
.topitem__board {
  height: 100%;
  padding: 0 6px;
  font-size: 12.5px;
}
/* A board is not a project: it stands out in plain bright, the way the account links do. */
.topitem__board.is-here {
  color: var(--text);
}
.topitem--danger:hover {
  color: var(--danger-text);
}
.datepick {
  position: relative;
  display: inline-flex;
  align-items: center;
}
/* Two lines: what is coming above, and what today is with what is waiting on it below. */
.datechip {
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
}
.datechip__now {
  display: flex;
  align-items: center;
  gap: 8px;
}
.topat {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--text);
}
.men__emoji {
  font-size: 12px;
}
/* Who said it and what, cut where the menu ends. */
.men__said {
  overflow: hidden;
  color: var(--text-muted);
  white-space: nowrap;
  text-overflow: ellipsis;
}
.men--new .men__said {
  color: var(--text-dim);
}
/* A long name for an event cannot push the bar around, so it is cut where it runs out of room. */
.topcount {
  max-width: 280px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--accent);
}
.datemenu {
  position: absolute;
  top: calc(100% + 7px);
  right: 0;
  z-index: 20;
  width: 250px;
}
/* The same pointer the board menu has, kept over the chip on the right. */
.datemenu::before,
.datemenu::after {
  content: "";
  position: absolute;
  bottom: 100%;
  right: 14px;
  border: 6px solid transparent;
}
.datemenu::before {
  border-bottom-color: var(--line-2);
}
.datemenu::after {
  margin-bottom: -1px;
  border-bottom-color: var(--card);
}
.datemenu__h {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px 6px 10px;
  color: var(--text-muted);
  font-size: 11.5px;
}
.datemenu__grid {
  padding: 0 10px 6px;
}
.soon {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 2px 0 6px;
}
.soon--banner {
  padding-top: 0;
}
.soon__banner {
  display: block;
}
.soon__banner img {
  display: block;
  width: 100%;
  max-height: 96px;
  object-fit: cover;
}
.soon__line {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
}
.soon__text {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.soon__title {
  overflow: hidden;
  color: var(--accent);
  font-size: 13px;
  text-decoration: none;
  white-space: nowrap;
  text-overflow: ellipsis;
}
a.soon__title:hover {
  color: var(--accent-bright);
}
/* The one line under the month reads like the bar above it: the text brightens, nothing fills. */
.datemenu .menu__i {
  color: var(--text-dim);
}
.datemenu .menu__i:hover {
  background: none;
  color: var(--text);
}
</style>
