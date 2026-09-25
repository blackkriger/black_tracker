<script setup lang="ts">
// A colour is picked from the eight the theme already uses, or typed as hex. Opens as a popover next to the swatch that owns it.
import { ref, watch } from 'vue';

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>();

// The status and tag colours the tracker ships with, plus the greys that read as "no colour in particular".
const PRESETS = [
  '#6cdcff',
  '#8effa9',
  '#d9b95c',
  '#c98eff',
  '#ff8090',
  '#ff8c42',
  '#5dd9b2',
  '#71767b',
];

const open = ref(false);
const hex = ref(props.modelValue);

watch(
  () => props.modelValue,
  (v) => {
    hex.value = v;
  }
);

function pick(color: string): void {
  emit('update:modelValue', color);
  open.value = false;
}

function commitHex(): void {
  const value = hex.value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(value)) {
    emit('update:modelValue', value.toLowerCase());
    open.value = false;
  } else {
    hex.value = props.modelValue;
  }
}
</script>

<template>
  <div class="swatch" @click.stop>
    <button
      class="swatch__btn"
      type="button"
      :style="{ background: modelValue }"
      :aria-label="`Colour ${modelValue}`"
      @click="open = !open"
    ></button>

    <div v-if="open" class="menu swatch__pop" role="dialog" aria-label="Pick a colour">
      <div class="swatch__grid">
        <button
          v-for="c in PRESETS"
          :key="c"
          type="button"
          class="swatch__cell"
          :class="{ 'is-picked': c === modelValue }"
          :style="{ background: c }"
          :aria-label="c"
          @click="pick(c)"
        ></button>
      </div>
      <div class="swatch__hex">
        <label class="label" :for="`hex-${modelValue}`">Hex</label>
        <input
          :id="`hex-${modelValue}`"
          v-model="hex"
          class="input input--sm"
          maxlength="7"
          @keydown.enter.prevent="commitHex"
          @blur="commitHex"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.swatch {
  position: relative;
  display: inline-flex;
}
.swatch__btn {
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid #000;
  cursor: pointer;
}
.swatch__pop {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 5;
  width: 232px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.swatch__grid {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 4px;
}
.swatch__cell {
  height: 22px;
  border: 1px solid #000;
  cursor: pointer;
}
.swatch__cell.is-picked {
  border: 0;
  box-shadow: 0 0 0 1px #000, 0 0 0 3px var(--accent-bright);
}
.swatch__hex {
  display: flex;
  align-items: center;
  gap: 6px;
}
.swatch__hex .input {
  font-family: var(--font-mono);
}
</style>
