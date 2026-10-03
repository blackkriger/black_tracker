<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import SettingsLayout from '../../components/SettingsLayout.vue';
import Select from '../../components/Select.vue';
import Dialog from '../../components/Dialog.vue';
import { api } from '../../lib/api';
import { useLive } from '../../lib/live';
import { usePanelErrors } from '../../lib/panelErrors';
import { useSession } from '../../lib/session';
import { useProjects } from '../../lib/projects';
import { usePeople } from '../../lib/people';
import { GripVertical, X } from 'lucide-vue-next';
import { ink } from '../../lib/theme';

interface State {
  id: string;
  boardId: string;
  name: string;
  position: number;
  isOpen: boolean;
  isResolved: boolean;
  color: string;
}
interface Board {
  id: string;
  name: string;
  defaultStateId: string | null;
  defaultAssigneeId: string | null;
  position: number;
  states: State[];
}
interface Project {
  id: string;
  shortName: string;
  name: string;
  archived: boolean;
  boards: Board[];
}

const route = useRoute();
const router = useRouter();
const projectsStore = useProjects();
const { canDelete } = useSession();

const project = ref<Project | null>(null);
const boards = ref<Board[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);
const { errors, fail, clear } = usePanelErrors();
const newBoard = ref('');
const deleting = ref(false);
const confirmKey = ref('');
const deletingBoard = ref<Board | null>(null);
const newStatus = ref<Record<string, string>>({});
const { people, load: loadPeople } = usePeople();
void loadPeople();
const assigneeChoices = computed(() => [
  { value: '', label: '—' },
  ...people.value.map((p) => ({ value: p.id, label: p.fullName || p.login, color: p.roleColor })),
]);

let projectReads = 0;

async function load(quiet = false): Promise<void> {
  if (!quiet) loading.value = true;
  loadError.value = null;
  const mine = ++projectReads;
  try {
    const short = String(route.params.short ?? '');
    const p = await api<Project>(`/projects/${encodeURIComponent(short)}`);
    if (mine !== projectReads) return;
    project.value = p;
    boards.value = [...p.boards].sort((a, b) => a.position - b.position);
  } catch (err) {
    if (mine !== projectReads) return;
    project.value = null;
    loadError.value = err instanceof Error ? err.message : 'Could not load the project.';
  } finally {
    if (mine === projectReads) loading.value = false;
  }
}

onMounted(() => void load());
watch(
  () => route.params.short,
  () => void load()
);

useLive(
  (ev) => {
    if (['project.changed', 'board.changed', 'state.changed'].includes(ev.type)) void load(true);
  },
  () => void load(true)
);

function replaceBoard(next: Board): void {
  boards.value = boards.value.map((b) => (b.id === next.id ? { ...b, ...next } : b));
}

function changeStates(boardId: string, change: (states: State[]) => State[]): void {
  boards.value = boards.value.map((b) => (b.id === boardId ? { ...b, states: change(b.states) } : b));
}

async function toggleArchived(): Promise<void> {
  if (!project.value) return;
  clear('project');
  try {
    const updated = await api<Project>(`/projects/${encodeURIComponent(project.value.shortName)}`, {
      method: 'PATCH',
      body: { archived: !project.value.archived },
    });
    project.value = { ...project.value, archived: updated.archived };
    await projectsStore.load(true);
  } catch (err) {
    fail('project', err);
  }
}

async function deleteProject(): Promise<void> {
  if (!project.value) return;
  clear('deleteProject');
  try {
    await api(`/projects/${encodeURIComponent(project.value.shortName)}`, {
      method: 'DELETE',
      body: { confirm: confirmKey.value },
    });
    await projectsStore.load(true);
    await router.push('/settings');
  } catch (err) {
    fail('deleteProject', err);
  }
}

async function addBoard(): Promise<void> {
  const name = newBoard.value.trim();
  if (!name || !project.value) return;
  clear('newBoard');
  try {
    const created = await api<Board>(
      `/projects/${encodeURIComponent(project.value.shortName)}/boards`,
      { method: 'POST', body: { name } }
    );
    boards.value = [...boards.value, created];
    newBoard.value = '';
    await projectsStore.load(true);
  } catch (err) {
    fail('newBoard', err);
  }
}

async function patchBoard(b: Board, body: Record<string, unknown>): Promise<void> {
  clear(b.id);
  try {
    replaceBoard(await api<Board>(`/boards/${b.id}`, { method: 'PATCH', body }));
    await projectsStore.load(true);
  } catch (err) {
    fail(b.id, err);
    await load();
  }
}

async function deleteBoard(): Promise<void> {
  const b = deletingBoard.value;
  if (!b) return;
  clear('deleteBoard');
  try {
    await api(`/boards/${b.id}`, { method: 'DELETE' });
    boards.value = boards.value.filter((row) => row.id !== b.id);
    deletingBoard.value = null;
    await projectsStore.load(true);
  } catch (err) {
    fail('deleteBoard', err);
  }
}

async function addStatus(b: Board): Promise<void> {
  const name = (newStatus.value[b.id] ?? '').trim();
  if (!name) return;
  clear(b.id);
  try {
    const created = await api<State>(`/boards/${b.id}/states`, {
      method: 'POST',
      body: { name },
    });
    changeStates(b.id, (states) => [...states, created]);
    newStatus.value = { ...newStatus.value, [b.id]: '' };
  } catch (err) {
    fail(b.id, err);
  }
}

async function patchStatus(b: Board, s: State, body: Record<string, unknown>): Promise<void> {
  clear(b.id);
  try {
    const updated = await api<State>(`/states/${s.id}`, { method: 'PATCH', body });
    changeStates(b.id, (states) => states.map((row) => (row.id === s.id ? updated : row)));
  } catch (err) {
    fail(b.id, err);
    await load();
  }
}

async function deleteStatus(b: Board, s: State): Promise<void> {
  clear(b.id);
  try {
    await api(`/states/${s.id}`, { method: 'DELETE' });
    changeStates(b.id, (states) => states.filter((row) => row.id !== s.id));
  } catch (err) {
    fail(b.id, err);
  }
}

const dragging = ref<{ boardId: string; stateId: string } | null>(null);

async function onDrop(b: Board, target: State): Promise<void> {
  const drag = dragging.value;
  dragging.value = null;
  if (!drag || drag.boardId !== b.id) return;
  const from = b.states.findIndex((s) => s.id === drag.stateId);
  const to = b.states.findIndex((s) => s.id === target.id);
  if (from < 0 || to < 0 || from === to) return;
  const next = [...b.states];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  replaceBoard({ ...b, states: next });
  try {
    await api(`/boards/${b.id}/states/order`, {
      method: 'POST',
      body: { ids: next.map((s) => s.id) },
    });
  } catch (err) {
    fail(b.id, err);
    await load();
  }
}
</script>

<template>
  <SettingsLayout>
    <template v-if="loading">
      <section class="panel sheet__wide">
        <header class="panel__h">Project</header>
        <div class="panel__b p-row">
          <div class="field p-key">
            <span class="label">Key</span>
            <span class="sk sk--field"></span>
          </div>
          <div class="field p-name">
            <span class="label">Name</span>
            <span class="sk sk--field"></span>
          </div>
          <span class="sk sk--field p-btn" style="width: 132px"></span>
          <span class="sk sk--field p-btn" style="width: 74px"></span>
        </div>
      </section>

      <section class="panel sheet__wide">
        <header class="panel__h">
          <span class="sk board-name-sk"></span>
          <span class="panel__end">
            <span class="sk sk--ctl" style="width: 96px"></span>
          </span>
        </header>
        <div class="board-prefs">
          <div class="field">
            <span class="label">Default status</span>
            <span class="sk default-pick-sk"></span>
          </div>
          <div class="field">
            <span class="label">Default assignee</span>
            <span class="sk default-pick-sk"></span>
          </div>
        </div>
        <div class="panel__table">
          <table class="tbl">
            <thead>
              <tr>
                <th class="c-grip"><span class="sr">Order</span></th>
                <th>Status</th>
                <th class="c-flag">Open</th>
                <th class="c-flag">Resolved</th>
                <th class="c-del"><span class="sr">Delete</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="w in [110, 86, 74, 64]" :key="w">
                <td class="c-grip grip"><GripVertical class="ic" /></td>
                <td><span class="sk sk--ctl" :style="{ width: `${w}px` }"></span></td>
                <td><span class="sk sk--box"></span></td>
                <td><span class="sk sk--box"></span></td>
                <td class="c-del"><span class="sk sk--ctl sk--right" style="width: 26px"></span></td>
              </tr>
            </tbody>
          </table>

          <div class="addrow">
            <span class="sk sk--field"></span>
            <span class="sk sk--field" style="flex: 0 0 56px"></span>
          </div>
        </div>
      </section>

      <section class="panel sheet__wide">
        <header class="panel__h">New board</header>
        <div class="panel__b">
          <div class="addrow">
            <span class="sk sk--field"></span>
            <span class="sk sk--field" style="flex: 0 0 56px"></span>
          </div>
        </div>
      </section>
    </template>
    <div v-else-if="!project" class="empty sheet__wide">
      <span class="empty__g">✕</span>{{ loadError }}
    </div>

    <template v-else>
      <section class="panel sheet__wide">
        <header class="panel__h">
          Project
          <span class="panel__end">{{ project.archived ? 'Archived' : '' }}</span>
        </header>
        <div class="panel__b p-row">
          <div class="field p-key">
            <label class="label" for="p-key">Key</label>
            <input id="p-key" class="input" :value="project.shortName" tabindex="-1" readonly />
          </div>
          <div class="field p-name">
            <label class="label" for="p-name">Name</label>
            <input id="p-name" class="input" :value="project.name" tabindex="-1" readonly />
          </div>
          <button class="btn p-btn" type="button" @click="toggleArchived">
            {{ project.archived ? 'Restore project' : 'Archive project' }}
          </button>
          <button
            class="btn btn--danger p-btn"
            type="button"
            :disabled="!canDelete"
            @click="deleting = true"
          >
            Delete
          </button>
        </div>
      </section>
      <div v-if="errors.project" class="err sheet__wide panel__err">{{ errors.project }}</div>

      <template v-for="b in boards" :key="b.id">
      <section class="panel sheet__wide">
        <header class="panel__h">
          <input
            class="input board-name"
            :value="b.name"
            maxlength="60"
            @change="patchBoard(b, { name: ($event.target as HTMLInputElement).value })"
          />
          <span class="panel__end">
            <button
              class="btn btn--sm btn--danger"
              type="button"
              :disabled="!canDelete"
              @click="deletingBoard = b"
            >
              Delete board
            </button>
          </span>
        </header>

        <div class="board-prefs">
          <div class="field">
            <label class="label" :for="`default-${b.id}`">Default status</label>
            <Select
              :id="`default-${b.id}`"
              class="default-pick"
              :model-value="b.defaultStateId ?? ''"
              :options="b.states.map((s) => ({ value: s.id, label: s.name, color: s.color }))"
              @update:model-value="patchBoard(b, { defaultStateId: $event })"
            />
          </div>
          <div class="field">
            <label class="label" :for="`assignee-${b.id}`">Default assignee</label>
            <Select
              :id="`assignee-${b.id}`"
              class="default-pick"
              :model-value="b.defaultAssigneeId ?? ''"
              :options="assigneeChoices"
              @update:model-value="patchBoard(b, { defaultAssigneeId: $event || null })"
            />
          </div>
        </div>
        <div class="panel__table">
          <table class="tbl">
            <thead>
              <tr>
                <th class="c-grip"><span class="sr">Order</span></th>
                <th>Status</th>
                <th class="c-flag">Open</th>
                <th class="c-flag">Resolved</th>
                <th class="c-del"><span class="sr">Delete</span></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="s in b.states"
                :key="s.id"
                draggable="true"
                @dragstart="dragging = { boardId: b.id, stateId: s.id }"
                @dragover.prevent
                @drop.prevent="onDrop(b, s)"
              >
                <td class="c-grip grip"><GripVertical class="ic" /></td>
                <td>
                  <input
                    class="input input--sm status-name"
                    :value="s.name"
                    :style="{ color: ink(s.color) }"
                    maxlength="60"
                    @change="patchStatus(b, s, { name: ($event.target as HTMLInputElement).value })"
                  />
                </td>
                <td>
                  <label class="check">
                    <input
                      type="checkbox"
                      :checked="s.isOpen"
                      @change="patchStatus(b, s, { isOpen: ($event.target as HTMLInputElement).checked })"
                    />
                  </label>
                </td>
                <td>
                  <label class="check">
                    <input
                      type="checkbox"
                      :checked="s.isResolved"
                      @change="patchStatus(b, s, { isResolved: ($event.target as HTMLInputElement).checked })"
                    />
                  </label>
                </td>
                <td class="c-del">
                  <button
                    class="btn btn--sm btn--icon btn--ghost"
                    type="button"
                    aria-label="Delete status"
                    :disabled="!canDelete"
                    @click="deleteStatus(b, s)"
                  >
                    <X class="ic ic--sm" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>

          <form class="addrow" @submit.prevent="addStatus(b)">
            <input
              :value="newStatus[b.id] ?? ''"
              class="input"
              placeholder="Add status…"
              maxlength="60"
              @input="newStatus = { ...newStatus, [b.id]: ($event.target as HTMLInputElement).value }"
            />
            <button class="btn" type="submit" :disabled="!(newStatus[b.id] ?? '').trim()">Add</button>
          </form>
        </div>
      </section>
      <div v-if="errors[b.id]" class="err sheet__wide panel__err">{{ errors[b.id] }}</div>
      </template>

      <section class="panel sheet__wide">
        <header class="panel__h">New board</header>
        <div class="panel__b">
          <form class="addrow" @submit.prevent="addBoard">
            <input v-model="newBoard" class="input" placeholder="Add board…" maxlength="60" />
            <button class="btn" type="submit" :disabled="!newBoard.trim()">Add</button>
          </form>
        </div>
      </section>
      <div v-if="errors.newBoard" class="err sheet__wide panel__err">{{ errors.newBoard }}</div>
    </template>

    <Dialog
      v-if="deletingBoard"
      :title="`Delete ${deletingBoard.name}`"
      @close="deletingBoard = null"
    >
      <p class="dialog__lede">
        This takes the board's statuses and issues with it. This cannot be undone.
      </p>
      <div v-if="errors.deleteBoard" class="err">{{ errors.deleteBoard }}</div>
      <template #footer>
        <button class="btn" type="button" @click="deletingBoard = null">Cancel</button>
        <button class="btn btn--danger" type="button" @click="deleteBoard">Delete board</button>
      </template>
    </Dialog>

    <Dialog
      v-if="deleting && project"
      :title="`Delete ${project.name}`"
      @close="deleting = false; confirmKey = ''"
    >
      <p class="dialog__lede">
        This takes the project's boards, statuses, issues and its own tags with it. This cannot be undone.
      </p>
      <div class="field">
        <label class="label" for="p-confirm">Type name of the project to confirm</label>
        <input id="p-confirm" v-model="confirmKey" class="input" autofocus @keydown.enter.prevent="deleteProject" />
      </div>
      <div v-if="errors.deleteProject" class="err">{{ errors.deleteProject }}</div>
      <template #footer>
        <button class="btn" type="button" @click="deleting = false; confirmKey = ''">Cancel</button>
        <button
          class="btn btn--danger"
          type="button"
          :disabled="confirmKey.trim().toLowerCase() !== project.name.trim().toLowerCase()"
          @click="deleteProject"
        >
          Delete project
        </button>
      </template>
    </Dialog>
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
.dialog__lede {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-dim);
}
.p-btn {
  height: 34px;
}
.board-name {
  width: 220px;
  height: 30px;
  font-weight: 600;
}
.board-name-sk {
  display: block;
  width: 220px;
  height: 30px;
}
.sk--right {
  margin-left: auto;
}
.board-prefs {
  display: flex;
  gap: 24px;
  padding: 12px 16px 14px 20px;
  border-bottom: 1px solid var(--line);
}
.default-pick {
  width: 160px;
  height: 30px;
}
.default-pick-sk {
  display: block;
  width: 160px;
  height: 30px;
}
.panel__end {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.addrow {
  padding: 0 4px;
}
.grip {
  color: var(--text-dim);
  cursor: grab;
}
.status-name {
  font-weight: 500;
}
.c-grip {
  width: 28px;
}
.c-flag {
  width: 70px;
}
.c-del {
  width: 44px;
}
</style>
