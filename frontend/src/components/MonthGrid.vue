<script setup lang="ts">
// One month, seven columns, Monday first. A day carries three things at once: what was
// marked on it, what is due on it, and how much work went through it — the shading. The
// same grid hangs in the top bar and fills the calendar screen.
import { computed, ref } from 'vue';
import { AtSign, Bell } from 'lucide-vue-next';
import {
  WEEKDAYS,
  emptyDay,
  longDate,
  monthGrid,
  todayKey,
  type Cell,
  type DayInfo,
} from '../lib/calendar';

const props = defineProps<{
  year: number;
  month: number;
  days: Map<string, DayInfo>;
  /** The busiest day in view; every other day is shaded against it. */
  peak?: number;
  compact?: boolean;
}>();

const emit = defineEmits<{ (e: 'pick', key: string): void }>();

const cells = computed(() => monthGrid(props.year, props.month));
const info = (key?: string): DayInfo => (key && props.days.get(key)) || emptyDay();

/** Five steps rather than a smooth ramp: a shade you can tell apart from its neighbour. */
function heat(key?: string): number {
  const worked = info(key).worked;
  if (!worked || !props.peak) return 0;
  return Math.min(5, Math.ceil((worked / props.peak) * 5));
}

// A deadline colours the day itself; one that has gone by with work still open turns it red.
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
  <div class="cal" :class="{ 'cal--compact': compact }">
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
        },
      ]"
      type="button"
      :disabled="!c.day"
      @click="c.key && emit('pick', c.key)"
      @mouseenter="onEnter($event, c)"
      @mouseleave="hover = null"
    >
      <!-- What is waiting comes first, then what was marked; the number is in the popup. -->
      <AtSign v-if="c.day && info(c.key).unread" class="ic ic--sm cal__at" />
      <Bell v-else-if="c.day && info(c.key).marks.length" class="ic ic--sm cal__bell" />
      <span v-else-if="c.day">{{ c.day }}</span>
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
        <span class="key" :style="{ color: d.color }">{{ d.key }}</span>
        {{ d.summary }}
      </span>
      <span v-if="hovered.said" class="cal__pop-at">
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
/* Square cells, so a month keeps its shape whatever it is given. */
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
.cal__day.is-today {
  border-color: var(--accent);
  color: var(--accent);
}
/* Last word on the colour of a day: what is due on it. */
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
  color: var(--focus);
}
.cal__pop-at {
  color: var(--focus);
}
.cal__day.has-due .cal__bell {
  color: var(--accent-bright);
}
.cal__day.is-late .cal__bell {
  color: var(--danger-text);
}
/* The day's work, in five steps of the accent. */
.cal__day.heat-1 { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.cal__day.heat-2 { background: color-mix(in srgb, var(--accent) 20%, transparent); }
.cal__day.heat-3 { background: color-mix(in srgb, var(--accent) 32%, transparent); }
.cal__day.heat-4 { background: color-mix(in srgb, var(--accent) 46%, transparent); }
.cal__day.heat-5 { background: color-mix(in srgb, var(--accent) 62%, transparent); }
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
