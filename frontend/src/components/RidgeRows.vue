<script setup lang="ts">
// The ridgeline stack from another project, brought over and dressed in this theme: every row is
// one thing's shape across the same axis, and the rows overlap like a range of hills so the
// whole set is read at once. The axis itself is named under the stack by whoever draws it.
import { RIDGE_H, RIDGE_W, ridgePath } from '../lib/ridge';

export interface RidgeRow {
  key: string;
  label: string;
  profile: number[];
  value: string | number | null;
  highlight?: boolean;
  color?: string;
}

withDefaults(defineProps<{ rows: RidgeRow[]; full?: number }>(), { full: 4 });
</script>

<template>
  <div class="rg">
    <div class="rg-rows">
      <div
        v-for="(row, i) in rows"
        :key="row.key"
        class="rg-row"
        :class="{ 'is-busiest': row.highlight }"
        :style="{ zIndex: i + 1, ...(row.color ? { '--rg-row-color': row.color } : {}) }"
      >
        <span class="rg-lab">{{ row.label }}</span>
        <svg class="rg-svg" :viewBox="`0 0 ${RIDGE_W} ${RIDGE_H}`" preserveAspectRatio="none">
          <path class="rg-area" :d="ridgePath(row.profile, full).area" />
          <path class="rg-line" :d="ridgePath(row.profile, full).line" />
        </svg>
        <span v-if="row.value == null" class="rg-num rg-num--nil">—</span>
        <span v-else class="rg-num">{{ row.value }}</span>
      </div>
    </div>
    <div v-if="$slots.axis" class="rg-axis"><slot name="axis" /></div>
  </div>
</template>

<style scoped>
.rg {
  display: flex;
  flex-direction: column;
  --rg-line: color-mix(in srgb, var(--text) 55%, transparent);
  /* What the area is filled with hides the rows behind each row, so it has to be the very
     colour of the panel the stack stands on. */
  --rg-area: var(--surface);
  --rg-shadow: color-mix(in srgb, var(--text) 22%, transparent);
}
.rg-rows {
  display: flex;
  flex-direction: column;
  padding: 6px 2px 0;
  /* The first row's headroom is empty by design; the stack is pulled up so that emptiness
     falls behind the chrome above rather than reading as a gap. */
  margin-top: -22px;
}
.rg-row {
  position: relative;
  height: 44px;
  margin-top: -21px;
  display: grid;
  grid-template-columns: 96px 1fr 44px;
  gap: 12px;
  align-items: end;
}
.rg-row:first-child {
  margin-top: 0;
}
.rg-lab {
  position: relative;
  z-index: 13;
  overflow: hidden;
  padding-bottom: 2px;
  color: var(--text-dim);
  font: 10.5px var(--font-ui);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rg-row.is-busiest .rg-lab {
  color: var(--accent-bright);
  font-weight: 700;
}
.rg-svg {
  display: block;
  width: 100%;
  height: 44px;
  overflow: visible;
}
.rg-area {
  fill: var(--rg-area);
}
.rg-line {
  fill: none;
  stroke: var(--rg-row-color, var(--rg-line));
  stroke-width: 1.6;
  vector-effect: non-scaling-stroke;
  stroke-linejoin: round;
  filter: drop-shadow(0 -1px 3px var(--rg-shadow));
}
.rg-row.is-busiest .rg-line {
  stroke: var(--accent-bright);
  filter: drop-shadow(0 -1px 4px color-mix(in srgb, var(--accent-bright) 35%, transparent));
}
.rg-num {
  position: relative;
  z-index: 13;
  padding-bottom: 2px;
  color: var(--text);
  font: 700 14px var(--font-num);
  text-align: right;
}
.rg-row.is-busiest .rg-num {
  color: var(--accent-bright);
}
.rg-num--nil {
  color: var(--text-muted);
  font: 10px var(--font-ui);
}
/* The axis the rows share, named once under the whole stack. */
.rg-axis {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin: 10px 44px 0 108px;
  color: var(--text-dim);
  font: 10.5px var(--font-ui);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
</style>
