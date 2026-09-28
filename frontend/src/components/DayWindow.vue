<script setup lang="ts">
// One day, opened from wherever it was clicked: the calendar screen or the little month in
// the top bar. It reads its own day, so neither host has to hand it anything but the date.
import { computed, ref, watch } from 'vue';
import { X } from 'lucide-vue-next';
import Dialog from './Dialog.vue';
import Select from './Select.vue';
import { api } from '../lib/api';
import { longDate, type Due, type Mark } from '../lib/calendar';
import { dayOf, useNotices, type Notice } from '../lib/notices';
import { usePanelErrors } from '../lib/panelErrors';
import { useProjects } from '../lib/projects';
import { useSession } from '../lib/session';

const props = defineProps<{ day: string }>();
const emit = defineEmits<{
  (e: 'close'): void;
  /** Something about the day changed and whoever hosts this should read it again. */
  (e: 'changed'): void;
  (e: 'open', where: { key: string; projectShort: string; boardSlug: string; comment?: string }): void;
}>();

const session = useSession();
const { projects } = useProjects();
const { shown: notices, markRead } = useNotices();
const { errors, fail, clear } = usePanelErrors();

const marks = ref<Mark[]>([]);
const dues = ref<Due[]>([]);
const said = computed(() => notices.value.filter((n) => dayOf(n) === props.day));

const projectChoices = computed(() => [
  { value: '', label: 'Everything' },
  ...projects.value.map((p) => ({ value: p.shortName, label: p.name })),
]);

async function read(): Promise<void> {
  clear('day');
  try {
    const got = await api<{ marks: Mark[]; dues: { day: string; issues: Due[] }[] }>(
      `/calendar?from=${props.day}&to=${props.day}`
    );
    marks.value = got.marks;
    dues.value = got.dues.flatMap((d) => d.issues);
  } catch (err) {
    fail('day', err, 'Could not read the day.');
  }
}

watch(() => props.day, read, { immediate: true });

// ── marking it ──
const adding = ref(false);
const title = ref('');
const url = ref('');
const banner = ref('');
const scope = ref('');
const busy = ref(false);

async function addMark(): Promise<void> {
  const text = title.value.trim();
  if (!text || busy.value) return;
  busy.value = true;
  clear('day');
  try {
    await api('/key-dates', {
      method: 'POST',
      body: {
        day: props.day,
        title: text,
        project: scope.value || null,
        url: url.value.trim() || null,
        banner: banner.value.trim() || null,
      },
    });
    title.value = '';
    url.value = '';
    banner.value = '';
    adding.value = false;
    await read();
    emit('changed');
  } catch (err) {
    fail('day', err);
  } finally {
    busy.value = false;
  }
}

async function removeMark(m: Mark): Promise<void> {
  clear('day');
  try {
    await api(`/key-dates/${m.id}`, { method: 'DELETE' });
    await read();
    emit('changed');
  } catch (err) {
    fail('day', err);
  }
}

async function openNotice(n: Notice): Promise<void> {
  if (!n.read) await markRead(n.id);
  emit('open', {
    key: n.key,
    projectShort: n.projectShort,
    boardSlug: n.boardSlug,
    comment: n.commentId ?? undefined,
  });
}
</script>

<template>
  <Dialog :title="longDate(day)" :width="460" @close="emit('close')">
    <div v-if="said.length" class="marks">
      <button
        v-for="n in said"
        :key="n.id"
        class="mark mark--due"
        type="button"
        @click="openNotice(n)"
      >
        <span class="key" :style="{ color: n.color ?? undefined }">{{ n.key }}</span>
        <span v-if="n.emoji">{{ n.emoji }}</span>
        <span class="mark__title">
          <template v-if="n.kind === 'reaction'">{{ n.by }} reacted</template>
          <template v-else-if="n.kind === 'assigned'">{{ n.by }} assigned you</template>
          <template v-else>
            <template v-if="n.by && n.by !== session.me.value?.login">{{ n.by }}: </template>
            {{ n.said }}
          </template>
        </span>
      </button>
    </div>

    <div v-if="marks.length" class="marks">
      <div v-for="m in marks" :key="m.id" class="mark mark--kept">
        <a
          v-if="m.banner"
          class="mark__banner"
          :href="m.url ?? m.banner"
          target="_blank"
          rel="noopener noreferrer"
        ><img :src="m.banner" :alt="m.title" /></a>
        <div class="mark__line">
          <span v-if="m.project" class="key">{{ m.project.shortName }}</span>
          <a
            v-if="m.url"
            class="mark__title"
            :href="m.url"
            target="_blank"
            rel="noopener noreferrer"
          >{{ m.title }}</a>
          <span v-else class="mark__title">{{ m.title }}</span>
          <button
            class="btn btn--sm btn--icon btn--ghost"
            type="button"
            :disabled="!session.canDelete.value"
            :aria-label="`Delete ${m.title}`"
            @click="removeMark(m)"
          ><X class="ic ic--sm" /></button>
        </div>
      </div>
    </div>

    <div v-if="dues.length" class="marks">
      <button
        v-for="d in dues"
        :key="d.key"
        class="mark mark--due"
        type="button"
        @click="emit('open', { key: d.key, projectShort: d.projectShort, boardSlug: d.boardSlug })"
      >
        <span class="key" :style="{ color: d.color }">{{ d.key }}</span>
        <span class="mark__title">{{ d.summary }}</span>
      </button>
    </div>

    <div v-if="!adding" class="addrow">
      <button class="btn" type="button" @click="adding = true">Add event…</button>
      <div class="sp"></div>
    </div>

    <template v-else>
      <div class="field">
        <label class="label" for="mark-title">Title</label>
        <input
          id="mark-title"
          v-model="title"
          class="input"
          maxlength="120"
          @keydown.enter.prevent="addMark"
        />
      </div>
      <div class="field">
        <label class="label" for="mark-url">Link</label>
        <input id="mark-url" v-model="url" class="input" maxlength="500" placeholder="https://" />
      </div>
      <div class="field">
        <label class="label" for="mark-banner">Banner</label>
        <input
          id="mark-banner"
          v-model="banner"
          class="input"
          maxlength="500"
          placeholder="https://"
        />
      </div>
      <div class="addrow">
        <Select v-model="scope" :options="projectChoices" />
        <button class="btn" type="button" @click="adding = false">Cancel</button>
        <button class="btn" type="button" :disabled="busy || !title.trim()" @click="addMark">
          Add
        </button>
      </div>
    </template>
    <div v-if="errors.day" class="err">{{ errors.day }}</div>
  </Dialog>
</template>

<style scoped>
.marks {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mark {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 30px;
  padding: 0 4px 0 8px;
  border: 1px solid var(--line);
  background: none;
  color: var(--text);
  font-size: 13px;
  text-align: left;
}
/* A marked day can carry the event's picture, and the picture is the way to it. */
.mark--kept {
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  padding: 0;
}
.mark__banner {
  display: block;
  border-bottom: 1px solid var(--line);
}
.mark__banner img {
  display: block;
  width: 100%;
  max-height: 150px;
  object-fit: cover;
}
.mark__line {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 30px;
  padding: 0 4px 0 8px;
}
a.mark__title {
  color: var(--accent);
  text-decoration: none;
}
a.mark__title:hover {
  color: var(--accent-bright);
}
.mark--due {
  cursor: pointer;
}
.mark--due:hover {
  border-color: var(--line-2);
}
.mark__title {
  flex: 1 1 auto;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
