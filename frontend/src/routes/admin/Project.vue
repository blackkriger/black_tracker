<script setup lang="ts">
// One project's setup: what it is called, the statuses that become the board's columns, the boards themselves, and the tags that belong to it.
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import AdminLayout from '../../components/AdminLayout.vue';
import ColorSwatch from '../../components/ColorSwatch.vue';
import { api } from '../../lib/api';
import { useProjects } from '../../lib/projects';

interface State {
  id: string;
  name: string;
  position: number;
  isOpen: boolean;
  isResolved: boolean;
  color: string;
}
interface Project {
  id: string;
  shortName: string;
  name: string;
  description: string;
  defaultStateId: string | null;
  archived: boolean;
  states: State[];
}
interface Board {
  id: string;
  name: string;
  position: number;
}
interface Tag {
  id: string;
  projectId: string | null;
  name: string;
  color: string;
  used: number;
}

const route = useRoute();
const projectsStore = useProjects();

const project = ref<Project | null>(null);
const states = ref<State[]>([]);
const boards = ref<Board[]>([]);
const tags = ref<Tag[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

const name = ref('');
const defaultStateId = ref<string | null>(null);
const savingProject = ref(false);

const projectTags = computed(() => tags.value.filter((t) => t.projectId === project.value?.id));

const short = computed(() => String(route.params.short ?? ''));

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const p = await api<Project>(`/projects/${encodeURIComponent(short.value)}`);
    project.value = p;
    states.value = [...p.states].sort((a, b) => a.position - b.position);
    name.value = p.name;
    defaultStateId.value = p.defaultStateId;
    [boards.value, tags.value] = await Promise.all([
      api<Board[]>(`/projects/${encodeURIComponent(p.shortName)}/boards`),
      api<Tag[]>(`/tags?project=${encodeURIComponent(p.shortName)}`),
    ]);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not load the project.';
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(short, load);

function report(err: unknown): void {
  error.value = err instanceof Error ? err.message : 'Something went wrong.';
}

async function saveProject(): Promise<void> {
  if (!project.value || savingProject.value) return;
  savingProject.value = true;
  error.value = null;
  try {
    await api(`/projects/${encodeURIComponent(project.value.shortName)}`, {
      method: 'PATCH',
      body: { name: name.value, defaultStateId: defaultStateId.value },
    });
    notice.value = 'Saved.';
    await projectsStore.load(true);
  } catch (err) {
    report(err);
  } finally {
    savingProject.value = false;
  }
}

async function toggleArchived(): Promise<void> {
  if (!project.value) return;
  try {
    const updated = await api<Project>(`/projects/${encodeURIComponent(project.value.shortName)}`, {
      method: 'PATCH',
      body: { archived: !project.value.archived },
    });
    project.value = { ...project.value, archived: updated.archived };
    await projectsStore.load(true);
  } catch (err) {
    report(err);
  }
}

// ── statuses ─────────────────────────────────────────────────────
const newStatus = ref('');

async function addStatus(): Promise<void> {
  const value = newStatus.value.trim();
  if (!value || !project.value) return;
  try {
    const created = await api<State>(
      `/projects/${encodeURIComponent(project.value.shortName)}/states`,
      { method: 'POST', body: { name: value } }
    );
    states.value = [...states.value, created];
    newStatus.value = '';
  } catch (err) {
    report(err);
  }
}

async function patchStatus(s: State, patch: Partial<State>): Promise<void> {
  try {
    const updated = await api<State>(`/states/${s.id}`, { method: 'PATCH', body: patch });
    states.value = states.value.map((row) => (row.id === s.id ? updated : row));
  } catch (err) {
    report(err);
    await load();
  }
}

async function deleteStatus(s: State): Promise<void> {
  try {
    await api(`/states/${s.id}`, { method: 'DELETE' });
    states.value = states.value.filter((row) => row.id !== s.id);
  } catch (err) {
    report(err);
  }
}

// Plain HTML5 drag between rows: the order is the list itself, and the server is told the whole sequence once the row lands.
const dragId = ref<string | null>(null);

function onDrop(target: State): void {
  const from = states.value.findIndex((s) => s.id === dragId.value);
  const to = states.value.findIndex((s) => s.id === target.id);
  dragId.value = null;
  if (from < 0 || to < 0 || from === to) return;
  const next = [...states.value];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  states.value = next;
  void saveStatusOrder();
}

async function saveStatusOrder(): Promise<void> {
  if (!project.value) return;
  try {
    await api(`/projects/${encodeURIComponent(project.value.shortName)}/states/order`, {
      method: 'POST',
      body: { ids: states.value.map((s) => s.id) },
    });
  } catch (err) {
    report(err);
    await load();
  }
}

// ── boards ───────────────────────────────────────────────────────
const newBoard = ref('');

async function addBoard(): Promise<void> {
  const value = newBoard.value.trim();
  if (!value || !project.value) return;
  try {
    const created = await api<Board>(
      `/projects/${encodeURIComponent(project.value.shortName)}/boards`,
      { method: 'POST', body: { name: value } }
    );
    boards.value = [...boards.value, created];
    newBoard.value = '';
  } catch (err) {
    report(err);
  }
}

async function renameBoard(b: Board, value: string): Promise<void> {
  const next = value.trim();
  if (!next || next === b.name) return;
  try {
    const updated = await api<Board>(`/boards/${b.id}`, { method: 'PATCH', body: { name: next } });
    boards.value = boards.value.map((row) => (row.id === b.id ? { ...row, name: updated.name } : row));
  } catch (err) {
    report(err);
  }
}

async function deleteBoard(b: Board): Promise<void> {
  try {
    await api(`/boards/${b.id}`, { method: 'DELETE' });
    boards.value = boards.value.filter((row) => row.id !== b.id);
  } catch (err) {
    report(err);
  }
}

// ── tags ─────────────────────────────────────────────────────────
const newTag = ref('');

async function addTag(): Promise<void> {
  const value = newTag.value.trim();
  if (!value || !project.value) return;
  try {
    const created = await api<Tag>('/tags', {
      method: 'POST',
      body: { name: value, project: project.value.shortName },
    });
    tags.value = [...tags.value, created];
    newTag.value = '';
  } catch (err) {
    report(err);
  }
}

async function patchTag(t: Tag, patch: Partial<Tag>): Promise<void> {
  try {
    const updated = await api<Tag>(`/tags/${t.id}`, { method: 'PATCH', body: patch });
    tags.value = tags.value.map((row) => (row.id === t.id ? updated : row));
  } catch (err) {
    report(err);
  }
}

async function deleteTag(t: Tag): Promise<void> {
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
    <p v-if="loading" class="hint">Loading…</p>
    <div v-else-if="!project" class="empty"><span class="empty__g">✕</span>{{ error }}</div>

    <template v-else>
      <div v-if="error" class="err">{{ error }}</div>

      <section class="panel">
        <header class="panel__h">
          Project
          <span class="panel__end">{{ project.archived ? 'Archived' : '' }}</span>
        </header>
        <div class="panel__b p-row">
          <div class="field p-key">
            <label class="label" for="p-key">Key</label>
            <input id="p-key" class="input" :value="project.shortName" readonly />
          </div>
          <div class="field p-name">
            <label class="label" for="p-name">Name</label>
            <input id="p-name" v-model="name" class="input" maxlength="200" />
          </div>
          <div class="field p-default">
            <label class="label" for="p-default">Default status</label>
            <select id="p-default" v-model="defaultStateId" class="input">
              <option v-for="s in states" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>
          <button class="btn p-btn" type="button" @click="toggleArchived">
            {{ project.archived ? 'Restore project' : 'Archive project' }}
          </button>
          <button class="btn btn--primary p-btn" type="button" :disabled="savingProject" @click="saveProject">
            Save
          </button>
        </div>
        <p class="hint p-hint">
          The key is locked: it is in every {{ project.shortName }}-### reference and commit.
        </p>
      </section>

      <div class="two">
        <section class="panel">
          <header class="panel__h">
            Statuses<span class="panel__end">Columns on every {{ project.shortName }} board</span>
          </header>
          <div class="panel__table">
            <table class="tbl">
              <thead>
                <tr>
                  <th class="c-grip"><span class="sr">Order</span></th>
                  <th class="c-color">Color</th>
                  <th>Name</th>
                  <th class="c-flag">Open</th>
                  <th class="c-flag">Resolved</th>
                  <th class="c-del"><span class="sr">Delete</span></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="s in states"
                  :key="s.id"
                  draggable="true"
                  @dragstart="dragId = s.id"
                  @dragover.prevent
                  @drop.prevent="onDrop(s)"
                >
                  <td class="c-grip grip">⠿</td>
                  <td>
                    <ColorSwatch
                      :model-value="s.color"
                      @update:model-value="patchStatus(s, { color: $event })"
                    />
                  </td>
                  <td>
                    <input
                      class="input input--sm"
                      :value="s.name"
                      maxlength="60"
                      @change="patchStatus(s, { name: ($event.target as HTMLInputElement).value })"
                    />
                  </td>
                  <td>
                    <label class="check">
                      <input
                        type="checkbox"
                        :checked="s.isOpen"
                        @change="patchStatus(s, { isOpen: ($event.target as HTMLInputElement).checked })"
                      />
                    </label>
                  </td>
                  <td>
                    <label class="check">
                      <input
                        type="checkbox"
                        :checked="s.isResolved"
                        @change="patchStatus(s, { isResolved: ($event.target as HTMLInputElement).checked })"
                      />
                    </label>
                  </td>
                  <td>
                    <button class="btn btn--sm btn--icon btn--ghost" type="button" aria-label="Delete status" @click="deleteStatus(s)">
                      ✕
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            <form class="addrow" @submit.prevent="addStatus">
              <input v-model="newStatus" class="input input--sm" placeholder="Add status…" maxlength="60" />
              <button class="btn btn--sm" type="submit" :disabled="!newStatus.trim()">Add</button>
            </form>
          </div>
        </section>

        <div class="two__col">
          <section class="panel">
            <header class="panel__h">Boards<span class="panel__end">Saved filters</span></header>
            <div class="panel__table">
              <table class="tbl">
                <tbody>
                  <tr v-for="b in boards" :key="b.id">
                    <td>
                      <input
                        class="input input--sm"
                        :value="b.name"
                        maxlength="60"
                        @change="renameBoard(b, ($event.target as HTMLInputElement).value)"
                      />
                    </td>
                    <td class="c-del">
                      <button class="btn btn--sm btn--icon btn--ghost" type="button" aria-label="Delete board" @click="deleteBoard(b)">
                        ✕
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div v-if="!boards.length" class="empty empty--sm"><span class="empty__g">◇</span>No boards yet.</div>
              <form class="addrow" @submit.prevent="addBoard">
                <input v-model="newBoard" class="input input--sm" placeholder="Add board…" maxlength="60" />
                <button class="btn btn--sm" type="submit" :disabled="!newBoard.trim()">Add</button>
              </form>
            </div>
          </section>

          <section class="panel">
            <header class="panel__h">Tags<span class="panel__end">{{ project.shortName }} only</span></header>
            <div class="panel__table">
              <table class="tbl">
                <tbody>
                  <tr v-for="t in projectTags" :key="t.id">
                    <td class="c-color">
                      <ColorSwatch :model-value="t.color" @update:model-value="patchTag(t, { color: $event })" />
                    </td>
                    <td>
                      <input
                        class="input input--sm"
                        :value="t.name"
                        maxlength="40"
                        @change="patchTag(t, { name: ($event.target as HTMLInputElement).value })"
                      />
                    </td>
                    <td class="stamp c-used">{{ t.used }}</td>
                    <td class="c-del">
                      <button class="btn btn--sm btn--icon btn--ghost" type="button" aria-label="Delete tag" @click="deleteTag(t)">
                        ✕
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div v-if="!projectTags.length" class="empty empty--sm"><span class="empty__g">◇</span>No tags yet.</div>
              <form class="addrow" @submit.prevent="addTag">
                <input v-model="newTag" class="input input--sm" placeholder="Add tag…" maxlength="40" />
                <button class="btn btn--sm" type="submit" :disabled="!newTag.trim()">Add</button>
              </form>
            </div>
          </section>
        </div>
      </div>

      <p v-if="notice" class="hint">{{ notice }}</p>
    </template>
  </AdminLayout>
</template>

<style scoped>
.p-row {
  display: flex;
  align-items: flex-end;
  gap: var(--space-4);
  flex-wrap: wrap;
}
.p-key {
  width: 120px;
}
.p-name {
  flex: 1 1 220px;
}
.p-default {
  width: 200px;
}
.p-btn {
  height: 34px;
}
.p-hint {
  margin: -8px 20px 16px;
}
.two {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
  gap: var(--space-5);
  align-items: start;
}
@media (max-width: 1100px) {
  .two {
    grid-template-columns: minmax(0, 1fr);
  }
}
.two__col {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  min-width: 0;
}
.panel__table {
  padding: 4px 8px 12px;
}
.grip {
  color: var(--text-dim);
  cursor: grab;
}
.c-grip {
  width: 28px;
}
.c-color {
  width: 40px;
}
.c-flag {
  width: 70px;
}
.c-used {
  width: 50px;
}
.c-del {
  width: 44px;
}
.addrow {
  display: flex;
  gap: 6px;
  padding: 8px 4px 0;
}
.addrow .input {
  flex: 1 1 auto;
}
</style>
