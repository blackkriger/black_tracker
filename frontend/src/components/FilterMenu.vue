<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { ChevronDown } from 'lucide-vue-next';
import { ink } from '../lib/theme';

const props = defineProps<{
  label: string;
  options: { value: string; label: string; color?: string | null }[];
  modelValue: string[];
}>();
const emit = defineEmits<{ (e: 'update:modelValue', value: string[]): void }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);

function toggle(value: string): void {
  emit(
    'update:modelValue',
    props.modelValue.includes(value)
      ? props.modelValue.filter((v) => v !== value)
      : [...props.modelValue, value]
  );
}

function onOutside(ev: MouseEvent): void {
  if (open.value && ev.target instanceof Node && !root.value?.contains(ev.target)) open.value = false;
}
function onKey(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') open.value = false;
}

onMounted(() => {
  window.addEventListener('click', onOutside);
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  window.removeEventListener('click', onOutside);
  window.removeEventListener('keydown', onKey);
});
</script>

<template>
  <span ref="root" class="fmenu">
    <button
      class="input input--sm fmenu__btn"
      type="button"
      :aria-expanded="open"
      @click="open = !open"
    >
      {{ label }}: {{ modelValue.length || 'all' }}
      <ChevronDown class="ic ic--sm" />
    </button>
    <div v-if="open" class="menu fmenu__list">
      <label v-for="o in options" :key="o.value" class="menu__i fmenu__i">
        <input type="checkbox" :checked="modelValue.includes(o.value)" @change="toggle(o.value)" />
        <span :style="{ color: ink(o.color) }">{{ o.label }}</span>
      </label>
    </div>
  </span>
</template>

<style scoped>
.fmenu {
  position: relative;
  display: inline-flex;
}
.fmenu__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: auto;
  height: 26px;
  padding: 0 6px 0 8px;
  border-color: var(--line);
  color: var(--text-dim);
  cursor: pointer;
}
.fmenu__btn:hover,
.fmenu__btn[aria-expanded='true'] {
  color: var(--text);
}
.fmenu__list {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 20;
  max-height: 320px;
  overflow-y: auto;
}
.fmenu__i {
  gap: 8px;
  cursor: pointer;
}
</style>
