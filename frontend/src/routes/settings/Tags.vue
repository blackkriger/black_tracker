<script setup lang="ts">
// Tags by where they live: the global ones first, then one container per project. The container title is the scope, so no row has to spell it out.
import { computed, onMounted, ref } from 'vue';
import SettingsLayout from '../../components/SettingsLayout.vue';
import TagLabels, { type TagItem } from '../../components/TagLabels.vue';
import { api } from '../../lib/api';
import { useProjects } from '../../lib/projects';

interface Tag extends TagItem {
  projectId: string | null;
}

const { projects, load: loadProjects } = useProjects();

const tags = ref<Tag[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const globalTags = computed(() => tags.value.filter((t) => t.projectId === null));
const tagsOf = (projectId: string) => tags.value.filter((t) => t.projectId === projectId);

onMounted(async () => {
  try {
    await loadProjects();
    tags.value = await api<Tag[]>('/tags');
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not load tags.';
  } finally {
    loading.value = false;
  }
});

function report(err: unknown): void {
  error.value = err instanceof Error ? err.message : 'Something went wrong.';
}

async function add(name: string, project?: string): Promise<void> {
  try {
    const created = await api<Tag>('/tags', {
      method: 'POST',
      body: project ? { name, project } : { name },
    });
    tags.value = [...tags.value, created];
  } catch (err) {
    report(err);
  }
}

async function rename(tag: TagItem, name: string): Promise<void> {
  try {
    const updated = await api<Tag>(`/tags/${tag.id}`, { method: 'PATCH', body: { name } });
    tags.value = tags.value.map((row) => (row.id === tag.id ? updated : row));
  } catch (err) {
    report(err);
  }
}

async function remove(tag: TagItem): Promise<void> {
  try {
    await api(`/tags/${tag.id}`, { method: 'DELETE' });
    tags.value = tags.value.filter((row) => row.id !== tag.id);
  } catch (err) {
    report(err);
  }
}
</script>

<template>
  <SettingsLayout>
    <p v-if="loading" class="hint sheet__wide">Loading…</p>
    <div v-if="error" class="err sheet__wide">{{ error }}</div>

    <section class="panel sheet__wide">
      <header class="panel__h">Global tags<span class="panel__end">Usable on every project</span></header>
      <div class="panel__b">
        <div v-if="!globalTags.length" class="empty empty--sm"><span class="empty__g">◇</span>None yet.</div>
        <TagLabels :tags="globalTags" @add="add($event)" @rename="rename" @remove="remove" />
      </div>
    </section>

    <section v-for="p in projects" :key="p.id" class="panel sheet__wide">
      <header class="panel__h">
        {{ p.name }}<span class="panel__end">{{ p.shortName }} only</span>
      </header>
      <div class="panel__b">
        <div v-if="!tagsOf(p.id).length" class="empty empty--sm"><span class="empty__g">◇</span>None yet.</div>
        <TagLabels
          :tags="tagsOf(p.id)"
          @add="add($event, p.shortName)"
          @rename="rename"
          @remove="remove"
        />
      </div>
    </section>
  </SettingsLayout>
</template>
