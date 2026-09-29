<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { CalendarDays } from 'lucide-vue-next';

const props = withDefaults(defineProps<{ from?: string; to?: string }>(), { from: '', to: '' });
const emit = defineEmits<{
  (e: 'change', value: { from: string; to: string }): void;
}>();

const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_BACK = 23;
const MONTHS_AHEAD = 12;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function ymdOf(y: number, m0: number, d: number): string {
  return `${y}-${pad(m0 + 1)}-${pad(d)}`;
}
function todayYmd(): string {
  const now = new Date();
  return ymdOf(now.getFullYear(), now.getMonth(), now.getDate());
}
function fmt(d: string): string {
  const dt = new Date(`${d}T00:00:00Z`);
  return dt.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
}

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);
const scrollRef = ref<HTMLElement | null>(null);
const popupAlign = ref<'left' | 'right'>('left');

const selecting = ref(false);
const selStart = ref<string | null>(null);
const selEnd = ref<string | null>(null);
const moved = ref(false);

const hasRange = computed(() => !!props.from || !!props.to);

const triggerLabel = computed(() => {
  if (props.from && props.to) {
    return props.from === props.to ? fmt(props.from) : `${fmt(props.from)} – ${fmt(props.to)}`;
  }
  if (props.from) return `From ${fmt(props.from)}`;
  if (props.to) return `Until ${fmt(props.to)}`;
  return 'Any time';
});

const activeRange = computed<{ lo: string | null; hi: string | null }>(() => {
  if (selecting.value && moved.value && selStart.value && selEnd.value) {
    return sorted(selStart.value, selEnd.value);
  }
  return { lo: props.from || null, hi: props.to || null };
});

function sorted(a: string, b: string): { lo: string; hi: string } {
  return a <= b ? { lo: a, hi: b } : { lo: b, hi: a };
}

const rangeSummary = computed(() => {
  if (hasRange.value) return triggerLabel.value;
  return 'Click a day, or drag across days';
});

const months = computed(() => {
  const now = new Date();
  let startY = now.getFullYear();
  let startM = now.getMonth() - MONTHS_BACK;
  while (startM < 0) {
    startM += 12;
    startY -= 1;
  }
  let endY = now.getFullYear();
  let endM = now.getMonth() + MONTHS_AHEAD;
  while (endM > 11) {
    endM -= 12;
    endY += 1;
  }
  for (const bound of [props.from, props.to]) {
    if (!bound) continue;
    const by = Number(bound.slice(0, 4));
    const bm = Number(bound.slice(5, 7)) - 1;
    if (by < startY || (by === startY && bm < startM)) {
      startY = by;
      startM = bm;
    }
    if (by > endY || (by === endY && bm > endM)) {
      endY = by;
      endM = bm;
    }
  }
  const out: {
    key: string;
    label: string;
    cells: ({ day: number; ymd: string } | null)[];
  }[] = [];
  let y = startY;
  let m = startM;
  while (y < endY || (y === endY && m <= endM)) {
    const first = new Date(Date.UTC(y, m, 1));
    const lead = (first.getUTCDay() + 6) % 7;
    const daysIn = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const cells: ({ day: number; ymd: string } | null)[] = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= daysIn; d++) cells.push({ day: d, ymd: ymdOf(y, m, d) });
    out.push({ key: `${y}-${pad(m + 1)}`, label: `${MONTH_NAMES[m]} ${y}`, cells });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
});

const today = todayYmd();
function inRange(ymd: string): boolean {
  const { lo, hi } = activeRange.value;
  return lo != null && hi != null && ymd >= lo && ymd <= hi;
}
function isEdge(ymd: string): 'start' | 'end' | null {
  const { lo, hi } = activeRange.value;
  if (ymd === lo) return 'start';
  if (ymd === hi) return 'end';
  return null;
}

function commit(a: string, b: string) {
  const { lo, hi } = sorted(a, b);
  emit('change', { from: lo, to: hi });
  selStart.value = null;
  selEnd.value = null;
}

function onDown(ymd: string) {
  selecting.value = true;
  selStart.value = ymd;
  selEnd.value = ymd;
  moved.value = false;
}
function onWindowPointerMove(e: PointerEvent) {
  if (!selecting.value) return;
  const t = document.elementFromPoint(e.clientX, e.clientY);
  if (!t) return;
  const dayEl = (t as Element).closest<HTMLElement>('.drp__day');
  if (!dayEl) return;
  const ymd = dayEl.dataset.ymd;
  if (!ymd) return;
  if (ymd === selEnd.value) return;
  selEnd.value = ymd;
  if (ymd !== selStart.value) moved.value = true;
}
function onUp() {
  if (!selecting.value) return;
  selecting.value = false;
  const start = selStart.value;
  if (!start) return;
  if (moved.value && selEnd.value) {
    commit(start, selEnd.value);
  } else {
    commit(start, start);
  }
}

function clearRange() {
  selStart.value = null;
  selEnd.value = null;
  emit('change', { from: '', to: '' });
}

function toggle() {
  open.value = !open.value;
}

watch(open, (v) => {
  if (!v) {
    selecting.value = false;
    selStart.value = null;
    selEnd.value = null;
    moved.value = false;
    return;
  }
  nextTick(() => {
    if (rootRef.value) {
      const r = rootRef.value.getBoundingClientRect();
      popupAlign.value = r.left + 244 > window.innerWidth - 8 ? 'right' : 'left';
    }
    const target = (props.to || props.from || today).slice(0, 7);
    const el = scrollRef.value?.querySelector<HTMLElement>(`[data-month-key="${target}"]`);
    if (el && scrollRef.value) {
      const head = scrollRef.value.querySelector<HTMLElement>('.drp__dow-head');
      const headH = head?.offsetHeight ?? 0;
      scrollRef.value.scrollTop = Math.max(0, el.offsetTop - headH - 4);
    }
  });
});

function onOutsidePointerDown(e: PointerEvent) {
  if (!open.value) return;
  const target = e.target as Node | null;
  if (target && rootRef.value?.contains(target)) return;
  open.value = false;
}
onMounted(() => {
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointermove', onWindowPointerMove);
  window.addEventListener('pointerdown', onOutsidePointerDown);
});
onBeforeUnmount(() => {
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointermove', onWindowPointerMove);
  window.removeEventListener('pointerdown', onOutsidePointerDown);
});
</script>

<template>
  <div ref="rootRef" class="drp">
    <button
      type="button"
      class="input input--sm drp__trigger"
      :aria-expanded="open"
      :title="triggerLabel"
      @click.stop="toggle"
    >
      <CalendarDays class="ic ic--sm" />
      <span>{{ triggerLabel }}</span>
    </button>
    <div v-if="open" class="drp__pop" :class="{ 'is-right': popupAlign === 'right' }" @click.stop>
      <div class="drp__pop-head">
        <span class="drp__summary">{{ rangeSummary }}</span>
        <button v-if="hasRange" type="button" class="btn btn--sm btn--ghost" @click="clearRange">
          Clear
        </button>
      </div>
      <div ref="scrollRef" class="drp__months">
        <div class="drp__dow-head">
          <span v-for="d in DOW" :key="d">{{ d }}</span>
        </div>
        <div v-for="mo in months" :key="mo.key" class="drp__month" :data-month-key="mo.key">
          <div class="drp__month-label">{{ mo.label }}</div>
          <div class="drp__grid">
            <span
              v-for="(cell, i) in mo.cells"
              :key="`${mo.key}-${i}`"
              class="drp__day"
              :class="{
                'is-blank': !cell,
                'is-in-range': cell && inRange(cell.ymd),
                'is-start': cell && isEdge(cell.ymd) === 'start',
                'is-end': cell && isEdge(cell.ymd) === 'end',
              }"
              :data-ymd="cell ? cell.ymd : undefined"
              @pointerdown.prevent="cell && onDown(cell.ymd)"
            >{{ cell ? cell.day : '' }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.drp {
  position: relative;
  display: inline-flex;
}
.drp__trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: auto;
  white-space: nowrap;
  cursor: pointer;
}
.drp__trigger .ic {
  color: var(--text-muted);
}
.drp__pop {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 60;
  width: 244px;
  padding: 8px;
  background: var(--card);
  border: 1px solid var(--line-2);
  box-shadow: var(--shadow-md);
  font-weight: 400;
}
.drp__pop.is-right {
  left: auto;
  right: 0;
}
.drp__pop-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 26px;
  margin-bottom: 6px;
}
.drp__summary {
  font-size: 12px;
  color: var(--text-dim);
}
.drp__dow-head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
  padding-bottom: 4px;
  margin-bottom: 4px;
  background: var(--card);
  border-bottom: 1px solid var(--line);
}
.drp__dow-head span {
  text-align: center;
  font-size: 10px;
  color: var(--text-muted);
}
.drp__months {
  position: relative;
  max-height: 230px;
  overflow-y: auto;
  scrollbar-gutter: stable;
  user-select: none;
  touch-action: pan-y;
}
.drp__month + .drp__month {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--line);
}
.drp__month-label {
  margin-bottom: 4px;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.drp__grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}
.drp__day {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 24px;
  font: 11px var(--font-num);
  color: var(--text);
  border: 1px solid transparent;
  cursor: pointer;
  touch-action: none;
}
.drp__day.is-blank {
  cursor: default;
}
.drp__day:not(.is-blank):hover {
  border-color: var(--line-3);
}
.drp__day.is-in-range {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent-bright);
}
.drp__day.is-start,
.drp__day.is-end {
  background: var(--accent-fill);
  color: var(--on-accent);
  font-weight: 600;
}
</style>
