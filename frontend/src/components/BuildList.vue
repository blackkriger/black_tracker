<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Download, ExternalLink } from 'lucide-vue-next';
import PersonName from './PersonName.vue';
import { buildLink, platformLabel, useBuilds, type Build } from '../lib/builds';
import { fileSize, stamp } from '../lib/issues';

const props = defineProps<{ project: string }>();

const { t } = useI18n();
const { builds, loaded } = useBuilds();

const mine = computed(() => builds.value.filter((b) => b.project === props.project));

const numbersOf = (b: Build): string[] => [...(b.size !== null ? [fileSize(b.size)] : []), stamp(b.at)];
</script>

<template>
  <div class="blist">
    <template v-if="!loaded">
      <span class="sk sk--line" style="width: 80%"></span>
      <span class="sk sk--line" style="width: 55%"></span>
    </template>
    <a v-for="b in mine" v-else :key="b.id" class="build" v-bind="buildLink(b)">
      <component :is="b.url ? ExternalLink : Download" class="ic ic--sm build__i" />
      <span class="build__body">
        <span class="build__name">{{ b.name }}</span>
        <span class="build__meta">
          {{ platformLabel(b.platform) }},
          <template v-for="(part, i) in numbersOf(b)" :key="i">
            <template v-if="i">, </template>
            <span class="build__num">{{ part }}</span>
          </template>
          <template v-if="b.by">, <PersonName :login="b.by" /></template>
        </span>
      </span>
    </a>
    <span v-if="loaded && !mine.length" class="hint faint">{{ t('builds.none') }}</span>
  </div>
</template>

<style scoped>
.blist {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.build {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
  color: var(--text-dim);
  text-decoration: none;
}
.build:hover {
  color: var(--text);
}
.build__i {
  flex: none;
  margin-top: 3px;
  color: var(--text-muted);
}
.build__body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.build__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.build__meta {
  color: var(--text-muted);
  font-size: 12px;
}
.build__num {
  font: 11px/1.2 var(--font-num);
}
</style>
