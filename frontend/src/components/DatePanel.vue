<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-vue-next';
import MonthGrid from './MonthGrid.vue';
import { api, latest } from '../lib/api';
import {
  byDay,
  longDate,
  monthName,
  monthRange,
  peakOf,
  type CalendarSpan,
  type DayInfo,
  type Mark,
} from '../lib/calendar';
import { useFocus } from '../lib/focus';
import { settled, useLive } from '../lib/live';
import { noticeLine, showsAuthor, useNotices, type Notice } from '../lib/notices';
import { usePeople } from '../lib/people';
import { useSession } from '../lib/session';
import { ink } from '../lib/theme';

defineProps<{ soon: Mark | null; withFull?: boolean; all?: boolean }>();
const emit = defineEmits<{ (e: 'day', key: string): void; (e: 'leave'): void }>();

const { t } = useI18n();
const session = useSession();
const router = useRouter();
const route = useRoute();
const { colorOf, nameOf, genderOf, load: loadPeople } = usePeople();
void loadPeople();
const { notices: everything, shown: notices, hasMore, loadMore, markRead } = useNotices();
const list = ref<HTMLDivElement | null>(null);

async function fill(): Promise<void> {
  await nextTick();
  const el = list.value;
  if (!el || !hasMore.value) return;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
    const before = everything.value.length;
    await loadMore();
    if (everything.value.length > before) void fill();
  }
}

watch(() => everything.value.length, () => void fill());

const { ask } = useFocus();

const now = new Date();
const calYear = ref(now.getFullYear());
const calMonth = ref(now.getMonth());
const calDays = ref(new Map<string, DayInfo>());
const calPeak = ref(1);

const monthReads = latest();

async function readMonth(): Promise<void> {
  const { from, to } = monthRange(calYear.value, calMonth.value);
  const mine = monthReads();
  try {
    const got = await api<CalendarSpan>(`/calendar?from=${from}&to=${to}`);
    if (!mine()) return;
    calDays.value = byDay(got.marks, got.dues, got.activity, got.mentions);
    calPeak.value = peakOf(calDays.value);
  } catch {}
}

function stepMonth(by: number): void {
  const d = new Date(calYear.value, calMonth.value + by, 1);
  calYear.value = d.getFullYear();
  calMonth.value = d.getMonth();
  void readMonth();
}

async function openNotice(n: Notice): Promise<void> {
  emit('leave');
  if (!n.read) await markRead(n.id);
  ask(n.commentId);
  await router.push({
    path: `/${n.projectShort}/${n.boardSlug}/${n.key}`,
    query: n.commentId ? { c: n.commentId } : {},
  });
}

async function toCalendar(): Promise<void> {
  emit('leave');
  await router.push({ name: 'me', query: { calendar: 'full' } });
}

onMounted(() => {
  void readMonth();
  void fill();
  window.addEventListener('resize', fill);
});
onBeforeUnmount(() => window.removeEventListener('resize', fill));
watch(() => route.path, () => void readMonth());

const rereadMonth = settled(() => void readMonth());
useLive(
  (ev) => {
    if (ev.type === 'key-date.changed') void readMonth();
    if (
      ev.type.startsWith('issue.') ||
      ev.type.startsWith('comment.') ||
      ['history.added', 'state.changed', 'board.changed', 'project.changed'].includes(ev.type)
    ) {
      rereadMonth();
    }
  },
  () => void readMonth()
);

defineExpose({ readMonth });
</script>

<template>
  <div class="dp" :class="{ 'dp--all': all }">
    <div class="datemenu__h">
      {{ monthName(calYear, calMonth) }}
      <div class="sp"></div>
      <button
        class="btn btn--sm btn--icon btn--ghost"
        type="button"
        :aria-label="t('calendar.prevMonth')"
        @click="stepMonth(-1)"
      ><ChevronLeft class="ic ic--sm" /></button>
      <button
        class="btn btn--sm btn--icon btn--ghost"
        type="button"
        :aria-label="t('calendar.nextMonth')"
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
        @pick="emit('day', $event)"
      />
    </div>
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
          <span v-if="soon.project" class="key">{{ soon.project.shortName }}</span>
        </div>
      </div>
    </template>
    <template v-if="notices.length">
      <hr />
      <div ref="list" class="dp__notices" :style="{ '--rows': notices.length }" @scroll="fill">
        <button
          v-for="n in notices"
          :key="n.id"
          class="menu__i men"
          :class="{ 'men--new': !n.read }"
          type="button"
          @click="openNotice(n)"
        >
          <span class="key" :style="{ color: ink(n.color) }">{{ n.key }}</span>
          <span v-if="n.emoji" class="men__emoji">{{ n.emoji }}</span>
          <span
            v-if="showsAuthor(n, session.me.value?.login)"
            class="men__by"
            :style="{ color: ink(colorOf(n.by)) }"
          >{{ nameOf(n.by) }}</span>
          <span class="men__said">
            {{ noticeLine(n, nameOf, genderOf) }}
          </span>
        </button>
      </div>
    </template>
    <template v-if="withFull">
      <hr />
      <button class="menu__i" type="button" @click="toCalendar">
        {{ t('calendar.full') }}
        <ArrowRight class="ic ic--sm" />
      </button>
    </template>
  </div>
</template>

<style scoped>
.dp--all {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  justify-content: flex-end;
}
.dp__notices {
  max-height: calc(5 * 32px);
  overflow-y: auto;
}
.dp--all .dp__notices {
  flex: 1 1 0;
  max-height: calc(var(--rows) * 32px);
  overflow-y: auto;
}
.dp hr {
  border: 0;
  border-top: 1px solid var(--line);
  margin: 4px 0;
}
.men__emoji {
  font-size: 12px;
}
.men .key,
.men__by {
  flex: none;
}
.men__said {
  overflow: hidden;
  color: var(--text-muted);
  white-space: nowrap;
  text-overflow: ellipsis;
}
.men--new .men__said {
  color: var(--text-dim);
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
.dp .menu__i {
  color: var(--text-dim);
}
.dp .menu__i:hover {
  background: none;
  color: var(--text);
}
</style>
