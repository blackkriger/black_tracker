<script setup lang="ts">
import { onMounted, ref } from 'vue';
import SettingsLayout from '../../components/SettingsLayout.vue';
import TagLabels, { type TagItem } from '../../components/TagLabels.vue';
import { api } from '../../lib/api';
import { useLive } from '../../lib/live';
import { usePanelErrors } from '../../lib/panelErrors';
import { useSession } from '../../lib/session';

const { canDelete } = useSession();

const tags = ref<TagItem[]>([]);
const loading = ref(true);
const { errors, fail, clear } = usePanelErrors();

const byName = (a: TagItem, b: TagItem) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());

async function reload(): Promise<void> {
  tags.value = await api<TagItem[]>('/tags');
}

useLive((ev) => {
  if (ev.type === 'tag.changed') void reload().catch(() => {});
});

onMounted(async () => {
  try {
    await reload();
  } catch (err) {
    fail('tags', err, 'Could not load tags.');
  } finally {
    loading.value = false;
  }
});

async function add(name: string): Promise<void> {
  clear('tags');
  try {
    const created = await api<TagItem>('/tags', { method: 'POST', body: { name } });
    tags.value = [...tags.value, created].sort(byName);
  } catch (err) {
    fail('tags', err);
  }
}

async function rename(tag: TagItem, name: string): Promise<void> {
  clear('tags');
  try {
    const updated = await api<TagItem>(`/tags/${tag.id}`, { method: 'PATCH', body: { name } });
    tags.value = tags.value.map((row) => (row.id === tag.id ? updated : row)).sort(byName);
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
</script>

<template>
  <SettingsLayout>
    <section v-if="loading" class="panel sheet__wide">
      <header class="panel__h">Tags</header>
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

    <section v-else class="panel sheet__wide">
      <header class="panel__h">Tags</header>
      <div class="panel__b">
        <div v-if="!tags.length" class="empty empty--sm"><span class="empty__g">◇</span>None yet.</div>
        <TagLabels
          :tags="tags"
          :can-remove="canDelete"
          @add="add"
          @rename="rename"
          @remove="remove"
        />
      </div>
    </section>
    <div v-if="errors.tags" class="err sheet__wide panel__err">{{ errors.tags }}</div>
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
</style>
