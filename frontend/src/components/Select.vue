<script setup lang="ts">
// Every picker in the tracker: a status, a priority, a role, a tag, a person. They all
// wear the colour of what they hold, so the colour lives here rather than in each screen.
// The empty option is a label, not a choice — it is out of the list unless it is the way
// back to no filter at all.
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
  /** Shown while nothing is picked. Leave it out when the empty value means something. */
  placeholder?: string;
  /** Offers the empty option once something is picked, as the way back to nothing. */
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
  // Put it back straight away: a picker that stands for an action keeps its label, and a
  // real one is set again by the binding the moment the value arrives from above.
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
