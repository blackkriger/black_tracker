<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { ChevronLeft } from 'lucide-vue-next';

const props = defineProps<{
  initial: string;
  anchor: HTMLElement | null;
}>();
const emit = defineEmits<{ pick: [hex: string]; close: [] }>();

const DEFAULT_COLORS: { name: string; color: string }[] = [
  { name: 'Backlog', color: '#e0917f' },
  { name: 'In progress', color: '#6cdcff' },
  { name: 'Review', color: '#c98eff' },
  { name: 'Done', color: '#8effa9' },
  { name: "Won't Fix", color: '#7d8188' },
  { name: 'Duplicate', color: '#9aa3ad' },
];

const TONES: [number, number][] = [
  [62, 64],
  [70, 78],
];

const r = ref(0);
const g = ref(0);
const b = ref(0);

const hsl = computed(() => rgbToHsl(r.value, g.value, b.value));
const hex = computed(() => rgbToHex(r.value, g.value, b.value));

function rgbToHsl(rr: number, gg: number, bb: number): { h: number; s: number; l: number } {
  const rN = rr / 255;
  const gN = gg / 255;
  const bN = bb / 255;
  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rN) h = (gN - bN) / d + (gN < bN ? 6 : 0);
    else if (max === gN) h = (bN - rN) / d + 2;
    else h = (rN - gN) / d + 4;
    h /= 6;
  }
  return { h: Math.round(h * 240), s: Math.round(s * 240), l: Math.round(l * 240) };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hN = h / 240;
  const sN = s / 240;
  const lN = l / 240;
  if (sN === 0) {
    const v = Math.round(lN * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number): number => {
    let tN = t;
    if (tN < 0) tN += 1;
    if (tN > 1) tN -= 1;
    if (tN < 1 / 6) return p + (q - p) * 6 * tN;
    if (tN < 1 / 2) return q;
    if (tN < 2 / 3) return p + (q - p) * (2 / 3 - tN) * 6;
    return p;
  };
  const q = lN < 0.5 ? lN * (1 + sN) : lN + sN - lN * sN;
  const p = 2 * lN - q;
  return {
    r: Math.round(hue2rgb(p, q, hN + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, hN) * 255),
    b: Math.round(hue2rgb(p, q, hN - 1 / 3) * 255),
  };
}

function hexToRgb(hexStr: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hexStr);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function rgbToHex(rr: number, gg: number, bb: number): string {
  const toH = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toH(rr)}${toH(gg)}${toH(bb)}`;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function setRgb(rr: number, gg: number, bb: number): void {
  r.value = clamp(Math.round(rr), 0, 255);
  g.value = clamp(Math.round(gg), 0, 255);
  b.value = clamp(Math.round(bb), 0, 255);
}

function setHsl(h: number, s: number, l: number): void {
  const rgb = hslToRgb(clamp(Math.round(h), 0, 240), clamp(Math.round(s), 0, 240), clamp(Math.round(l), 0, 240));
  setRgb(rgb.r, rgb.g, rgb.b);
}

function setHex(hx: string): void {
  const rgb = hexToRgb(hx);
  if (rgb) setRgb(rgb.r, rgb.g, rgb.b);
}

setHex(props.initial);

const BASIC_PALETTE: string[] = TONES.flatMap(([s, l]) =>
  Array.from({ length: 24 }, (_, i) => {
    const rgb = hslToRgb((i * 15 * 240) / 360, (s * 240) / 100, (l * 240) / 100);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
  })
);

const popupEl = ref<HTMLDivElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);
const sliderEl = ref<HTMLDivElement | null>(null);
const CANVAS_W = 200;
const CANVAS_H = 200;

function paintCanvas(): void {
  const ctx = canvasEl.value?.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(CANVAS_W, CANVAS_H);
  for (let y = 0; y < CANVAS_H; y++) {
    const sat = (1 - y / (CANVAS_H - 1)) * 240;
    for (let x = 0; x < CANVAS_W; x++) {
      const rgb = hslToRgb((x / (CANVAS_W - 1)) * 240, sat, 120);
      const idx = (y * CANVAS_W + x) * 4;
      img.data[idx] = rgb.r;
      img.data[idx + 1] = rgb.g;
      img.data[idx + 2] = rgb.b;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

const canvasMarkerStyle = computed(() => ({
  left: `${(hsl.value.h / 240) * (CANVAS_W - 1)}px`,
  top: `${(1 - hsl.value.s / 240) * (CANVAS_H - 1)}px`,
}));

const sliderGradient = computed(() => {
  const mid = hslToRgb(hsl.value.h, hsl.value.s, 120);
  return `linear-gradient(to bottom, #ffffff 0%, ${rgbToHex(mid.r, mid.g, mid.b)} 50%, #000000 100%)`;
});

const sliderMarkerStyle = computed(() => ({ top: `${(1 - hsl.value.l / 240) * (CANVAS_H - 1)}px` }));

function applyCanvasPos(ev: PointerEvent): void {
  const c = canvasEl.value;
  if (!c) return;
  const rect = c.getBoundingClientRect();
  const x = clamp(ev.clientX - rect.left, 0, rect.width);
  const y = clamp(ev.clientY - rect.top, 0, rect.height);
  let l = hsl.value.l;
  if (l <= 0 || l >= 240) l = 120;
  setHsl((x / rect.width) * 240, (1 - y / rect.height) * 240, l);
}

function applySliderPos(ev: PointerEvent): void {
  const el = sliderEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const y = clamp(ev.clientY - rect.top, 0, rect.height);
  setHsl(hsl.value.h, hsl.value.s, (1 - y / rect.height) * 240);
}

function startDrag(ev: PointerEvent, apply: (ev: PointerEvent) => void): void {
  ev.preventDefault();
  const el = ev.currentTarget as HTMLElement;
  el.setPointerCapture(ev.pointerId);
  apply(ev);
  const move = (e: PointerEvent): void => apply(e);
  const up = (): void => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

const hInput = computed({ get: () => hsl.value.h, set: (v: number) => setHsl(v, hsl.value.s, hsl.value.l) });
const sInput = computed({ get: () => hsl.value.s, set: (v: number) => setHsl(hsl.value.h, v, hsl.value.l) });
const lInput = computed({ get: () => hsl.value.l, set: (v: number) => setHsl(hsl.value.h, hsl.value.s, v) });
const rInput = computed({ get: () => r.value, set: (v: number) => setRgb(v, g.value, b.value) });
const gInput = computed({ get: () => g.value, set: (v: number) => setRgb(r.value, v, b.value) });
const bInput = computed({ get: () => b.value, set: (v: number) => setRgb(r.value, g.value, v) });

const EDGE = 8;
const GAP = 8;
const popupStyle = ref<Record<string, string>>({ visibility: 'hidden' });
const side = ref<'below' | 'above' | null>(null);

function placePopup(): void {
  const el = popupEl.value;
  if (!el) return;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const a = props.anchor?.getBoundingClientRect();
  if (!a) {
    side.value = null;
    popupStyle.value = { left: `${Math.max(EDGE, (vw - w) / 2)}px`, top: `${Math.max(EDGE, (vh - h) / 2)}px` };
    return;
  }
  const middle = (a.left + a.right) / 2;
  const left = clamp(middle - w / 2, EDGE, Math.max(EDGE, vw - EDGE - w));
  const roomBelow = vh - EDGE - a.bottom - GAP;
  const roomAbove = a.top - GAP - EDGE;
  let top: number;
  if (h <= roomBelow || roomBelow >= roomAbove) {
    top = a.bottom + GAP;
    side.value = 'below';
  } else {
    top = a.top - GAP - h;
    side.value = 'above';
  }
  if (top < EDGE || top + h > vh - EDGE) {
    top = clamp(top, EDGE, Math.max(EDGE, vh - EDGE - h));
    side.value = null;
  }
  popupStyle.value = { left: `${left}px`, top: `${top}px`, '--tip': `${middle - left}px` };
}

function onOutside(ev: PointerEvent): void {
  const target = ev.target as Node;
  if (popupEl.value?.contains(target) || props.anchor?.contains(target)) return;
  emit('close');
}

function onKey(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') {
    ev.preventDefault();
    emit('close');
  }
  if (ev.key === 'Enter' && !(ev.target instanceof HTMLButtonElement)) {
    ev.preventDefault();
    (ev.target as HTMLElement | null)?.blur();
    emit('pick', hex.value);
  }
}

onMounted(() => {
  paintCanvas();
  void nextTick(placePopup);
  setTimeout(() => window.addEventListener('pointerdown', onOutside), 0);
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', placePopup);
  window.addEventListener('scroll', placePopup, true);
});

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onOutside);
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('resize', placePopup);
  window.removeEventListener('scroll', placePopup, true);
});
</script>

<template>
  <Teleport to="body">
    <div ref="popupEl" class="cp" :class="side && `is-${side}`" :style="popupStyle">
      <div class="cp__top">
        <div class="cp__left">
          <div class="cp__group">
            <div class="cp__label">Basic colors:</div>
            <div class="cp__grid">
              <button
                v-for="c in BASIC_PALETTE"
                :key="c"
                type="button"
                class="cp__swatch"
                :class="{ 'is-active': c === hex }"
                :style="{ background: c }"
                :title="c"
                @click="setHex(c)"
              ></button>
            </div>
          </div>
          <div class="cp__group">
            <div class="cp__label">Default colors:</div>
            <div class="cp__grid">
              <button
                v-for="d in DEFAULT_COLORS"
                :key="d.name"
                type="button"
                class="cp__swatch"
                :class="{ 'is-active': d.color === hex }"
                :style="{ background: d.color }"
                :title="d.name"
                @click="setHex(d.color)"
              ></button>
            </div>
          </div>
        </div>
        <div class="cp__field">
          <div class="cp__canvas-wrap">
            <canvas
              ref="canvasEl"
              :width="CANVAS_W"
              :height="CANVAS_H"
              class="cp__canvas"
              @pointerdown="startDrag($event, applyCanvasPos)"
            ></canvas>
            <div class="cp__canvas-marker" :style="canvasMarkerStyle"></div>
          </div>
          <div
            ref="sliderEl"
            class="cp__slider"
            :style="{ background: sliderGradient }"
            @pointerdown="startDrag($event, applySliderPos)"
          >
            <ChevronLeft class="ic ic--sm cp__slider-marker" :style="sliderMarkerStyle" />
          </div>
        </div>
      </div>

      <div class="cp__bottom">
        <div class="cp__preview" :style="{ background: hex }"></div>
        <div class="cp__inputs">
          <label class="cp__input-row">
            <span>Hue:</span>
            <input v-model.number.lazy="hInput" class="input" type="number" min="0" max="240" />
          </label>
          <label class="cp__input-row">
            <span>Sat:</span>
            <input v-model.number.lazy="sInput" class="input" type="number" min="0" max="240" />
          </label>
          <label class="cp__input-row">
            <span>Lum:</span>
            <input v-model.number.lazy="lInput" class="input" type="number" min="0" max="240" />
          </label>
          <label class="cp__input-row">
            <span>Red:</span>
            <input v-model.number.lazy="rInput" class="input" type="number" min="0" max="255" />
          </label>
          <label class="cp__input-row">
            <span>Green:</span>
            <input v-model.number.lazy="gInput" class="input" type="number" min="0" max="255" />
          </label>
          <label class="cp__input-row">
            <span>Blue:</span>
            <input v-model.number.lazy="bInput" class="input" type="number" min="0" max="255" />
          </label>
        </div>
        <div class="cp__actions">
          <button class="btn btn--sm" type="button" @click="emit('close')">Cancel</button>
          <button class="btn btn--sm btn--primary" type="button" @click="emit('pick', hex)">OK</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cp {
  position: fixed;
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: calc(100vw - 16px);
  padding: 12px;
  background: var(--card);
  border: 1px solid var(--line-2);
  box-shadow: var(--shadow-md);
  user-select: none;
}
.cp.is-below::before,
.cp.is-below::after,
.cp.is-above::before,
.cp.is-above::after {
  content: "";
  position: absolute;
  left: var(--tip, 50%);
  margin-left: -6px;
  border: 6px solid transparent;
}
.cp.is-below::before,
.cp.is-below::after {
  bottom: 100%;
}
.cp.is-below::before {
  border-bottom-color: var(--line-2);
}
.cp.is-below::after {
  margin-bottom: -1px;
  border-bottom-color: var(--card);
}
.cp.is-above::before,
.cp.is-above::after {
  top: 100%;
}
.cp.is-above::before {
  border-top-color: var(--line-2);
}
.cp.is-above::after {
  margin-top: -1px;
  border-top-color: var(--card);
}
.cp__top {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
.cp__left {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
}
.cp__group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cp__label {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 16px;
}
.cp__grid {
  display: grid;
  grid-template-columns: repeat(8, 22px);
  grid-auto-rows: 18px;
  gap: 4px;
}
.cp__swatch {
  width: 22px;
  height: 18px;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--black) 35%, transparent);
  cursor: pointer;
}
.cp__swatch:hover {
  outline: 1px solid var(--text-dim);
  outline-offset: 1px;
}
.cp__swatch.is-active {
  outline: 1px solid var(--text);
  outline-offset: 1px;
}
.cp__field {
  display: flex;
  gap: 6px;
  padding-right: 11px;
}
.cp__canvas-wrap {
  position: relative;
  flex: none;
  width: 200px;
  height: 200px;
  border: 1px solid var(--line-2);
  box-sizing: content-box;
}
.cp__canvas {
  display: block;
  width: 200px;
  height: 200px;
  cursor: crosshair;
  touch-action: none;
}
.cp__canvas-marker {
  position: absolute;
  width: 11px;
  height: 11px;
  margin: -6px 0 0 -6px;
  border: 2px solid var(--black);
  box-shadow: inset 0 0 0 1px var(--on-accent);
  pointer-events: none;
}
.cp__slider {
  position: relative;
  flex: none;
  width: 12px;
  height: 200px;
  border: 1px solid var(--line-2);
  box-sizing: content-box;
  cursor: ns-resize;
  touch-action: none;
}
.cp__slider-marker {
  position: absolute;
  left: 13px;
  margin-top: -6px;
  color: var(--text);
  pointer-events: none;
}
.cp__bottom {
  display: flex;
  gap: 12px;
}
.cp__preview {
  flex: none;
  width: 56px;
  border: 1px solid var(--line-2);
}
.cp__inputs {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(3, auto);
  justify-content: space-between;
  gap: 4px 8px;
}
.cp__input-row {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-dim);
  font-size: 12px;
}
.cp__input-row span {
  min-width: 40px;
  text-align: right;
}
.cp__input-row .input {
  width: 52px;
  height: 26px;
  padding: 0 6px;
  font: 12px var(--font-num);
  text-align: right;
  appearance: textfield;
}
.cp__input-row .input::-webkit-inner-spin-button,
.cp__input-row .input::-webkit-outer-spin-button {
  margin: 0;
  appearance: none;
}
.cp__actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
@media (max-width: 520px) {
  .cp__inputs {
    grid-template-columns: none;
    grid-template-rows: repeat(3, auto);
    grid-auto-flow: column;
  }
}
</style>
