<script setup lang="ts">
import { computed, ref } from 'vue';
import { ink } from '../lib/theme';

export interface Choice {
  value: string;
  label: string;
  color?: string | null;
}

const props = defineProps<{
  modelValue: string;
  options: Choice[];
  placeholder?: string;
  keepPlaceholder?: boolean;
  small?: boolean;
  disabled?: boolean;
  label?: string;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>();

const el = ref<HTMLSelectElement | null>(null);
const current = computed(() => props.options.find((o) => o.value === props.modelValue));

function onChange(): void {
  if (!el.value) return;
  const picked = el.value.value;
  // Reset the DOM value: Vue won't re-sync :value when the parent leaves modelValue unchanged.
  el.value.value = props.modelValue;
  emit('update:modelValue', picked);
}
</script>

<template>
  <select
    ref="el"
    class="input"
    :class="{ 'input--sm': small }"
    :value="modelValue"
    :style="{ color: ink(current?.color) }"
    :disabled="disabled"
    :aria-label="label"
    @change="onChange"
  >
    <option
      v-if="placeholder !== undefined"
      value=""
      style="color: var(--text)"
      :hidden="keepPlaceholder ? !modelValue : true"
    >{{ placeholder }}</option>
    <option
      v-for="o in options"
      :key="o.value"
      :value="o.value"
      :style="{ color: ink(o.color) }"
    >{{ o.label }}</option>
  </select>
</template>
