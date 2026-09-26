<script setup lang="ts">
// One project's setup: what it is called, the statuses that become the board's columns, the boards themselves, and the tags that belong to it.
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import SettingsLayout from '../../components/SettingsLayout.vue';
import TagLabels, { type TagItem } from '../../components/TagLabels.vue';
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
interface Tag extends TagItem {
  projectId: string | null;
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
      body: { defaultStateId: defaultStateId.value },
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
async function addTag(name: string): Promise<void> {
  if (!project.value) return;
  try {
    const created = await api<Tag>('/tags', {
      method: 'POST',
      body: { name, project: project.value.shortName },
    });
    tags.value = [...tags.value, created];
  } catch (err) {
    report(err);
  }
}

async function renameTag(t: TagItem, name: string): Promise<void> {
  try {
    const updated = await api<Tag>(`/tags/${t.id}`, { method: 'PATCH', body: { name } });
    tags.value = tags.value.map((row) => (row.id === t.id ? updated : row));
  } catch (err) {
    report(err);
  }
}

async function deleteTag(t: TagItem): Promise<void> {
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
    <p v-if="loading" class="hint sheet__wide">Loading…</p>
    <div v-else-if="!project" class="empty sheet__wide"><span class="empty__g">✕</span>{{ error }}</div>

    <template v-else>
      <div v-if="error" class="err sheet__wide">{{ error }}</div>

      <section class="panel sheet__wide">
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
            <input id="p-name" class="input" :value="project.name" readonly />
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
      </section>

      <section class="panel">
          <header class="panel__h">
            Statuses<span class="panel__end">Columns on every {{ project.shortName }} board</span>
          </header>
          <div class="panel__table">
            <table class="tbl">
              <thead>
                <tr>
                  <th class="c-grip"><span class="sr">Order</span></th>
                  <th class="c-color"><span class="sr">Color</span></th>
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
                  <td class="c-color"><span class="dot" :style="{ background: s.color }"></span></td>
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

        <div class="stack">
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
            <div class="panel__b">
              <div v-if="!projectTags.length" class="empty empty--sm"><span class="empty__g">◇</span>No tags yet.</div>
              <TagLabels :tags="projectTags" @add="addTag" @rename="renameTag" @remove="deleteTag" />
            </div>
          </section>
        </div>

      <p v-if="notice" class="hint sheet__wide">{{ notice }}</p>
    </template>
  </SettingsLayout>
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
.dot {
  display: block;
  width: 10px;
  height: 10px;
}
.c-del {
  width: 44px;
}
.addrow {
  padding: 8px 4px 0;
}
</style>
