<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useProjects } from '../lib/projects';
import { usePeople } from '../lib/people';
import { useFocus } from '../lib/focus';
import { useNotices, type NoticeKind } from '../lib/notices';
import { useRoles } from '../lib/roles';
import { useLive } from '../lib/live';
import { useSession } from '../lib/session';
import DayWindow from './DayWindow.vue';
import DatePanel from './DatePanel.vue';
import { api } from '../lib/api';
import { todayKey, type Mark } from '../lib/calendar';
import { stamp } from '../lib/issues';
import { buddyAvatarStyle } from '../lib/avatar';
import { layout, narrow } from '../lib/layout';
import { AtSign, ChartColumn, ContactRound, ListChecks, Menu, Moon, Smile, Star, Sun } from 'lucide-vue-next';
import { ink, setTheme, shownTheme } from '../lib/theme';

const session = useSession();
const router = useRouter();
const route = useRoute();
const { projects, load } = useProjects();
const { load: loadPeople } = usePeople();
const mine = computed(() => session.me.value?.role?.color ?? undefined);
const { load: loadRoles } = useRoles();

const hasRole = computed(() => session.me.value?.isAdmin === true || !!session.me.value?.role);

const live = computed(() => projects.value.filter((p) => !p.archived));
const PLACES = ['project-board', 'board', 'issue'];
const here = computed(() => PLACES.includes(String(route.name)));
const currentShort = computed(() => (here.value ? String(route.params.short) : null));
const issuesTo = computed(() =>
  currentShort.value ? { name: 'issues', query: { projects: currentShort.value } } : { name: 'issues' }
);
const analyticsTo = computed(() =>
  currentShort.value ? { name: 'analytics', query: { project: currentShort.value } } : { name: 'analytics' }
);
const currentSlug = computed(() => (here.value ? String(route.params.slug ?? '').toLowerCase() : ''));
const section = computed(() => {
  const name = String(route.name ?? '');
  return name.startsWith('settings') ? 'settings' : name;
});
const at = (name: string): 'page' | undefined => (section.value === name ? 'page' : undefined);

const drawer = ref(false);
watch([() => route.fullPath, narrow], () => (drawer.value = false));
const SECTION_NAMES: Record<string, string> = { issues: 'Issues', analytics: 'Analytics', settings: 'Settings' };
const place = computed(() => {
  if (here.value) {
    const p = live.value.find((x) => x.shortName === currentShort.value);
    const b = p?.boards.find((x) => x.slug.toLowerCase() === currentSlug.value);
    return p ? { key: p.shortName, name: b?.name ?? p.name, avatar: null } : null;
  }
  const login = session.me.value?.login ?? '';
  if (section.value === 'me') return { key: null, name: login, avatar: login };
  const name = SECTION_NAMES[section.value];
  return name ? { key: null, name, avatar: null } : null;
});

const today = stamp(new Date().toISOString());
const dateOpen = ref(false);
const panel = ref<InstanceType<typeof DatePanel> | null>(null);

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

const { unreadOf, load: readNotices } = useNotices();

const KINDS: { kind: NoticeKind; icon: typeof AtSign; label: string }[] = [
  { kind: 'mention', icon: AtSign, label: 'Mentions' },
  { kind: 'assigned', icon: ContactRound, label: 'Assigned to you' },
  { kind: 'reaction', icon: Smile, label: 'Reactions' },
  { kind: 'starred', icon: Star, label: 'Starred issues' },
];
const unreadKinds = computed(() =>
  KINDS.map((k) => ({ ...k, count: unreadOf.value(k.kind) })).filter((k) => k.count)
);
const { ask } = useFocus();

async function readNext(): Promise<void> {
  try {
    soon.value = await api<Mark | null>('/calendar/next');
  } catch {}
}

function toggleDate(): void {
  dateOpen.value = !dateOpen.value;
}

const pickedDay = ref<string | null>(null);

function toDay(key: string): void {
  dateOpen.value = false;
  drawer.value = false;
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
  if (ev.key !== 'Escape') return;
  dateOpen.value = false;
  drawer.value = false;
}

useLive((ev) => {
  if (['project.changed', 'board.changed'].includes(ev.type)) void load(true);
  if (ev.type === 'key-date.changed') void readNext();
  if (['role.changed', 'user.changed'].includes(ev.type)) {
    void loadPeople(true);
    void loadRoles(true);
    void rereadMe();
  }
  if (ev.type.startsWith('comment.') || ev.type.startsWith('notice.')) void readNotices();
  if (ev.type === 'session.changed') void api('/me').catch(() => {});
}, () => {
  void load(true);
  void loadPeople(true);
  void loadRoles(true);
  void readNotices();
  void readNext();
});

async function rereadMe(): Promise<void> {
  await session.refresh();
  const me = session.me.value;
  if (me && !me.isAdmin && !me.role && route.name !== 'profile') {
    await router.replace({ name: 'profile' });
  }
}

async function signOut(): Promise<void> {
  await session.signOut();
  window.location.assign('/login');
}
</script>

<template>
  <header v-if="narrow" class="top top--narrow">
    <button
      class="topitem"
      type="button"
      aria-label="Menu"
      :aria-expanded="drawer"
      @click="drawer = !drawer"
    ><Menu class="ic" /></button>
    <span v-if="place" class="topplace">
      <span v-if="place.avatar" class="av" :style="buddyAvatarStyle(place.avatar)"></span>
      <span v-if="place.key" class="proj__k">{{ place.key }}</span>
      <span class="topitem__name">{{ place.name }}</span>
    </span>
    <div class="sp"></div>
    <button v-if="unreadKinds.length" class="topitem" type="button" aria-label="Notices" @click="drawer = true">
      <span
        v-for="k in unreadKinds"
        :key="k.kind"
        class="stamp topat"
        :style="{ color: ink(mine) }"
        :aria-label="k.label"
      ><component :is="k.icon" class="ic ic--sm" />{{ k.count }}</span>
    </button>
  </header>

  <header v-else-if="layout === 'top'" class="top">
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
            :class="{ 'is-here': p.shortName === currentShort && b.slug.toLowerCase() === currentSlug }"
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
            <span
              v-for="k in unreadKinds"
              :key="k.kind"
              class="stamp topat"
              :style="{ color: ink(mine) }"
              :aria-label="k.label"
            ><component :is="k.icon" class="ic ic--sm" />{{ k.count }}</span>
            <span class="stamp">{{ today }}</span>
          </span>
        </button>
        <div v-if="dateOpen" class="menu datemenu">
          <DatePanel ref="panel" :soon="soon" with-full @day="toDay" @leave="dateOpen = false" />
        </div>
      </span>
      <RouterLink class="topitem" :to="{ name: 'me' }" :aria-current="at('me')">
        <span class="av" :style="buddyAvatarStyle(session.me.value?.login ?? '')"></span>
        {{ session.me.value?.login }}
      </RouterLink>
      <RouterLink v-if="hasRole" class="topitem" :to="issuesTo" :aria-current="at('issues')">Issues</RouterLink>
      <RouterLink v-if="hasRole" class="topitem" :to="analyticsTo" :aria-current="at('analytics')">Analytics</RouterLink>
      <RouterLink v-if="hasRole" class="topitem" to="/settings" :aria-current="at('settings')">Settings</RouterLink>
      <button class="topitem topitem--danger" type="button" @click="signOut">Sign out</button>
    </nav>
  </header>

  <div v-if="narrow && drawer" class="rail__scrim" @click="drawer = false"></div>
  <aside v-if="narrow ? drawer : layout === 'side'" class="rail" :class="{ 'rail--drawer': narrow }">
    <nav v-if="hasRole" class="rail__sections" aria-label="Sections">
      <RouterLink class="topitem" :to="issuesTo" :aria-current="at('issues')"><ListChecks class="ic" />Issues</RouterLink>
      <RouterLink class="topitem" :to="analyticsTo" :aria-current="at('analytics')"><ChartColumn class="ic" />Analytics</RouterLink>
    </nav>

    <nav v-if="live.length" class="rail__projects" aria-label="Projects">
      <div class="side__h">Projects</div>
      <div v-for="p in live" :key="p.id" class="rail__proj">
        <RouterLink
          class="topitem topitem--project"
          :to="`/${p.shortName}`"
          :aria-current="p.shortName === currentShort ? 'page' : undefined"
        >
          <span class="proj__k">{{ p.shortName }}</span>
          <span class="topitem__name">{{ p.name }}</span>
        </RouterLink>
        <RouterLink
          v-for="b in p.boards"
          :key="b.id"
          class="topitem topitem__board rail__board"
          :class="{ 'is-here': p.shortName === currentShort && b.slug.toLowerCase() === currentSlug }"
          :to="`/${p.shortName}/${b.slug}`"
        >{{ b.name }}</RouterLink>
      </div>
    </nav>

    <div class="rail__date">
      <DatePanel ref="panel" :soon="soon" :days-left="daysOff" all @day="toDay" />
    </div>

    <nav class="rail__account" aria-label="Account">
      <div class="rail__row">
        <RouterLink class="topitem" :to="{ name: 'me' }" :aria-current="at('me')">
          <span class="av" :style="buddyAvatarStyle(session.me.value?.login ?? '')"></span>
          {{ session.me.value?.login }}
        </RouterLink>
        <div class="sp"></div>
        <RouterLink v-if="hasRole" class="topitem" to="/settings" :aria-current="at('settings')">Settings</RouterLink>
      </div>
      <div class="rail__row">
        <button class="topitem topitem--danger" type="button" @click="signOut">Sign out</button>
        <div class="sp"></div>
        <button
          class="topitem rail__theme"
          :class="{ 'is-on': shownTheme === 'light' }"
          type="button"
          aria-label="Light"
          :aria-pressed="shownTheme === 'light'"
          @click="setTheme('light')"
        ><Sun class="ic" /></button>
        <button
          class="topitem rail__theme"
          :class="{ 'is-on': shownTheme === 'dark' }"
          type="button"
          aria-label="Dark"
          :aria-pressed="shownTheme === 'dark'"
          @click="setTheme('dark')"
        ><Moon class="ic" /></button>
      </div>
    </nav>
  </aside>

  <DayWindow
    v-if="pickedDay"
    :day="pickedDay"
    @close="pickedDay = null"
    @changed="readNext(); panel?.readMonth()"
    @open="fromDay"
  />
</template>

<style scoped>
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
.topitem:hover,
.topitem[aria-current] {
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
.topproj + .topproj {
  margin-left: 10px;
}
.topitem--caret {
  gap: 6px;
  padding: 0 6px;
}
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
.rail {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  width: var(--rail-w);
  padding: var(--space-4) var(--space-3);
  border-right: 1px solid var(--line);
  background: var(--bg);
  overflow-y: auto;
}
.top--narrow {
  gap: 8px;
  padding: 0 8px;
}
.topplace {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  white-space: nowrap;
}
.topplace .topitem__name {
  overflow: hidden;
  text-overflow: ellipsis;
}
.rail--drawer {
  z-index: 40;
  width: min(300px, 86vw);
  box-shadow: var(--shadow-lg);
  overscroll-behavior: contain;
}
.rail__scrim {
  position: fixed;
  inset: 0;
  z-index: 39;
  background: var(--scrim);
}
.rail__projects {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rail__projects .side__h {
  padding-top: 0;
}
.rail__proj + .rail__proj {
  margin-top: 10px;
}
.rail__proj {
  display: flex;
  flex-direction: column;
}
.rail__board {
  height: 26px;
  padding-left: 22px;
}
.rail__sections {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.rail__date {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 6px;
}
.rail__account {
  display: flex;
  flex-direction: column;
  margin-top: auto;
}
.rail__row {
  display: flex;
  align-items: center;
}
.rail__theme {
  padding: 0 8px;
  color: var(--text-muted);
}
.rail__theme.is-on {
  color: var(--text);
}
</style>
