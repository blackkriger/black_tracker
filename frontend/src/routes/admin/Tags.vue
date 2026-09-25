<script setup lang="ts">
// Global tags: usable on every project, unlike the ones a project keeps for itself.
import { computed, onMounted, ref } from 'vue';
import AdminLayout from '../../components/AdminLayout.vue';
import ColorSwatch from '../../components/ColorSwatch.vue';
import { api } from '../../lib/api';

interface Tag {
  id: string;
  projectId: string | null;
  name: string;
  color: string;
  used: number;
}

const tags = ref<Tag[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const newTag = ref('');

const global = computed(() => tags.value.filter((t) => t.projectId === null));

onMounted(async () => {
  try {
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
    tags.value = [...tags.value, await api<Tag>('/tags', { method: 'POST', body: { name: value } })];
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
  <AdminLayout>
    <section class="panel">
      <header class="panel__h">Global tags<span class="panel__end">Usable on every project</span></header>
      <div class="panel__table">
        <p v-if="loading" class="hint">Loading…</p>
        <div v-if="error" class="err">{{ error }}</div>
        <table v-if="global.length" class="tbl">
          <thead>
            <tr>
              <th class="c-color">Color</th>
              <th>Tag</th>
              <th class="c-used">Used</th>
              <th class="c-del"><span class="sr">Delete</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in global" :key="t.id">
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
              <td class="stamp c-used">{{ t.used }}</td>
              <td class="c-del">
                <button class="btn btn--sm btn--icon btn--ghost" type="button" aria-label="Delete tag" @click="remove(t)">✕</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else-if="!loading" class="empty empty--sm"><span class="empty__g">◇</span>No global tags yet.</div>
        <form class="addrow" @submit.prevent="add">
          <input v-model="newTag" class="input input--sm" placeholder="Add tag…" maxlength="40" />
          <button class="btn btn--sm" type="submit" :disabled="!newTag.trim()">Add</button>
        </form>
      </div>
    </section>
  </AdminLayout>
</template>

<style scoped>
.panel__table {
  padding: 4px 8px 12px;
}
.c-color {
  width: 40px;
}
.c-used {
  width: 60px;
}
.c-del {
  width: 44px;
}
.addrow {
  display: flex;
  gap: 6px;
  padding: 8px 4px 0;
  max-width: 420px;
}
.addrow .input {
  flex: 1 1 auto;
}
</style>
