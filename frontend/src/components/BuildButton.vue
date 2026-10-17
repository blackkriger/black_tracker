<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Download, ExternalLink, Package } from 'lucide-vue-next';
import BuildList from './BuildList.vue';
import Dialog from './Dialog.vue';
import { buildLink, useBuilds } from '../lib/builds';
import { useLive } from '../lib/live';

const props = defineProps<{ project: string }>();

const { t } = useI18n();
const { builds, load } = useBuilds();

const latest = computed(() => builds.value.find((b) => b.project === props.project) ?? null);
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
    <component :is="latest.url ? ExternalLink : Download" class="ic" />
    <span class="buildbtn__name">{{ latest.name }}</span>
  </a>
  <button
    class="btn btn--sm btn--icon btn--ghost"
    type="button"
    :title="t('builds.title')"
    :aria-label="t('builds.title')"
    @click="open = true"
  ><Package class="ic" /></button>
  <Dialog v-if="open" :title="t('builds.title')" :width="460" @close="close">
    <BuildList :project="project" @error="error = $event" />
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
