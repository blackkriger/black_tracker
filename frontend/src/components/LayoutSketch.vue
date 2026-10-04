<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ kind: 'top' | 'side' }>();

const COL_W = 54;
const board = computed(() =>
  props.kind === 'top'
    ? { x: 8, y: 34, gap: 8, cards: [3, 2, 1, 2] }
    : { x: 82, y: 22, gap: 6, cards: [3, 2, 1] }
);
const days = Array.from({ length: 35 }, (_, i) => ({ col: i % 7, row: Math.floor(i / 7) }));
</script>

<template>
  <svg class="sketch" viewBox="0 0 260 160" aria-hidden="true">
    <template v-if="kind === 'top'">
      <line class="f" x1="0" y1="17.5" x2="260" y2="17.5" />
      <rect class="k" x="8" y="7" width="9" height="3.5" />
      <rect class="t" x="19" y="7.25" width="18" height="3" />
      <rect class="m" x="41" y="5" width="13" height="2" />
      <rect class="m" x="41" y="10" width="10" height="2" />
      <rect class="k" x="62" y="7" width="9" height="3.5" />
      <rect class="t" x="73" y="7.25" width="14" height="3" />
      <rect class="m" x="91" y="7.5" width="8" height="2" />
      <rect class="m" x="148" y="5" width="22" height="2" />
      <rect class="k" x="128" y="10" width="3" height="2" />
      <rect class="k" x="134" y="10" width="3" height="2" />
      <rect class="k" x="140" y="10" width="3" height="2" />
      <rect class="t" x="156" y="10" width="14" height="2" />
      <circle class="t" cx="177" cy="8.5" r="3" />
      <rect class="t" x="183" y="7.5" width="12" height="2" />
      <rect class="t" x="199" y="7.5" width="10" height="2" />
      <rect class="t" x="213" y="7.5" width="12" height="2" />
      <rect class="t" x="229" y="7.5" width="11" height="2" />
      <rect class="m" x="244" y="7.5" width="9" height="2" />
      <rect class="f" x="8" y="23" width="24" height="6" />
      <line class="f" x1="36.5" y1="23" x2="36.5" y2="29" />
      <rect class="f" x="41" y="23" width="38" height="6" />
      <rect class="f" x="83" y="23" width="18" height="6" />
      <rect class="f" x="105" y="23" width="18" height="6" />
      <rect class="f" x="127" y="23" width="18" height="6" />
    </template>

    <template v-else>
      <line class="f" x1="72.5" y1="0" x2="72.5" y2="160" />
      <rect class="t" x="7" y="7" width="3" height="3" />
      <rect class="t" x="13" y="7.5" width="12" height="2" />
      <rect class="t" x="7" y="13" width="3" height="3" />
      <rect class="t" x="13" y="13.5" width="16" height="2" />
      <rect class="m" x="7" y="24" width="12" height="2" />
      <rect class="k" x="7" y="30" width="9" height="3.5" />
      <rect class="t" x="18" y="30.25" width="22" height="3" />
      <line class="f" x1="8.5" y1="37" x2="8.5" y2="52" />
      <rect class="t" x="18" y="38" width="18" height="2" />
      <rect class="m" x="18" y="43" width="14" height="2" />
      <rect class="m" x="18" y="48" width="10" height="2" />
      <rect class="m" x="7" y="70" width="22" height="2" />
      <rect class="m" x="56" y="70" width="2" height="2" />
      <rect class="m" x="62" y="70" width="2" height="2" />
      <rect
        v-for="(d, i) in days"
        :key="i"
        :class="i === 6 ? 'k' : 'm'"
        :x="7 + d.col * 8.5"
        :y="77 + d.row * 7"
        width="3"
        height="3"
      />
      <rect class="t" x="7" y="113" width="30" height="2" />
      <rect class="m" x="7" y="118" width="40" height="2" />
      <line class="f" x1="4" y1="123.5" x2="69" y2="123.5" />
      <rect class="t" x="7" y="128" width="8" height="2" />
      <rect class="t" x="17" y="128" width="10" height="2" />
      <rect class="m" x="29" y="128" width="30" height="2" />
      <rect class="t" x="7" y="134" width="8" height="2" />
      <rect class="t" x="17" y="134" width="10" height="2" />
      <rect class="m" x="29" y="134" width="24" height="2" />
      <circle class="t" cx="10" cy="146" r="3" />
      <rect class="t" x="16" y="145" width="18" height="2" />
      <circle class="m" cx="56" cy="146" r="2" />
      <circle class="t" cx="64" cy="146" r="2" />
      <rect class="m" x="7" y="153" width="16" height="2" />
      <rect class="t" x="52" y="153" width="14" height="2" />
      <rect class="f" x="82" y="8" width="24" height="6" />
      <line class="f" x1="110.5" y1="8" x2="110.5" y2="14" />
      <rect class="f" x="115" y="8" width="36" height="6" />
      <rect class="f" x="155" y="8" width="18" height="6" />
      <rect class="f" x="177" y="8" width="18" height="6" />
    </template>

    <g v-for="(n, c) in board.cards" :key="c">
      <rect
        class="col"
        :x="board.x + c * (COL_W + board.gap)"
        :y="board.y"
        :width="COL_W"
        :height="154 - board.y"
      />
      <rect class="t" :x="board.x + c * (COL_W + board.gap) + 5" :y="board.y + 5" width="16" height="2.5" />
      <g v-for="i in n" :key="i">
        <rect
          class="card"
          :x="board.x + c * (COL_W + board.gap) + 4"
          :y="board.y + 12 + (i - 1) * 20"
          :width="COL_W - 8"
          height="16"
        />
        <rect
          class="m"
          :x="board.x + c * (COL_W + board.gap) + 8"
          :y="board.y + 16 + (i - 1) * 20"
          width="8"
          height="2"
        />
        <rect
          class="t"
          :x="board.x + c * (COL_W + board.gap) + 8"
          :y="board.y + 21 + (i - 1) * 20"
          :width="COL_W - 22"
          height="2"
        />
      </g>
    </g>
  </svg>
</template>

<style scoped>
.sketch {
  display: block;
  width: 100%;
  height: auto;
  background: var(--bg);
}
.k {
  fill: currentColor;
}
.t {
  fill: currentColor;
  fill-opacity: 0.6;
}
.m {
  fill: currentColor;
  fill-opacity: 0.32;
}
.f {
  fill: none;
  stroke: currentColor;
  stroke-opacity: 0.45;
  vector-effect: non-scaling-stroke;
}
.col {
  fill: none;
  stroke: currentColor;
  stroke-opacity: 0.28;
  vector-effect: non-scaling-stroke;
}
.card {
  fill: currentColor;
  fill-opacity: 0.12;
}
</style>
