<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Link, Upload } from 'lucide-vue-next';
import Dialog from './Dialog.vue';
import { ApiError, api } from '../lib/api';
import { MAX_BUILD_BYTES, uploadBuild, useBuilds } from '../lib/builds';

const props = defineProps<{ project: string }>();
const emit = defineEmits<{ (e: 'error', message: string | null): void }>();

const { t } = useI18n();
const { load } = useBuilds();

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
  <div class="bacts">
    <button
      class="btn btn--sm btn--ghost"
      :class="{ 'btn--icon': sending === null }"
      type="button"
      :title="sending === null ? t('builds.upload') : t('builds.uploading', { percent: sending })"
      :aria-label="sending === null ? t('builds.upload') : t('builds.uploading', { percent: sending })"
      :disabled="sending !== null"
      @click="fileInput?.click()"
    >
      <Upload v-if="sending === null" class="ic" />
      <template v-else>{{ sending }}%</template>
    </button>
    <button
      class="btn btn--sm btn--icon btn--ghost"
      type="button"
      :title="t('builds.driveLink')"
      :aria-label="t('builds.driveLink')"
      @click="openDrive"
    ><Link class="ic" /></button>
    <input ref="fileInput" class="sr" type="file" tabindex="-1" @change="upload" />

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
.bacts {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
}
.bacts .btn:not(.btn--icon) {
  font: 11px/1 var(--font-num);
}
</style>
