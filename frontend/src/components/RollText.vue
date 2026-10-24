<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ text: string }>();

const words = computed(() => props.text.split(' ').map((word) => [...word]));
</script>

<template>
  <span class="roll">
    <span class="sr">{{ text }}</span>
    <template v-for="(chars, w) in words" :key="w">
      <span v-if="w" class="roll__gap" aria-hidden="true"></span>
      <span class="roll__slot" aria-hidden="true">
        <Transition name="roll">
          <span :key="chars.length" class="roll__word">
            <span v-for="(ch, i) in chars" :key="i" class="roll__slot">
              <Transition name="roll">
                <span :key="ch" class="roll__ch">{{ ch }}</span>
              </Transition>
            </span>
          </span>
        </Transition>
      </span>
    </template>
  </span>
</template>

<style scoped>
.roll {
  display: inline-flex;
}
.roll__gap {
  width: 0.6em;
}
.roll__slot {
  position: relative;
  display: inline-flex;
  overflow: hidden;
}
.roll__word,
.roll__ch {
  display: inline-flex;
  white-space: pre;
}
.roll-enter-active,
.roll-leave-active {
  transition:
    transform 0.35s ease,
    opacity 0.35s ease;
}
.roll-leave-active {
  position: absolute;
  top: 0;
  left: 0;
}
.roll-enter-from {
  transform: translateY(100%);
  opacity: 0;
}
.roll-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .roll-enter-active,
  .roll-leave-active {
    transition: none;
  }
}
</style>
