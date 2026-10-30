<script setup lang="ts" generic="T extends string | boolean">
defineProps<{ label: string; name: string; options: { value: T; label: string }[] }>();
const model = defineModel<T>({ required: true });
</script>

<template>
  <div class="seg" role="radiogroup" :aria-label="label">
    <label v-for="o in options" :key="String(o.value)" class="seg__i" :class="{ 'is-on': model === o.value }">
      <input v-model="model" class="sr" type="radio" :name="name" :value="o.value" />
      {{ o.label }}
    </label>
  </div>
</template>
