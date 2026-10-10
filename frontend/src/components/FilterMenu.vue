<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ChevronDown } from 'lucide-vue-next';
import { ink } from '../lib/theme';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const props = defineProps<{
  label: string;
  options: { value: string; label: string; key?: string; color?: string | null }[];
  modelValue: string[];
}>();
const emit = defineEmits<{ (e: 'update:modelValue', value: string[]): void }>();

const open = ref(false);
const single = computed(() =>
  props.modelValue.length === 1 ? props.options.find((o) => o.value === props.modelValue[0]) : undefined
);
const summary = computed(() => {
  if (!props.modelValue.length) return t('common.all');
  if (props.modelValue.length > 1) return String(props.modelValue.length);
  return props.modelValue[0];
});
const root = ref<HTMLElement | null>(null);

function toggle(value: string): void {
  emit(
    'update:modelValue',
    props.modelValue.includes(value)
      ? props.modelValue.filter((v) => v !== value)
      : [...props.modelValue, value]
  );
}

function onOutside(ev: PointerEvent): void {
  if (open.value && ev.target instanceof Node && !root.value?.contains(ev.target)) open.value = false;
}
function onKey(ev: KeyboardEvent): void {
  if (ev.key === 'Escape') open.value = false;
}

onMounted(() => {
  window.addEventListener('pointerdown', onOutside);
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onOutside);
  window.removeEventListener('keydown', onKey);
});
</script>

<template>
  <span ref="root" class="fmenu">
    <button
      class="input input--sm fmenu__btn"
      :class="{ 'is-on': modelValue.length }"
      type="button"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span v-if="single">
        {{ label }}: <span v-if="single.key" class="proj__k">{{ single.key }}</span> {{ single.label }}
      </span>
      <span v-else>{{ label }}: {{ summary }}</span>
      <ChevronDown class="ic ic--sm" />
    </button>
    <div v-if="open" class="menu fmenu__list">
      <button
        v-for="o in options"
        :key="o.value"
        class="menu__i fmenu__i"
        :class="{ 'is-off': modelValue.length && !modelValue.includes(o.value) }"
        type="button"
        role="menuitemcheckbox"
        :aria-checked="modelValue.includes(o.value)"
        @click="toggle(o.value)"
      >
        <span v-if="o.key" class="proj__k">{{ o.key }}</span>
        <span :style="{ color: ink(o.color) }">{{ o.label }}</span>
      </button>
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
  color: var(--text-muted);
  cursor: pointer;
}
.fmenu__btn.is-on {
  color: var(--text);
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
.fmenu__i.is-off {
  opacity: 0.35;
}
.fmenu .proj__k {
  font-size: 13px;
}
</style>
