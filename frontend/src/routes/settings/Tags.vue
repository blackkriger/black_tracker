<script setup lang="ts">
// Every tag in one place: the ones usable everywhere, and the ones a project keeps to itself. Scope is picked when the tag is made and shown in its own column.
import { computed, onMounted, ref } from 'vue';
import SettingsLayout from '../../components/SettingsLayout.vue';
import ColorSwatch from '../../components/ColorSwatch.vue';
import { api } from '../../lib/api';
import { useProjects } from '../../lib/projects';

interface Tag {
  id: string;
  projectId: string | null;
  name: string;
  color: string;
  used: number;
}

const { projects, load: loadProjects } = useProjects();

const tags = ref<Tag[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const newTag = ref('');
// Empty means everywhere; otherwise the project's key, which is what the API takes.
const newScope = ref('');

const shortById = computed(() => {
  const m = new Map<string, string>();
  for (const p of projects.value) m.set(p.id, p.shortName);
  return m;
});

const rows = computed(() =>
  [...tags.value].sort((a, b) => {
    const sa = a.projectId ? shortById.value.get(a.projectId) ?? '' : '';
    const sb = b.projectId ? shortById.value.get(b.projectId) ?? '' : '';
    return sa.localeCompare(sb) || a.name.localeCompare(b.name);
  })
);

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

async function add(): Promise<void> {
  const value = newTag.value.trim();
  if (!value) return;
  try {
    const created = await api<Tag>('/tags', {
      method: 'POST',
      body: newScope.value ? { name: value, project: newScope.value } : { name: value },
    });
    tags.value = [...tags.value, created];
    newTag.value = '';
  } catch (err) {
    report(err);
  }
}

async function patch(t: Tag, body: Partial<Tag>): Promise<void> {
  try {
    const updated = await api<Tag>(`/tags/${t.id}`, { method: 'PATCH', body });
    tags.value = tags.value.map((row) => (row.id === t.id ? updated : row));
  } catch (err) {
    report(err);
  }
}

async function remove(t: Tag): Promise<void> {
  try {
    await api(`/tags/${t.id}`, { method: 'DELETE' });
    tags.value = tags.value.filter((row) => row.id !== t.id);
  } catch (err) {
    report(err);
  }
}
</script>

<template>
  <SettingsLayout>
    <section class="panel sheet__wide">
      <header class="panel__h">Tags</header>
      <div class="panel__table">
        <p v-if="loading" class="hint">Loading…</p>
        <div v-if="error" class="err">{{ error }}</div>

        <table v-if="rows.length" class="tbl">
          <thead>
            <tr>
              <th class="c-color">Color</th>
              <th>Tag</th>
              <th class="c-scope">Scope</th>
              <th class="c-used">Used</th>
              <th class="c-del"><span class="sr">Delete</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in rows" :key="t.id">
              <td class="c-color">
                <ColorSwatch :model-value="t.color" @update:model-value="patch(t, { color: $event })" />
              </td>
              <td>
                <input
                  class="input input--sm"
                  :value="t.name"
                  maxlength="40"
                  @change="patch(t, { name: ($event.target as HTMLInputElement).value })"
                />
              </td>
              <td class="c-scope stamp">
                {{ t.projectId ? shortById.get(t.projectId) ?? '—' : 'EVERYWHERE' }}
              </td>
              <td class="stamp c-used">{{ t.used }}</td>
              <td class="c-del">
                <button class="btn btn--sm btn--icon btn--ghost" type="button" aria-label="Delete tag" @click="remove(t)">✕</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else-if="!loading" class="empty empty--sm"><span class="empty__g">◇</span>No tags yet.</div>

        <form class="addrow" @submit.prevent="add">
          <select v-model="newScope" class="input scope">
            <option value="">Everywhere</option>
            <option v-for="p in projects" :key="p.id" :value="p.shortName">{{ p.shortName }}</option>
          </select>
          <input v-model="newTag" class="input" placeholder="Add tag…" maxlength="40" />
          <button class="btn" type="submit" :disabled="!newTag.trim()">Add</button>
        </form>
      </div>
    </section>
  </SettingsLayout>
</template>

<style scoped>
.panel__table {
  padding: 4px 8px 12px;
}
.addrow {
  padding: 8px 4px 0;
}
.scope {
  flex: 0 0 140px;
  height: 34px;
}
.c-color {
  width: 40px;
}
.c-scope {
  width: 120px;
}
.c-used {
  width: 60px;
}
.c-del {
  width: 44px;
}
</style>
