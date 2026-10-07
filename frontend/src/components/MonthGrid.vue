<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { AtSign, Bell, ContactRound, Smile } from 'lucide-vue-next';
import { useSession } from '../lib/session';
import {
  WEEKDAYS,
  emptyDay,
  longDate,
  monthGrid,
  todayKey,
  type Cell,
  type DayInfo,
} from '../lib/calendar';
import { markIconOf } from '../lib/markIcons';
import { ink } from '../lib/theme';

const props = defineProps<{
  year: number;
  month: number;
  days: Map<string, DayInfo>;
  peak?: number;
  compact?: boolean;
  range?: { from: string; to: string };
}>();

const emit = defineEmits<{
  (e: 'pick', key: string): void;
  (e: 'down', key: string): void;
}>();

function picked(key?: string): boolean {
  return !!key && !!props.range && key >= props.range.from && key <= props.range.to;
}

const session = useSession();
const mine = computed(() => session.me.value?.role?.color ?? undefined);

const cells = computed(() => monthGrid(props.year, props.month));
const info = (key?: string): DayInfo => (key && props.days.get(key)) || emptyDay();

function heat(key?: string): number {
  const worked = info(key).worked;
  if (!worked || !props.peak) return 0;
  return Math.min(5, Math.ceil((worked / props.peak) * 5));
}

const WAITING = ['mention', 'assigned', 'reaction', 'ping'];

function markOf(key?: string): string | null {
  const day = info(key);
  const waiting = WAITING.find((kind) => (day.unreadOf[kind] ?? 0) > 0);
  if (waiting) return waiting;
  return day.marks.length ? 'marked' : null;
}

function dueTone(key?: string): string {
  const dues = key ? info(key).dues : [];
  if (!dues.length) return '';
  return key! < todayKey() && dues.some((d) => !d.done) ? 'is-late' : 'has-due';
}

const hover = ref<{ key: string; x: number; y: number; bottom: number } | null>(null);
const hovered = computed(() => (hover.value ? info(hover.value.key) : null));
const pop = ref<HTMLDivElement | null>(null);
const shift = ref(0);
const below = ref(false);

const EDGE = 8;
const GAP = 8;
const canHover = window.matchMedia('(hover: hover)');

function fit(): void {
  const el = pop.value;
  const at = hover.value;
  if (!el || !at) return;
  const half = el.offsetWidth / 2;
  const left = at.x - half;
  const right = at.x + half;
  shift.value =
    left < EDGE ? EDGE - left : right > window.innerWidth - EDGE ? window.innerWidth - EDGE - right : 0;
  below.value = at.y - GAP - el.offsetHeight < EDGE;
}

function onEnter(ev: PointerEvent, c: Cell): void {
  if (!c.key || ev.pointerType !== 'mouse' || !canHover.matches) return;
  const box = (ev.currentTarget as HTMLElement).getBoundingClientRect();
  hover.value = { key: c.key, x: box.left + box.width / 2, y: box.top, bottom: box.bottom };
  shift.value = 0;
  below.value = false;
  void nextTick(fit);
}
</script>

<template>
  <div class="cal" :class="{ 'cal--compact': compact, 'cal--range': range }">
    <span v-for="w in WEEKDAYS" :key="w" class="cal__wd">{{ w }}</span>
    <button
      v-for="(c, i) in cells"
      :key="i"
      class="cal__day"
      :class="[
        dueTone(c.key),
        {
          'is-blank': !c.day,
          'is-weekend': c.weekend,
          'is-today': c.today,
          [`heat-${heat(c.key)}`]: heat(c.key) > 0,
          'is-picked': picked(c.key),
        },
      ]"
      type="button"
      :disabled="!c.day"
      :data-key="c.key"
      @click="c.key && emit('pick', c.key)"
      @pointerdown="c.key && range && emit('down', c.key)"
      @pointerenter="onEnter($event, c)"
      @pointerleave="hover = null"
    >
      <template v-if="c.day">
        <AtSign
          v-if="markOf(c.key) === 'mention'"
          class="ic ic--sm cal__at"
          :style="{ color: ink(mine) }"
        />
        <ContactRound
          v-else-if="markOf(c.key) === 'assigned'"
          class="ic ic--sm cal__at"
          :style="{ color: ink(mine) }"
        />
        <Smile
          v-else-if="markOf(c.key) === 'reaction'"
          class="ic ic--sm cal__at"
          :style="{ color: ink(mine) }"
        />
        <Bell
          v-else-if="markOf(c.key) === 'ping'"
          class="ic ic--sm cal__at"
          :style="{ color: ink(mine) }"
        />
        <component
          :is="markIconOf(info(c.key).marks[0]?.icon)"
          v-else-if="markOf(c.key) === 'marked'"
          class="ic ic--sm cal__mark"
        />
        <span v-else>{{ c.day }}</span>
      </template>
    </button>

    <div
      v-if="hover && hovered"
      ref="pop"
      class="selbar cal__pop"
      :class="{ 'is-below': below }"
      :style="{
        left: `${hover.x + shift}px`,
        top: `${below ? hover.bottom : hover.y}px`,
        '--tip': `calc(50% - ${shift}px)`,
      }"
    >
      <span class="cal__pop-head">
        <span class="cal__pop-day">{{ longDate(hover.key) }}</span>
        <span v-if="hovered.said" class="cal__pop-at" :style="{ color: ink(mine) }">
          {{ hovered.unread ? `${hovered.unread} unread of ` : '' }}{{ hovered.said }} for you
        </span>
      </span>
      <span v-for="m in hovered.marks" :key="m.id" class="cal__pop-mark">
        <span v-if="m.project" class="key">{{ m.project.shortName }}</span>
        {{ m.title }}
      </span>
      <span v-for="d in hovered.dues" :key="d.key" class="cal__pop-due">
        <span class="key" :style="{ color: ink(d.color) }">{{ d.key }}</span>
        {{ d.summary }}
      </span>
      <span v-if="hovered.worked || hovered.created || hovered.resolved" class="cal__pop-work">
        {{ hovered.worked }} worked, {{ hovered.created }} opened,
        {{ hovered.resolved }} closed
      </span>
      <span
        v-if="!hovered.marks.length && !hovered.dues.length && !hovered.worked && !hovered.created && !hovered.resolved && !hovered.said"
        class="cal__pop-work"
      >Nothing yet.</span>
    </div>
  </div>
</template>

<style scoped>
.cal {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 2px;
}
.cal__wd {
  padding-bottom: 4px;
  color: var(--text-muted);
  font: 10px/1 var(--font-num);
  text-align: center;
}
.cal__day {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  border: 1px solid transparent;
  background: none;
  color: var(--text-dim);
  font: 12px var(--font-num);
  cursor: pointer;
}
.cal--compact .cal__day {
  font-size: 11px;
}
.cal__day:hover:enabled {
  border-color: var(--line-2);
  color: var(--text);
}
.cal__day.is-blank {
  cursor: default;
  pointer-events: none;
}
.cal__day.is-weekend {
  color: var(--text-muted);
}
.cal__day.is-weekend:is(.heat-1, .heat-2):not(.is-today, .has-due, .is-late) {
  color: var(--text-dim);
}
.cal__day:is(.heat-3, .heat-4, .heat-5):not(.is-today, .has-due, .is-late) {
  color: var(--text);
}
.cal__day.is-today {
  border-color: var(--accent);
  color: var(--accent);
}
.cal__day.has-due,
.cal__day.has-due.is-weekend,
.cal__day.has-due.is-today {
  color: var(--accent-bright);
  font-weight: 600;
}
.cal__day.is-late,
.cal__day.is-late.is-weekend,
.cal__day.is-late.is-today {
  color: var(--danger-text);
  font-weight: 600;
}
.cal__mark {
  color: var(--accent);
}
.cal__at {
  color: var(--text);
}
.cal__pop-at {
  color: var(--text);
}
.cal__day.has-due .cal__mark {
  color: var(--accent-bright);
}
.cal__day.is-late .cal__mark {
  color: var(--danger-text);
}
.cal__day.heat-1 { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.cal__day.heat-2 { background: color-mix(in srgb, var(--accent) 20%, transparent); }
.cal__day.heat-3 { background: color-mix(in srgb, var(--accent) 32%, transparent); }
.cal__day.heat-4 { background: color-mix(in srgb, var(--accent) 46%, transparent); }
.cal__day.heat-5 { background: color-mix(in srgb, var(--accent) 62%, transparent); }
.cal--range {
  user-select: none;
}
.cal--range .cal__day {
  touch-action: none;
}
.cal--range .cal__day:not(.is-picked, .is-today, .has-due, .is-late) {
  color: var(--text-muted);
}
.cal__day.is-picked {
  font-weight: 700;
}
.cal__day.is-picked:not(.has-due, .is-late) {
  color: var(--text);
}
.cal__pop::before,
.cal__pop::after {
  left: var(--tip, 50%);
}
.cal__pop.is-below {
  transform: translate(-50%, 8px);
}
.cal__pop.is-below::before,
.cal__pop.is-below::after {
  top: auto;
  bottom: 100%;
  border-top-color: transparent;
}
.cal__pop.is-below::before {
  border-bottom-color: var(--line-2);
}
.cal__pop.is-below::after {
  margin-top: 0;
  margin-bottom: -1px;
  border-bottom-color: var(--card);
}
.cal__pop {
  flex-direction: column;
  gap: 3px;
  max-width: 320px;
  padding: 8px 10px;
  font-size: 12.5px;
  color: var(--text-dim);
  pointer-events: none;
}
.cal__pop-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.cal__pop-day {
  color: var(--text);
}
.cal__pop-mark,
.cal__pop-due {
  display: flex;
  gap: 6px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.cal__pop-mark {
  color: var(--accent);
}
.cal__pop-work {
  color: var(--text-muted);
  font: 11.5px var(--font-num);
}
</style>
