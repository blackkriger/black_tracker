<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { X } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import Dialog from './Dialog.vue';
import Select from './Select.vue';
import { api } from '../lib/api';
import { tellTab } from '../lib/live';
import { longDate, type Activity, type Due, type Mark } from '../lib/calendar';
import { MARK_ICONS, type MarkIconName } from '../lib/markIcons';
import { noticeLine, showsAuthor, useNotices, type Notice } from '../lib/notices';
import { usePanelErrors } from '../lib/panelErrors';
import { useProjects } from '../lib/projects';
import { usePeople } from '../lib/people';
import { useSession } from '../lib/session';
import { ink } from '../lib/theme';

const { t } = useI18n();
const props = defineProps<{ day: string }>();
const iconLabel = (name: string): string => t(`calendar.icons.${name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())}`);
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'changed'): void;
  (e: 'open', where: { key: string; projectShort: string; boardSlug: string; comment?: string }): void;
}>();

const session = useSession();
const { projects } = useProjects();
const { nameOf, colorOf, genderOf, load: loadPeople } = usePeople();
void loadPeople();
const { off, markRead } = useNotices();
const { errors, fail, clear } = usePanelErrors();

const marks = ref<Mark[]>([]);
const dues = ref<Due[]>([]);
const activity = ref<Activity[]>([]);
const sum = computed(() =>
  activity.value.reduce(
    (all, a) => ({
      worked: all.worked + a.worked,
      created: all.created + a.created,
      resolved: all.resolved + a.resolved,
    }),
    { worked: 0, created: 0, resolved: 0 }
  )
);
const heard = ref<Notice[]>([]);
const said = computed(() => heard.value.filter((n) => !off.value.includes(n.kind)));

const projectChoices = computed(() => [
  { value: '', label: t('calendar.everything') },
  ...projects.value.map((p) => ({ value: p.shortName, label: p.name })),
]);

async function read(): Promise<void> {
  clear('day');
  try {
    const [got, notices] = await Promise.all([
      api<{ marks: Mark[]; dues: { day: string; issues: Due[] }[]; activity: Activity[] }>(
        `/calendar?from=${props.day}&to=${props.day}`
      ),
      api<Notice[]>(`/notices?from=${props.day}&to=${props.day}`),
    ]);
    heard.value = notices;
    marks.value = got.marks;
    dues.value = got.dues.flatMap((d) => d.issues);
    activity.value = got.activity;
  } catch (err) {
    fail('day', err, t('calendar.dayFailed'));
  }
}

watch(() => props.day, read, { immediate: true });

const adding = ref(false);
const title = ref('');
const url = ref('');
const banner = ref('');
const icon = ref<MarkIconName>('flag');
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
        icon: icon.value,
      },
    });
    title.value = '';
    url.value = '';
    banner.value = '';
    icon.value = 'flag';
    adding.value = false;
    await read();
    emit('changed');
    tellTab('key-date.changed');
  } catch (err) {
    fail('day', err);
  } finally {
    busy.value = false;
  }
}

const removingMark = ref<Mark | null>(null);

async function confirmRemoveMark(): Promise<void> {
  const m = removingMark.value;
  removingMark.value = null;
  if (m) await removeMark(m);
}

async function removeMark(m: Mark): Promise<void> {
  clear('day');
  try {
    await api(`/key-dates/${m.id}`, { method: 'DELETE' });
    await read();
    emit('changed');
    tellTab('key-date.changed');
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
    <div v-if="sum.worked || sum.created || sum.resolved" class="day__sum">
      {{ t('calendar.work', { worked: sum.worked, created: sum.created, resolved: sum.resolved }) }}
    </div>

    <div v-if="said.length" class="marks">
      <button
        v-for="n in said"
        :key="n.id"
        class="mark mark--due"
        type="button"
        @click="openNotice(n)"
      >
        <span class="key" :style="{ color: ink(n.color) }">{{ n.key }}</span>
        <span v-if="n.emoji">{{ n.emoji }}</span>
        <span
          v-if="showsAuthor(n, session.me.value?.login)"
          class="mark__by"
          :style="{ color: ink(colorOf(n.by)) }"
        >{{ nameOf(n.by) }}</span>
        <span class="mark__title">
          {{ noticeLine(n, nameOf, genderOf) }}
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
            :aria-label="t('common.deleteNamed', { name: m.title })"
            @click="removingMark = m"
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
        <span class="key" :style="{ color: ink(d.color) }">{{ d.key }}</span>
        <span class="mark__title">{{ d.summary }}</span>
      </button>
    </div>

    <div v-if="!adding" class="addrow">
      <button class="btn" type="button" @click="adding = true">{{ t('calendar.addEvent') }}</button>
      <div class="sp"></div>
    </div>

    <template v-else>
      <div class="field">
        <span class="label">{{ t('calendar.icon') }}</span>
        <div class="icons" role="radiogroup" :aria-label="t('calendar.icon')">
          <button
            v-for="m in MARK_ICONS"
            :key="m.name"
            class="btn btn--sm btn--icon btn--ghost icons__i"
            :class="{ 'is-on': icon === m.name }"
            type="button"
            role="radio"
            :aria-checked="icon === m.name"
            :aria-label="iconLabel(m.name)"
            :title="iconLabel(m.name)"
            @click="icon = m.name"
          ><component :is="m.icon" class="ic" /></button>
        </div>
      </div>
      <div class="field">
        <label class="label" for="mark-title">{{ t('calendar.title') }}</label>
        <input
          id="mark-title"
          v-model="title"
          class="input"
          maxlength="120"
          @keydown.enter.prevent="addMark"
        />
      </div>
      <div class="field">
        <label class="label" for="mark-url">{{ t('calendar.link') }}</label>
        <input id="mark-url" v-model="url" class="input" maxlength="500" placeholder="https://" />
      </div>
      <div class="field">
        <label class="label" for="mark-banner">{{ t('calendar.banner') }}</label>
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
        <button class="btn" type="button" @click="adding = false">{{ t('common.cancel') }}</button>
        <button class="btn" type="button" :disabled="busy || !title.trim()" @click="addMark">
          {{ t('common.add') }}
        </button>
      </div>
    </template>
    <div v-if="errors.day" class="err">{{ errors.day }}</div>

    <Dialog v-if="removingMark" :title="t('common.deleteNamed', { name: removingMark.title })" @close="removingMark = null">
      <p>{{ t('calendar.deleteMarkText') }}</p>
      <template #footer>
        <div class="sp"></div>
        <button class="btn" type="button" @click="removingMark = null">{{ t('common.cancel') }}</button>
        <button class="btn btn--danger" type="button" @click="confirmRemoveMark">{{ t('calendar.deleteMark') }}</button>
      </template>
    </Dialog>
  </Dialog>
</template>

<style scoped>
.day__sum {
  color: var(--text-muted);
  font: 11.5px var(--font-num);
}
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
.mark--kept {
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  padding: 0;
}
.icons {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.icons__i.is-on {
  color: var(--accent);
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
.mark .key,
.mark__by {
  flex: none;
}
.mark__title {
  flex: 1 1 auto;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
