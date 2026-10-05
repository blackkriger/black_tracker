<script setup lang="ts">
import { computed } from 'vue';
import { reducedMotion } from '../lib/motion';
import { shownTheme } from '../lib/theme';
import skyLight from '../assets/sky-light.mp4';
import skyLightStill from '../assets/sky-light.jpg';
import skyDark from '../assets/sky-dark.mp4';
import skyDarkStill from '../assets/sky-dark.jpg';

const SKIES = {
  dark: { video: skyDark, still: skyDarkStill },
  light: { video: skyLight, still: skyLightStill },
};

const sky = computed(() => SKIES[shownTheme.value]);
</script>

<template>
  <div class="sky" aria-hidden="true">
    <img v-if="reducedMotion" class="sky__media" :src="sky.still" alt="" />
    <video
      v-else
      :key="sky.video"
      class="sky__media"
      :src="sky.video"
      :poster="sky.still"
      autoplay
      muted
      loop
      playsinline
    ></video>
  </div>
</template>

<style scoped>
.sky {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: -1;
  width: inherit;
  border-right: 1px solid transparent;
  pointer-events: none;
}
.sky::after {
  content: "";
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--bg) 50%, transparent);
}
.sky__media {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: left center;
}
</style>
