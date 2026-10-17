<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Download, ExternalLink } from 'lucide-vue-next';
import { buildLink, useBuilds, type Build } from '../lib/builds';
import { fileSize, stamp } from '../lib/issues';
import { usePeople } from '../lib/people';

const props = defineProps<{ project: string }>();

const { t } = useI18n();
const { builds, loaded } = useBuilds();
const { nameOf } = usePeople();

const mine = computed(() => builds.value.filter((b) => b.project === props.project));

const metaOf = (b: Build): { text: string; num: boolean }[] =>
  [
    b.size !== null ? { text: fileSize(b.size), num: true } : null,
    { text: stamp(b.at), num: true },
    b.by ? { text: nameOf(b.by), num: false } : null,
  ].filter((part): part is { text: string; num: boolean } => part !== null);
</script>

<template>
  <div class="blist">
    <template v-if="!loaded">
      <span class="sk sk--line" style="width: 80%"></span>
      <span class="sk sk--line" style="width: 55%"></span>
    </template>
    <a
      v-for="(b, n) in mine"
      v-else
      :key="b.id"
      class="build"
      :class="{ 'build--old': n > 0 }"
      v-bind="buildLink(b)"
    >
      <component :is="b.url ? ExternalLink : Download" class="ic ic--sm build__i" />
      <span class="build__body">
        <span class="build__name">{{ b.name }}</span>
        <span class="build__meta">
          <template v-for="(part, i) in metaOf(b)" :key="i">
            <template v-if="i">, </template>
            <span :class="{ build__num: part.num }">{{ part.text }}</span>
          </template>
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
.build--old {
  opacity: 0.55;
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
