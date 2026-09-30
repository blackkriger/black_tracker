<script setup lang="ts">
import { computed, ref } from 'vue';
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
function edge(key?: string): boolean {
  return !!key && !!props.range && (key === props.range.from || key === props.range.to);
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

const WAITING = ['mention', 'assigned', 'reaction'];

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

const hover = ref<{ key: string; x: number; y: number } | null>(null);
const hovered = computed(() => (hover.value ? info(hover.value.key) : null));

function onEnter(ev: MouseEvent, c: Cell): void {
  if (!c.key) return;
  const box = (ev.currentTarget as HTMLElement).getBoundingClientRect();
  hover.value = { key: c.key, x: box.left + box.width / 2, y: box.top };
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
          'is-edge': edge(c.key),
        },
      ]"
      type="button"
      :disabled="!c.day"
      :data-key="c.key"
      @click="c.key && emit('pick', c.key)"
      @pointerdown="c.key && range && emit('down', c.key)"
      @mouseenter="onEnter($event, c)"
      @mouseleave="hover = null"
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
        <Bell v-else-if="markOf(c.key) === 'marked'" class="ic ic--sm cal__bell" />
        <span v-else>{{ c.day }}</span>
      </template>
    </button>

    <div
      v-if="hover && hovered"
      class="selbar cal__pop"
      :style="{ left: `${hover.x}px`, top: `${hover.y}px` }"
    >
      <span class="cal__pop-day">{{ longDate(hover.key) }}</span>
      <span v-for="m in hovered.marks" :key="m.id" class="cal__pop-mark">
        <span v-if="m.project" class="key">{{ m.project.shortName }}</span>
        {{ m.title }}
      </span>
      <span v-for="d in hovered.dues" :key="d.key" class="cal__pop-due">
        <span class="key" :style="{ color: ink(d.color) }">{{ d.key }}</span>
        {{ d.summary }}
      </span>
      <span v-if="hovered.said" class="cal__pop-at" :style="{ color: ink(mine) }">
        {{ hovered.unread ? `${hovered.unread} unread of ` : '' }}{{ hovered.said }} for you
      </span>
      <span v-if="hovered.worked" class="cal__pop-work">
        {{ hovered.worked }} worked, {{ hovered.created }} opened,
        {{ hovered.resolved }} closed
      </span>
      <span
        v-if="!hovered.marks.length && !hovered.dues.length && !hovered.worked && !hovered.said"
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
.cal__bell {
  color: var(--accent);
}
.cal__at {
  color: var(--text);
}
.cal__pop-at {
  color: var(--text);
}
.cal__day.has-due .cal__bell {
  color: var(--accent-bright);
}
.cal__day.is-late .cal__bell {
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
.cal__day.is-picked {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 55%, transparent);
}
.cal__day.is-edge {
  box-shadow: inset 0 0 0 1px var(--text);
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
