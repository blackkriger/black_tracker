<script setup lang="ts">
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
  --rg-h: 44px;
  --rg-step: 36px;
  --rg-line: color-mix(in srgb, var(--text) 55%, transparent);
  --rg-area: var(--surface);
  --rg-shadow: color-mix(in srgb, var(--text) 22%, transparent);
}
.rg-rows {
  display: flex;
  flex-direction: column;
  padding: 6px 2px 0;
  margin-top: calc(var(--rg-step) - var(--rg-h));
}
.rg-row {
  position: relative;
  height: var(--rg-h);
  margin-top: calc(var(--rg-step) - var(--rg-h));
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
  height: var(--rg-h);
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
