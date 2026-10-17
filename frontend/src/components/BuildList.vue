<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Download, ExternalLink, Link, Upload } from 'lucide-vue-next';
import Dialog from './Dialog.vue';
import { ApiError, api } from '../lib/api';
import { buildLink, MAX_BUILD_BYTES, uploadBuild, useBuilds, type Build } from '../lib/builds';
import { fileSize, stamp } from '../lib/issues';
import { usePeople } from '../lib/people';

const props = defineProps<{ project: string }>();
const emit = defineEmits<{ (e: 'error', message: string | null): void }>();

const { t } = useI18n();
const { builds, loaded, load } = useBuilds();
const { nameOf } = usePeople();

const mine = computed(() => builds.value.filter((b) => b.project === props.project));

const metaOf = (b: Build): { text: string; num: boolean }[] =>
  [
    b.size !== null ? { text: fileSize(b.size), num: true } : null,
    { text: stamp(b.at), num: true },
    b.by ? { text: nameOf(b.by), num: false } : null,
  ].filter((part): part is { text: string; num: boolean } => part !== null);

const fileInput = ref<HTMLInputElement | null>(null);
const sending = ref<number | null>(null);

async function upload(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || sending.value !== null) return;
  emit('error', null);
  if (file.size > MAX_BUILD_BYTES) {
    emit('error', t('builds.tooLarge'));
    return;
  }
  sending.value = 0;
  try {
    await uploadBuild(props.project, file, (share) => (sending.value = Math.round(share * 100)));
    await load(true);
  } catch (err) {
    emit('error', err instanceof ApiError && err.status === 413 ? t('builds.tooLarge') : t('builds.uploadFailed'));
  } finally {
    sending.value = null;
  }
}

const linking = ref(false);
const driveUrl = ref('');
const driveBusy = ref(false);
const driveError = ref<string | null>(null);
const driveInput = ref<HTMLInputElement | null>(null);

async function openDrive(): Promise<void> {
  linking.value = true;
  await nextTick();
  driveInput.value?.focus();
}

function closeDrive(): void {
  linking.value = false;
  driveUrl.value = '';
  driveError.value = null;
}

async function addDrive(): Promise<void> {
  const url = driveUrl.value.trim();
  if (!url || driveBusy.value) return;
  driveBusy.value = true;
  driveError.value = null;
  try {
    await api(`/builds/${encodeURIComponent(props.project)}/drive`, { method: 'POST', body: { url } });
    await load(true);
    closeDrive();
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 0;
    driveError.value =
      status === 422 ? t('builds.driveClosed') : status === 400 ? t('builds.notDriveLink') : t('builds.addFailed');
  } finally {
    driveBusy.value = false;
  }
}
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
    <div class="blist__acts">
      <button class="btn btn--sm" type="button" :disabled="sending !== null" @click="fileInput?.click()">
        <Upload class="ic" />{{ sending === null ? t('builds.upload') : t('builds.uploading', { percent: sending }) }}
      </button>
      <button class="btn btn--sm" type="button" @click="openDrive">
        <Link class="ic" />{{ t('builds.driveLink') }}
      </button>
      <input ref="fileInput" class="sr" type="file" tabindex="-1" @change="upload" />
    </div>

    <Dialog v-if="linking" :title="t('builds.driveLink')" :width="460" @close="closeDrive">
      <input
        ref="driveInput"
        v-model="driveUrl"
        class="input"
        type="url"
        placeholder="https://drive.google.com/…"
        :aria-label="t('builds.driveLink')"
        @keydown.enter.prevent="addDrive"
      />
      <div v-if="driveError" class="err">{{ driveError }}</div>
      <template #footer>
        <button class="btn" type="button" @click="closeDrive">{{ t('common.cancel') }}</button>
        <button class="btn btn--primary" type="button" :disabled="!driveUrl.trim() || driveBusy" @click="addDrive">
          {{ t('builds.add') }}
        </button>
      </template>
    </Dialog>
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
.blist__acts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}
</style>
