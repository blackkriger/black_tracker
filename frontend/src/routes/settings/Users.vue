<script setup lang="ts">
// Who can get in, and what they cannot open. Accounts are never deleted — an account carries authorship of issues, comments and history — so the switch here is on and off. Boards are taken away one at a time; everything else is open to everyone signed in.
import { computed, onMounted, ref } from 'vue';
import SettingsLayout from '../../components/SettingsLayout.vue';
import Dialog from '../../components/Dialog.vue';
import { api } from '../../lib/api';
import { buddyAvatarStyle } from '../../lib/avatar';
import { usePanelErrors } from '../../lib/panelErrors';
import { useProjects } from '../../lib/projects';
import { useSession } from '../../lib/session';

interface Role {
  id: string;
  name: string;
  color: string;
  /** May delete projects, boards, statuses and tags. The creator's own key is elsewhere and is not a role. */
  canDelete: boolean;
}

interface User {
  id: string;
  login: string;
  fullName: string;
  active: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  role: Role | null;
}

interface Invite {
  id: string;
  hint: string;
  createdAt: string;
  createdBy: string | null;
  expiresAt: string;
  usedAt: string | null;
  usedBy: string | null;
  role: Role | null;
  status: 'pending' | 'used' | 'expired';
}

const session = useSession();
const { projects, load: loadProjects } = useProjects();

const users = ref<User[]>([]);
const invites = ref<Invite[]>([]);
const roles = ref<Role[]>([]);
const removingRole = ref<Role | null>(null);
const loading = ref(true);
const { errors, fail, clear } = usePanelErrors();

const inviteRole = ref('');
const inviteBusy = ref(false);
// Held only until the page is left: the server keeps a hash, so this is the one moment the link exists anywhere readable.
const freshLink = ref<string | null>(null);
const copied = ref(false);

const newRole = ref('');
const accessFor = ref<Role | null>(null);
const accessCanDelete = ref(false);
// Two kinds of denial: a whole project, or single boards inside one the role does have.
const deniedProjects = ref<string[]>([]);
const deniedBoards = ref<string[]>([]);
const accessBusy = ref(false);

// Every project, boards or not: a project with nothing on it yet can still be closed to a role.
const accessProjects = computed(() => projects.value);

const projectDenied = (id: string) => deniedProjects.value.includes(id);
const boardDenied = (id: string) => deniedBoards.value.includes(id);

onMounted(async () => {
  await loadProjects();
  await Promise.all([
    api<User[]>('/users')
      .then((rows) => (users.value = rows))
      .catch((err) => fail('users', err, 'Could not load the accounts.')),
    api<Invite[]>('/invites')
      .then((rows) => (invites.value = rows))
      .catch((err) => fail('invites', err, 'Could not load the invite links.')),
    api<Role[]>('/roles')
      .then((rows) => (roles.value = rows))
      .catch((err) => fail('roles', err, 'Could not load the roles.')),
  ]);
  loading.value = false;
});

function stamp(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso)
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase();
}

async function patchUser(u: User, body: Record<string, unknown>): Promise<void> {
  clear('users');
  try {
    const updated = await api<User>(`/users/${u.id}`, { method: 'PATCH', body });
    users.value = users.value.map((row) => (row.id === u.id ? updated : row));
  } catch (err) {
    fail('users', err);
  }
}

async function addRole(): Promise<void> {
  const name = newRole.value.trim();
  if (!name) return;
  clear('roles');
  try {
    roles.value = [...roles.value, await api<Role>('/roles', { method: 'POST', body: { name } })];
    newRole.value = '';
  } catch (err) {
    fail('roles', err);
  }
}

async function patchRole(role: Role, body: Record<string, unknown>, panel = 'roles'): Promise<void> {
  clear(panel);
  const updated = await api<Role>(`/roles/${role.id}`, { method: 'PATCH', body });
  roles.value = roles.value.map((r) => (r.id === role.id ? updated : r));
  // Whoever wears it is holding the old name on this screen until it is read again.
  users.value = users.value.map((u) => (u.role?.id === role.id ? { ...u, role: updated } : u));
}

function renameRole(role: Role, name: string): void {
  if (!name.trim() || name === role.name) return;
  patchRole(role, { name }).catch((err) => fail('roles', err));
}

async function removeRole(): Promise<void> {
  const role = removingRole.value;
  if (!role) return;
  clear('removeRole');
  try {
    await api(`/roles/${role.id}`, { method: 'DELETE' });
    roles.value = roles.value.filter((r) => r.id !== role.id);
    users.value = users.value.map((u) => (u.role?.id === role.id ? { ...u, role: null } : u));
    removingRole.value = null;
  } catch (err) {
    // The dialog stays open with the reason in it rather than closing on a failure nobody read.
    fail('removeRole', err);
  }
}

async function createInvite(): Promise<void> {
  if (inviteBusy.value) return;
  inviteBusy.value = true;
  clear('invites');
  copied.value = false;
  try {
    const created = await api<Invite & { token: string }>('/invites', {
      method: 'POST',
      body: { roleId: inviteRole.value || null },
    });
    const { token, ...row } = created;
    freshLink.value = `${location.origin}/join/${token}`;
    invites.value = [row, ...invites.value];
    inviteRole.value = '';
  } catch (err) {
    fail('invites', err);
  } finally {
    inviteBusy.value = false;
  }
}

async function copyLink(): Promise<void> {
  if (!freshLink.value) return;
  try {
    await navigator.clipboard.writeText(freshLink.value);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}

async function revokeInvite(i: Invite): Promise<void> {
  clear('invites');
  try {
    await api(`/invites/${i.id}`, { method: 'DELETE' });
    invites.value = invites.value.filter((row) => row.id !== i.id);
  } catch (err) {
    fail('invites', err);
  }
}

async function openAccess(role: Role): Promise<void> {
  accessFor.value = role;
  accessCanDelete.value = role.canDelete;
  deniedProjects.value = [];
  deniedBoards.value = [];
  clear('access');
  try {
    const res = await api<{ deniedProjects: string[]; deniedBoards: string[] }>(
      `/roles/${role.id}/access`
    );
    deniedProjects.value = res.deniedProjects;
    deniedBoards.value = res.deniedBoards;
  } catch (err) {
    fail('access', err, 'Could not read what this role can open.');
  }
}

// Closing a project leaves its board denials alone, so re-opening it gives back exactly the picture it had.
function toggleProject(projectId: string, allowed: boolean): void {
  deniedProjects.value = allowed
    ? deniedProjects.value.filter((id) => id !== projectId)
    : [...deniedProjects.value, projectId];
}

function toggleBoard(boardId: string, allowed: boolean): void {
  deniedBoards.value = allowed
    ? deniedBoards.value.filter((id) => id !== boardId)
    : [...deniedBoards.value, boardId];
}

async function saveAccess(): Promise<void> {
  const role = accessFor.value;
  if (!role || accessBusy.value) return;
  accessBusy.value = true;
  clear('access');
  try {
    if (accessCanDelete.value !== role.canDelete) {
      await patchRole(role, { canDelete: accessCanDelete.value }, 'access');
    }
    await api(`/roles/${role.id}/access`, {
      method: 'PUT',
      body: { deniedProjects: deniedProjects.value, deniedBoards: deniedBoards.value },
    });
    accessFor.value = null;
  } catch (err) {
    fail('access', err);
  } finally {
    accessBusy.value = false;
  }
}
</script>

<template>
  <SettingsLayout>
    <section class="panel sheet__wide">
      <header class="panel__h">Users</header>
      <div class="panel__table">
        <table class="tbl">
          <thead>
            <tr>
              <th>Person</th>
              <th class="c-role">Role</th>
              <th class="c-flag">Active</th>
              <th class="c-when">Joined</th>
              <th class="c-when">Last seen</th>
            </tr>
          </thead>
          <tbody v-if="loading">
            <tr v-for="w in [120, 96, 140]" :key="w">
              <td>
                <span class="who">
                  <span class="sk sk--av"></span>
                  <span class="sk sk--line" :style="{ width: `${w}px` }"></span>
                </span>
              </td>
              <td class="c-role"><span class="sk sk--ctl"></span></td>
              <td><span class="sk sk--box"></span></td>
              <td class="c-when"><span class="sk sk--line" style="width: 88px"></span></td>
              <td class="c-when"><span class="sk sk--line" style="width: 88px"></span></td>
            </tr>
          </tbody>
          <tbody v-else>
            <tr v-for="u in users" :key="u.id">
              <td>
                <span class="who">
                  <span class="av av--lg" :style="buddyAvatarStyle(u.login)"></span>
                  <span class="who__lines">
                    <span class="who__name">{{ u.fullName || u.login }}</span>
                    <span v-if="u.fullName" class="who__login">{{ u.login }}</span>
                  </span>
                </span>
              </td>
              <td class="c-role">
                <select
                  class="input input--sm"
                  :value="u.role?.id ?? ''"
                  :style="{ color: u.role?.color ?? 'var(--text-dim)' }"
                  @change="patchUser(u, { roleId: ($event.target as HTMLSelectElement).value || null })"
                >
                  <option value="">—</option>
                  <option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }}</option>
                </select>
              </td>
              <td>
                <label class="check">
                  <input
                    type="checkbox"
                    :checked="u.active"
                    :disabled="u.id === session.me.value?.id"
                    @change="patchUser(u, { active: ($event.target as HTMLInputElement).checked })"
                  />
                </label>
              </td>
              <td class="stamp">{{ stamp(u.createdAt) }}</td>
              <td class="stamp">{{ stamp(u.lastSeenAt) || '—' }}</td>
            </tr>
          </tbody>
        </table>

      </div>
    </section>
    <div v-if="errors.users" class="err sheet__wide panel__err">{{ errors.users }}</div>

    <section class="panel sheet__wide">
      <header class="panel__h">Roles</header>
      <div class="panel__table">
        <table v-if="loading" class="tbl">
          <thead>
            <tr>
              <th>Role</th>
              <th class="c-act2">Access</th>
              <th class="c-del"><span class="sr">Delete</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="n in 2" :key="n">
              <td><span class="sk sk--ctl"></span></td>
              <td class="c-act2"><span class="sk sk--ctl" style="width: 72px"></span></td>
              <td class="c-del"><span class="sk sk--ctl sk--right" style="width: 26px"></span></td>
            </tr>
          </tbody>
        </table>
        <table v-else-if="roles.length" class="tbl">
          <thead>
            <tr>
              <th>Role</th>
              <th class="c-act2">Access</th>
              <th class="c-del"><span class="sr">Delete</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in roles" :key="r.id">
              <td>
                <input
                  class="input input--sm role-name"
                  :value="r.name"
                  :style="{ color: r.color }"
                  maxlength="40"
                  @change="renameRole(r, ($event.target as HTMLInputElement).value)"
                />
              </td>
              <td class="c-act2">
                <button class="btn btn--sm" type="button" @click="openAccess(r)">Access…</button>
              </td>
              <td class="c-del">
                <button
                  class="btn btn--sm btn--icon btn--ghost"
                  type="button"
                  aria-label="Delete role"
                  @click="removingRole = r"
                >
                  ✕
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else-if="!loading" class="empty empty--sm">
          <span class="empty__g">◇</span>None yet.
        </div>

        <div v-if="loading" class="addrow">
          <span class="sk sk--field"></span>
          <span class="sk sk--field" style="flex: 0 0 56px"></span>
        </div>
        <form v-else class="addrow" @submit.prevent="addRole">
          <input v-model="newRole" class="input" placeholder="Add role…" maxlength="40" />
          <button class="btn" type="submit" :disabled="!newRole.trim()">Add</button>
        </form>
      </div>
    </section>
    <div v-if="errors.roles" class="err sheet__wide panel__err">{{ errors.roles }}</div>

    <section class="panel sheet__wide">
      <header class="panel__h">Invite links</header>
      <div class="panel__b">
        <div v-if="freshLink" class="field">
          <span class="label">The link — copy it now</span>
          <div class="link__row">
            <code class="input link__value">{{ freshLink }}</code>
            <button class="btn" type="button" @click="copyLink">{{ copied ? 'Copied' : 'Copy' }}</button>
            <button
              class="btn btn--icon btn--ghost"
              type="button"
              aria-label="Hide the link"
              @click="freshLink = null"
            >
              ✕
            </button>
          </div>
          <span class="hint">It is stored as a hash, so this is the only time it can be read.</span>
        </div>

        <div v-if="loading" class="addrow">
          <span class="sk sk--field" style="flex: 0 0 180px"></span>
          <div class="sp"></div>
          <span class="sk sk--field" style="flex: 0 0 96px"></span>
        </div>
        <div v-else-if="!freshLink" class="addrow">
          <select v-model="inviteRole" class="input invite__role">
            <option value="">No role</option>
            <option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>
          <div class="sp"></div>
          <button class="btn" type="button" :disabled="inviteBusy" @click="createInvite">
            Create link
          </button>
        </div>
      </div>

      <div v-if="loading" class="panel__table">
        <table class="tbl">
          <thead>
            <tr>
              <th>Link</th>
              <th class="c-role">Role</th>
              <th>Status</th>
              <th class="c-when">Created</th>
              <th class="c-act"><span class="sr">Revoke</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="n in 2" :key="n">
              <td><span class="sk sk--line" style="width: 64px"></span></td>
              <td class="c-role"><span class="sk sk--line" style="width: 80px; height: 24px"></span></td>
              <td><span class="sk sk--line" style="width: 150px"></span></td>
              <td class="c-when"><span class="sk sk--line" style="width: 130px"></span></td>
              <td class="c-act"><span class="sk sk--ctl sk--right" style="width: 26px"></span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else-if="invites.length" class="panel__table">
        <table class="tbl">
          <thead>
            <tr>
              <th>Link</th>
              <th class="c-role">Role</th>
              <th>Status</th>
              <th class="c-when">Created</th>
              <th class="c-act"><span class="sr">Revoke</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in invites" :key="i.id">
              <td class="key">…{{ i.hint }}</td>
              <td class="c-role">
                <span v-if="i.role" class="taglabel taglabel--plain" :style="{ '--c': i.role.color }">
                  {{ i.role.name }}
                </span>
              </td>
              <td>
                <template v-if="i.status === 'used'">Used by {{ i.usedBy }}</template>
                <template v-else-if="i.status === 'expired'">Expired</template>
                <template v-else>Good until {{ stamp(i.expiresAt) }}</template>
              </td>
              <td class="stamp">{{ stamp(i.createdAt) }}, {{ i.createdBy }}</td>
              <td class="c-act">
                <button
                  class="btn btn--sm btn--icon btn--ghost"
                  type="button"
                  aria-label="Revoke link"
                  @click="revokeInvite(i)"
                >
                  ✕
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <div v-if="errors.invites" class="err sheet__wide panel__err">{{ errors.invites }}</div>

    <Dialog
      v-if="removingRole"
      :title="`Delete ${removingRole.name}?`"
      @close="removingRole = null"
    >
      <p>Whoever wears it stops wearing one. This cannot be undone.</p>
      <div v-if="errors.removeRole" class="err">{{ errors.removeRole }}</div>
      <template #footer>
        <div class="sp"></div>
        <button class="btn" type="button" @click="removingRole = null">Cancel</button>
        <button class="btn btn--danger" type="button" @click="removeRole">Delete</button>
      </template>
    </Dialog>

    <Dialog
      v-if="accessFor"
      :title="`Access — ${accessFor.name}`"
      :width="560"
      @close="accessFor = null"
    >
      <label class="check access__right">
        <input v-model="accessCanDelete" type="checkbox" />
        May delete projects, boards, statuses and tags
      </label>
      <div class="access__sep"></div>

      <div v-for="p in accessProjects" :key="p.id" class="access__group">
        <label class="check access__proj">
          <input
            type="checkbox"
            :checked="!projectDenied(p.id)"
            :indeterminate.prop="!projectDenied(p.id) && p.boards.some((b) => boardDenied(b.id))"
            @change="toggleProject(p.id, ($event.target as HTMLInputElement).checked)"
          />
          <span class="proj__k">{{ p.shortName }}</span>
          {{ p.name }}
        </label>
        <label v-for="b in p.boards" :key="b.id" class="check access__row">
          <input
            type="checkbox"
            :checked="!projectDenied(p.id) && !boardDenied(b.id)"
            :disabled="projectDenied(p.id)"
            @change="toggleBoard(b.id, ($event.target as HTMLInputElement).checked)"
          />
          {{ b.name }}
        </label>
      </div>
      <div v-if="!accessProjects.length" class="empty empty--sm">
        <span class="empty__g">◇</span>No projects yet.
      </div>
      <div v-if="errors.access" class="err access__err">{{ errors.access }}</div>

      <template #footer>
        <div class="sp"></div>
        <button class="btn" type="button" @click="accessFor = null">Cancel</button>
        <button
          class="btn btn--primary"
          type="button"
          :disabled="accessBusy"
          @click="saveAccess"
        >
          Save
        </button>
      </template>
    </Dialog>
  </SettingsLayout>
</template>

<style scoped>
/* A block flex row rather than an inline one: an inline box sits on the text baseline, which drops the avatar below the middle of the row. */
.who {
  display: flex;
  align-items: center;
  gap: 10px;
}
.who__lines {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.who__login {
  font: 11px/1 var(--font-num);
  color: var(--text-muted);
}
.c-role {
  width: 150px;
}
.c-flag {
  width: 70px;
}
.c-when {
  width: 120px;
}
.c-act2 {
  width: 92px;
}
.sk--right {
  margin-left: auto;
}
.c-del {
  width: 44px;
  text-align: right;
}
.role-name {
  width: 100%;
  font-weight: 500;
}
.link__row {
  display: flex;
  gap: 8px;
}
.link__value {
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
  white-space: nowrap;
  font: 12px/32px var(--font-num);
  color: var(--text);
}
.addrow {
  align-items: center;
}
.invite__role {
  flex: 0 0 180px;
  height: 34px;
}
.access__group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.access__group + .access__group {
  margin-top: var(--space-4);
}
.access__right {
  font-size: 13px;
}
.access__sep {
  margin: var(--space-4) 0;
  border-top: 1px solid var(--line);
}
.access__proj {
  font-weight: 500;
}
.access__err {
  margin-top: var(--space-3);
}
.access__row {
  margin-left: 24px;
  font-size: 13px;
  color: var(--text-dim);
}
.access__row input:disabled {
  opacity: 0.4;
}
</style>
