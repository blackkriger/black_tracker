<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Link, Upload } from 'lucide-vue-next';
import Dialog from './Dialog.vue';
import { ApiError, api } from '../lib/api';
import {
  MAX_BUILD_BYTES,
  PLATFORMS,
  platformOfFile,
  platformOfName,
  uploadBuild,
  useBuilds,
  viewerPlatform,
  type Platform,
} from '../lib/builds';

const props = defineProps<{ project: string }>();
const emit = defineEmits<{ (e: 'error', message: string | null): void }>();

const { t } = useI18n();
const { load } = useBuilds();

const fileInput = ref<HTMLInputElement | null>(null);
const picked = ref<File | null>(null);
const pickedPlatform = ref<Platform>('windows');
const sending = ref<number | null>(null);

async function pick(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || sending.value !== null) return;
  emit('error', null);
  if (file.size > MAX_BUILD_BYTES) {
    emit('error', t('builds.tooLarge'));
    return;
  }
  pickedPlatform.value = (await platformOfFile(file)) ?? viewerPlatform();
  picked.value = file;
}

async function upload(): Promise<void> {
  const file = picked.value;
  if (!file) return;
  const platform = pickedPlatform.value;
  picked.value = null;
  sending.value = 0;
  try {
    await uploadBuild(props.project, platform, file, (share) => (sending.value = Math.round(share * 100)));
    await load(true);
  } catch (err) {
    emit('error', err instanceof ApiError && err.status === 413 ? t('builds.tooLarge') : t('builds.uploadFailed'));
  } finally {
    sending.value = null;
  }
}

const linking = ref(false);
const driveUrl = ref('');
const drivePlatform = ref<Platform>('windows');
const driveChosen = ref(false);
const driveBusy = ref(false);
const driveError = ref<string | null>(null);
const driveInput = ref<HTMLInputElement | null>(null);
let naming: ReturnType<typeof setTimeout> | null = null;
let names = 0;

async function openDrive(): Promise<void> {
  drivePlatform.value = viewerPlatform();
  driveChosen.value = false;
  linking.value = true;
  await nextTick();
  driveInput.value?.focus();
}

function closeDrive(): void {
  linking.value = false;
  driveUrl.value = '';
  driveError.value = null;
}

function chooseDrive(platform: Platform): void {
  drivePlatform.value = platform;
  driveChosen.value = true;
}

watch(driveUrl, (raw) => {
  if (naming) clearTimeout(naming);
  const url = raw.trim();
  const mine = ++names;
  if (!url || driveChosen.value) return;
  naming = setTimeout(async () => {
    try {
      const { name } = await api<{ name: string }>(`/builds/${encodeURIComponent(props.project)}/drive/name`, {
        method: 'POST',
        body: { url },
      });
      const guess = platformOfName(name);
      if (mine === names && guess && !driveChosen.value) drivePlatform.value = guess;
    } catch {}
  }, 400);
});

async function addDrive(): Promise<void> {
  const url = driveUrl.value.trim();
  if (!url || driveBusy.value) return;
  driveBusy.value = true;
  driveError.value = null;
  try {
    await api(`/builds/${encodeURIComponent(props.project)}/drive`, {
      method: 'POST',
      body: { url, platform: drivePlatform.value },
    });
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
    <input ref="fileInput" class="sr" type="file" tabindex="-1" @change="pick" />

    <Dialog v-if="picked" :title="t('builds.upload')" :width="460" @close="picked = null">
      <p class="bacts__file">{{ picked.name }}</p>
      <div class="seg" role="radiogroup" :aria-label="t('builds.platform')">
        <label v-for="p in PLATFORMS" :key="p.value" class="seg__i" :class="{ 'is-on': pickedPlatform === p.value }">
          <input v-model="pickedPlatform" class="sr" type="radio" name="build-platform" :value="p.value" />
          {{ p.label }}
        </label>
      </div>
      <template #footer>
        <button class="btn" type="button" @click="picked = null">{{ t('common.cancel') }}</button>
        <button class="btn btn--primary" type="button" @click="upload">{{ t('builds.upload') }}</button>
      </template>
    </Dialog>

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
      <div class="seg" role="radiogroup" :aria-label="t('builds.platform')">
        <label v-for="p in PLATFORMS" :key="p.value" class="seg__i" :class="{ 'is-on': drivePlatform === p.value }">
          <input
            class="sr"
            type="radio"
            name="drive-platform"
            :value="p.value"
            :checked="drivePlatform === p.value"
            @change="chooseDrive(p.value)"
          />
          {{ p.label }}
        </label>
      </div>
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
.bacts__file {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.seg {
  display: inline-flex;
  align-self: flex-start;
  height: 30px;
  border: 1px solid var(--line-2);
  background: var(--bg);
  border-radius: var(--radius);
}
.seg__i {
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  color: var(--text-muted);
  font-size: 13px;
  cursor: pointer;
}
.seg__i + .seg__i {
  border-left: 1px solid var(--line-2);
}
.seg__i:hover,
.seg__i.is-on {
  color: var(--text);
}
.seg__i:has(input:focus-visible) {
  box-shadow: var(--focus-ring);
}
</style>
