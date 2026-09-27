<script setup lang="ts">
// The bar every screen but sign-in carries: the projects side by side, each naming the board it would open, and who you are.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useProjects, type ProjectMini } from '../lib/projects';
import { usePeople } from '../lib/people';
import { useMentions, type Mention } from '../lib/mentionFeed';
import { useRoles } from '../lib/roles';
import { lastBoard } from '../lib/lastProject';
import { useLive } from '../lib/live';
import { useSession } from '../lib/session';
import MonthGrid from './MonthGrid.vue';
import { api } from '../lib/api';
import {
  byDay,
  longDate,
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
import { AtSign, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-vue-next';

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

// Which project's menu is open.
const openShort = ref<string | null>(null);

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
const { mentions, unread, load: readMentions, markRead } = useMentions();

async function openMention(m: Mention): Promise<void> {
  dateOpen.value = false;
  if (!m.read) await markRead(m.commentId);
  await router.push(`/${m.projectShort}/${m.boardSlug}/${m.key}`);
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
  openShort.value = null;
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
  await router.push('/calendar');
}

// A day picked here opens on the calendar screen, where there is room to say what is on it.
async function toDay(key: string): Promise<void> {
  dateOpen.value = false;
  await router.push({ path: '/calendar', query: { day: key } });
}

// The board each project would open, read once from storage and kept in step as you move around, since localStorage itself is not reactive.
const remembered = ref<Record<string, string>>({});
watch(
  live,
  (rows) => {
    const next: Record<string, string> = { ...remembered.value };
    for (const p of rows) {
      const slug = lastBoard.get(p.shortName);
      if (slug) next[p.shortName] = slug;
    }
    remembered.value = next;
  },
  { immediate: true }
);
watch(
  () => [currentShort.value, props.board?.slug] as const,
  ([short, slug]) => {
    if (short && slug) remembered.value = { ...remembered.value, [short]: slug };
  },
  { immediate: true }
);

// The screen knows better than storage which board it settled on, so it wins for the project you are on.
function shownBoard(p: ProjectMini): { name: string; slug: string } | null {
  if (p.shortName === currentShort.value && props.board) return props.board;
  if (!p.boards.length) return null;
  return p.boards.find((b) => b.slug === remembered.value[p.shortName]) ?? p.boards[0];
}

onMounted(() => {
  void load();
  void readNext();
  void readMentions();
  window.addEventListener('click', closeMenu);
  window.addEventListener('keydown', onKeydown);
});
onUnmounted(() => {
  window.removeEventListener('click', closeMenu);
  window.removeEventListener('keydown', onKeydown);
});

function closeMenu(): void {
  openShort.value = null;
  dateOpen.value = false;
}
function onKeydown(ev: KeyboardEvent): void {
  if (ev.key !== 'Escape') return;
  openShort.value = null;
  dateOpen.value = false;
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
  if (ev.type.startsWith('comment.') || ev.type.startsWith('mention.')) void readMentions();
});

async function pickBoard(short: string, slug: string): Promise<void> {
  openShort.value = null;
  lastBoard.set(short, slug);
  remembered.value = { ...remembered.value, [short]: slug };
  await router.push(`/${short}/${slug}`);
}

async function signOut(): Promise<void> {
  await session.signOut();
  await router.push({ name: 'login' });
}
</script>

<template>
  <header class="top">
    <nav v-if="live.length" class="topitems" aria-label="Projects">
      <span v-for="p in live" :key="p.id" class="topproj" @click.stop>
        <RouterLink
          class="topitem topitem--project"
          :to="`/${p.shortName}`"
          :aria-current="p.shortName === currentShort ? 'page' : undefined"
        >
          <span class="proj__k">{{ p.shortName }}</span>
          <span class="topitem__name">{{ p.name }}</span>
        </RouterLink>

        <span v-if="p.boards.length > 1" class="boardpick">
          <button
            class="topitem topitem--caret"
            type="button"
            :aria-expanded="openShort === p.shortName"
            :aria-label="`Boards of ${p.name}`"
            @click="openShort = openShort === p.shortName ? null : p.shortName"
          >
            <span class="topitem__board">{{ shownBoard(p)?.name }}</span>
            <ChevronDown class="ic ic--sm" />
          </button>

          <div v-if="openShort === p.shortName" class="menu boardmenu" role="menu">
            <button
              v-for="b in p.boards"
              :key="b.id"
              class="menu__i"
              :class="{ 'is-cur': b.slug === shownBoard(p)?.slug }"
              type="button"
              role="menuitem"
              @click="pickBoard(p.shortName, b.slug)"
            >{{ b.name }}</button>
          </div>
        </span>
        <RouterLink
          v-else-if="p.boards.length === 1"
          class="topitem topitem--caret topitem__board"
          :to="`/${p.shortName}/${p.boards[0].slug}`"
        >{{ p.boards[0].name }}</RouterLink>
      </span>
    </nav>

    <div class="sp"></div>

    <nav class="topitems" aria-label="Account">
      <span class="datepick" @click.stop>
        <button
          class="topitem topitem--caret"
          type="button"
          :aria-expanded="dateOpen"
          aria-label="Calendar"
          @click="toggleDate"
        >
          <span v-if="countdown" class="stamp topcount">{{ countdown }}</span>
          <span class="stamp">{{ today }}</span>
          <span v-if="unread" class="stamp topat" :style="{ color: mine }">
            <AtSign class="ic ic--sm" />{{ unread }}
          </span>
        </button>
        <div v-if="dateOpen" class="menu datemenu">
          <template v-if="mentions.length">
            <button
              v-for="m in mentions.slice(0, 5)"
              :key="m.commentId"
              class="menu__i men"
              :class="{ 'men--new': !m.read }"
              type="button"
              @click="openMention(m)"
            >
              <span class="key">{{ m.key }}</span>
              <span class="men__said">{{ m.by }}: {{ m.said }}</span>
            </button>
            <hr />
          </template>
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
                  <span class="stamp">{{ longDate(soon.day) }}</span>
                </span>
                <!-- A day that belongs to one project says which, against both lines. -->
                <span v-if="soon.project" class="key">{{ soon.project.shortName }}</span>
              </div>
            </div>
          </template>
          <hr />
          <button class="menu__i" type="button" @click="toCalendar">Full calendar</button>
        </div>
      </span>
      <RouterLink class="topitem" to="/profile">{{ session.me.value?.login }}</RouterLink>
      <RouterLink v-if="hasRole" class="topitem" to="/settings">Settings</RouterLink>
      <button class="topitem topitem--danger" type="button" @click="signOut">Sign out</button>
    </nav>
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
.topitem--caret {
  gap: 6px;
  padding: 0 6px;
}
.topitem__board {
  color: var(--text);
  font-size: 13px;
}
.topitem__caret {
  font-size: 10px;
}
.boardpick {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.boardmenu {
  position: absolute;
  top: calc(100% + 7px);
  left: 0;
  z-index: 20;
}
/* The pointer above the menu, drawn twice: the border's triangle, then the surface's one pixel lower to cover the line under it. */
.boardmenu::before,
.boardmenu::after {
  content: "";
  position: absolute;
  bottom: 100%;
  left: 11px;
  border: 6px solid transparent;
}
.boardmenu::before {
  border-bottom-color: var(--line-2);
}
.boardmenu::after {
  margin-bottom: -1px;
  border-bottom-color: var(--card);
}
.topitem--danger:hover {
  color: var(--danger-text);
}
.datepick {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.topat {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--text);
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
