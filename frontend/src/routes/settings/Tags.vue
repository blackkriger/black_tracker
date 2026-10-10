<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ColorPicker from '../../components/ColorPicker.vue';
import SettingsLayout from '../../components/SettingsLayout.vue';
import TagLabels, { type TagItem } from '../../components/TagLabels.vue';
import { api } from '../../lib/api';
import { useLive } from '../../lib/live';
import { usePanelErrors } from '../../lib/panelErrors';
import { useProjects } from '../../lib/projects';
import { useSession } from '../../lib/session';

interface Tag extends TagItem {
  boardIds: string[];
}

const { t } = useI18n();
const { canDelete } = useSession();
const { projects, load: loadProjects } = useProjects();

const tags = ref<Tag[]>([]);
const loading = ref(true);
const { errors, fail, clear } = usePanelErrors();

const byName = (a: TagItem, b: TagItem) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());

const boards = computed(() =>
  projects.value
    .filter((p) => !p.archived)
    .flatMap((p) => p.boards.map((b) => ({ id: b.id, label: `${p.shortName}, ${b.name}` })))
);

async function reload(): Promise<void> {
  tags.value = await api<Tag[]>('/tags');
}

useLive(
  (ev) => {
    if (ev.type === 'tag.changed') void reload().catch(() => {});
  },
  () => void reload().catch(() => {})
);

onMounted(async () => {
  try {
    await Promise.all([reload(), loadProjects()]);
  } catch (err) {
    fail('tags', err, t('tags.loadFailed'));
  } finally {
    loading.value = false;
  }
});

async function add(name: string): Promise<void> {
  clear('tags');
  try {
    const created = await api<Tag>('/tags', { method: 'POST', body: { name } });
    tags.value = [...tags.value, created].sort(byName);
  } catch (err) {
    fail('tags', err);
  }
}

async function rename(tag: TagItem, name: string): Promise<void> {
  clear('tags');
  try {
    const updated = await api<Tag>(`/tags/${tag.id}`, { method: 'PATCH', body: { name } });
    tags.value = tags.value.map((row) => (row.id === tag.id ? updated : row)).sort(byName);
  } catch (err) {
    fail('tags', err);
  }
}

const picking = ref<{ tag: TagItem; anchor: HTMLElement } | null>(null);

function pickColor(tag: TagItem, anchor: HTMLElement): void {
  picking.value = picking.value?.tag.id === tag.id ? null : { tag, anchor };
}

async function applyColor(color: string): Promise<void> {
  const p = picking.value;
  picking.value = null;
  if (!p || color === p.tag.color) return;
  clear('tags');
  try {
    const updated = await api<Tag>(`/tags/${p.tag.id}`, { method: 'PATCH', body: { color } });
    tags.value = tags.value.map((row) => (row.id === p.tag.id ? updated : row));
  } catch (err) {
    fail('tags', err);
  }
}

async function remove(tag: TagItem): Promise<void> {
  clear('tags');
  try {
    await api(`/tags/${tag.id}`, { method: 'DELETE' });
    tags.value = tags.value.filter((row) => row.id !== tag.id);
  } catch (err) {
    fail('tags', err);
  }
}

function setOnBoard(tagId: string, boardId: string, on: boolean): void {
  tags.value = tags.value.map((t) => {
    if (t.id !== tagId) return t;
    const rest = t.boardIds.filter((id) => id !== boardId);
    return { ...t, boardIds: on ? [...rest, boardId] : rest };
  });
}

async function toggleOnBoard(tag: Tag, boardId: string): Promise<void> {
  clear('boards');
  const on = !tag.boardIds.includes(boardId);
  setOnBoard(tag.id, boardId, on);
  try {
    await api(`/tags/${tag.id}/boards/${boardId}`, { method: on ? 'PUT' : 'DELETE' });
  } catch (err) {
    setOnBoard(tag.id, boardId, !on);
    fail('boards', err);
  }
}
</script>

<template>
  <SettingsLayout>
    <section v-if="loading" class="panel sheet__wide">
      <header class="panel__h">{{ t('fields.tags') }}</header>
      <div class="panel__b">
        <div class="taglabels">
          <span v-for="w in [64, 92, 48, 76]" :key="w" class="sk tag-sk" :style="{ width: `${w}px` }"></span>
        </div>
        <div class="addrow">
          <span class="sk field-sk"></span>
          <span class="sk btn-sk"></span>
        </div>
      </div>
    </section>
    <section v-if="loading" class="panel sheet__wide">
      <header class="panel__h">
        {{ t('tags.boards') }}
        <span class="panel__end tagmap__head" style="--boards: 2">
          <span v-for="w in [96, 72]" :key="w" class="sk sk--line" :style="{ width: `${w}px` }"></span>
        </span>
      </header>
      <div class="panel__b">
        <div v-for="n in 2" :key="n" class="tagmap__row" style="--boards: 2">
          <span v-for="w in [52, 64]" :key="w" class="sk tag-sk" :style="{ width: `${w}px` }"></span>
        </div>
      </div>
    </section>

    <section v-else class="panel sheet__wide">
      <header class="panel__h">{{ t('fields.tags') }}</header>
      <div class="panel__b">
        <div v-if="!tags.length" class="empty empty--sm"><span class="empty__g">◇</span>{{ t('tags.none') }}</div>
        <TagLabels
          :tags="tags"
          :can-remove="canDelete"
          @add="add"
          @rename="rename"
          @remove="remove"
          @color="pickColor"
        />
      </div>
    </section>
    <div v-if="errors.tags" class="err sheet__wide panel__err">{{ errors.tags }}</div>

    <section v-if="!loading && boards.length && tags.length" class="panel sheet__wide">
      <header class="panel__h">
        {{ t('tags.boards') }}
        <span class="panel__end tagmap__head" :style="{ '--boards': boards.length }">
          <span v-for="b in boards" :key="b.id" class="stamp" :title="b.label">{{ b.label }}</span>
        </span>
      </header>
      <div class="panel__b">
        <div v-for="tag in tags" :key="tag.id" class="tagmap__row" :style="{ '--boards': boards.length }">
          <button
            v-for="b in boards"
            :key="b.id"
            class="taglabel taglabel--plain taglabel--pick"
            :class="{ 'is-off': !tag.boardIds.includes(b.id) }"
            type="button"
            :aria-pressed="tag.boardIds.includes(b.id)"
            :style="{ '--c': tag.color }"
            @click="toggleOnBoard(tag, b.id)"
          >{{ tag.name }}</button>
        </div>
      </div>
    </section>
    <div v-if="errors.boards" class="err sheet__wide panel__err">{{ errors.boards }}</div>

    <ColorPicker
      v-if="picking"
      :key="picking.tag.id"
      :initial="picking.tag.color"
      :anchor="picking.anchor"
      @pick="applyColor"
      @close="picking = null"
    />
  </SettingsLayout>
</template>

<style scoped>
.tag-sk {
  display: block;
  height: 24px;
}
.field-sk {
  display: block;
  flex: 1 1 auto;
  height: 34px;
}
.btn-sk {
  display: block;
  flex: 0 0 56px;
  height: 34px;
}
.taglabel--pick {
  border: 0;
  cursor: pointer;
  font-family: inherit;
}
.taglabel--pick.is-off {
  opacity: 0.35;
}
.tagmap__head,
.tagmap__row {
  display: grid;
  grid-template-columns: repeat(var(--boards), 140px);
  justify-content: end;
  justify-items: end;
  gap: 8px;
}
.tagmap__head {
  padding-right: 4px;
}
.tagmap__head .stamp {
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.tagmap__row {
  align-items: center;
  min-height: 26px;
  padding: 5px 0;
}
.tagmap__row + .tagmap__row {
  border-top: 1px solid var(--line);
}
@media (max-width: 760px) {
  .panel__h {
    flex-wrap: wrap;
    height: auto;
    min-height: 48px;
    padding-top: 8px;
    padding-bottom: 8px;
  }
  .tagmap__head {
    width: 100%;
    margin-left: 0;
  }
  .tagmap__head,
  .tagmap__row {
    grid-template-columns: repeat(var(--boards), minmax(0, 1fr));
  }
  .tagmap__row .taglabel {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
</style>
