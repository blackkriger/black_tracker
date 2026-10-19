<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Download, ExternalLink, Package } from 'lucide-vue-next';
import BuildActions from './BuildActions.vue';
import BuildList from './BuildList.vue';
import Dialog from './Dialog.vue';
import { buildLink, useBuilds, viewerPlatform } from '../lib/builds';
import { useLive } from '../lib/live';

const props = defineProps<{ project: string }>();

const { t } = useI18n();
const { builds, load } = useBuilds();

const latest = computed(() => {
  const mine = builds.value.filter((b) => b.project === props.project);
  const platform = viewerPlatform();
  return mine.find((b) => b.platform === platform) ?? [...mine].sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
});
const open = ref(false);
const error = ref<string | null>(null);

function close(): void {
  open.value = false;
  error.value = null;
}

onMounted(() => void load());
useLive(
  (ev) => {
    if (ev.type === 'build.changed') void load(true);
  },
  () => void load(true)
);
</script>

<template>
  <a v-if="latest" class="btn btn--sm btn--ghost buildbtn" :title="latest.name" v-bind="buildLink(latest)">
    <span class="buildbtn__name">{{ latest.name }}</span>
    <component :is="latest.url ? ExternalLink : Download" class="ic" />
  </a>
  <button
    class="btn btn--sm btn--icon btn--ghost"
    type="button"
    :title="t('builds.title')"
    :aria-label="t('builds.title')"
    @click="open = true"
  ><Package class="ic" /></button>
  <Dialog v-if="open" :title="t('builds.title')" :width="460" @close="close">
    <template #actions>
      <BuildActions :project="project" @error="error = $event" />
    </template>
    <BuildList :project="project" />
    <div v-if="error" class="err">{{ error }}</div>
  </Dialog>
</template>

<style scoped>
.buildbtn {
  max-width: 260px;
}
.buildbtn__name {
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
