<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import SettingsLayout from '../../components/SettingsLayout.vue';
import Dialog from '../../components/Dialog.vue';
import Select from '../../components/Select.vue';
import { api } from '../../lib/api';
import { buddyAvatarStyle } from '../../lib/avatar';
import { stamp, stampAt } from '../../lib/issues';
import { useLive } from '../../lib/live';
import { usePanelErrors } from '../../lib/panelErrors';
import { usePeople } from '../../lib/people';
import { useProjects } from '../../lib/projects';
import { useSession } from '../../lib/session';
import { X } from 'lucide-vue-next';
import { ink } from '../../lib/theme';

interface Role {
  id: string;
  name: string;
  color: string;
  canDelete: boolean;
  canManageRoles: boolean;
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
  kind: 'invite' | 'reset';
  forUser: string | null;
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
const { isAdmin, canManageRoles } = session;
const { projects, load: loadProjects } = useProjects();

const users = ref<User[]>([]);
const invites = ref<Invite[]>([]);
const roles = ref<Role[]>([]);
const removingRole = ref<Role | null>(null);
const loading = ref(true);
const { errors, fail, clear } = usePanelErrors();
const { nameOf, load: loadPeople } = usePeople();

const inviteRole = ref('');
const linkKind = ref('invite');
const resetUser = ref('');
const KIND_CHOICES = [
  { value: 'invite', label: 'Invite' },
  { value: 'reset', label: 'Password reset' },
];
const personChoices = computed(() =>
  users.value
    .filter((u) => u.active)
    .map((u) => ({ value: u.id, label: u.fullName || u.login, color: u.role?.color ?? null }))
);
const roleChoices = computed(() => [
  { value: '', label: '—' },
  ...roles.value.map((r) => ({ value: r.id, label: r.name, color: r.color })),
]);
const inviteChoices = computed(() => [
  { value: '', label: 'No role' },
  ...roles.value.map((r) => ({ value: r.id, label: r.name, color: r.color })),
]);

const inviteBusy = ref(false);
const freshLink = ref<string | null>(null);
const copied = ref(false);

const newRole = ref('');
const accessFor = ref<Role | null>(null);
const accessRead = ref(false);
let accessReads = 0;
const accessCanDelete = ref(false);
const accessCanManageRoles = ref(false);
const deniedProjects = ref<string[]>([]);
const deniedBoards = ref<string[]>([]);
const accessBusy = ref(false);

const accessProjects = computed(() => projects.value);

const projectDenied = (id: string) => deniedProjects.value.includes(id);
const boardDenied = (id: string) => deniedBoards.value.includes(id);

onMounted(async () => {
  void loadPeople();
  await loadProjects();
  await Promise.all([
    api<User[]>('/users')
      .then((rows) => (users.value = rows))
      .catch((err) => fail('users', err, 'Could not load the accounts.')),
    canManageRoles.value
      ? api<Invite[]>('/invites')
          .then((rows) => (invites.value = rows))
          .catch((err) => fail('invites', err, 'Could not load the invite links.'))
      : Promise.resolve(),
    api<Role[]>('/roles')
      .then((rows) => (roles.value = rows))
      .catch((err) => fail('roles', err, 'Could not load the roles.')),
  ]);
  loading.value = false;
});

useLive((ev) => {
  if (ev.type === 'user.changed') {
    void api<User[]>('/users').then((rows) => (users.value = rows)).catch(() => {});
  }
  if (ev.type === 'role.changed') {
    void api<Role[]>('/roles').then((rows) => (roles.value = rows)).catch(() => {});
  }
  if (ev.type === 'invite.changed' && canManageRoles.value) {
    void api<Invite[]>('/invites').then((rows) => (invites.value = rows)).catch(() => {});
  }
});

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
    fail('removeRole', err);
  }
}

async function createInvite(): Promise<void> {
  const reset = linkKind.value === 'reset';
  if (inviteBusy.value || (reset && !resetUser.value)) return;
  inviteBusy.value = true;
  clear('invites');
  copied.value = false;
  try {
    const created = await api<Invite & { token: string }>('/invites', {
      method: 'POST',
      body: reset ? { forUserId: resetUser.value } : { roleId: inviteRole.value || null },
    });
    const { token, ...row } = created;
    freshLink.value = `${location.origin}/${reset ? 'reset' : 'join'}/${token}`;
    invites.value = [
      row,
      ...invites.value.filter((i) => !(reset && i.kind === 'reset' && i.forUser === row.forUser && !i.usedAt)),
    ];
    inviteRole.value = '';
    resetUser.value = '';
    await copyLink();
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

const revokingInvite = ref<Invite | null>(null);

async function confirmRevokeInvite(): Promise<void> {
  const i = revokingInvite.value;
  revokingInvite.value = null;
  if (i) await revokeInvite(i);
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
  accessCanManageRoles.value = role.canManageRoles;
  deniedProjects.value = [];
  deniedBoards.value = [];
  accessRead.value = false;
  clear('access');
  const mine = ++accessReads;
  try {
    const res = await api<{ deniedProjects: string[]; deniedBoards: string[] }>(
      `/roles/${role.id}/access`
    );
    if (mine !== accessReads) return;
    deniedProjects.value = res.deniedProjects;
    deniedBoards.value = res.deniedBoards;
    accessRead.value = true;
  } catch (err) {
    if (mine !== accessReads) return;
    fail('access', err, 'Could not read what this role can open.');
  }
}

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
  if (!role || accessBusy.value || !accessRead.value) return;
  accessBusy.value = true;
  clear('access');
  try {
    if (
      accessCanDelete.value !== role.canDelete ||
      accessCanManageRoles.value !== role.canManageRoles
    ) {
      await patchRole(
        role,
        { canDelete: accessCanDelete.value, canManageRoles: accessCanManageRoles.value },
        'access'
      );
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
      <div class="panel__table panel__table--head">
        <table class="tbl tbl--head">
          <thead>
            <tr>
              <th>Users</th>
              <th class="c-role">role</th>
              <th class="c-flag">active</th>
              <th class="c-when">joined</th>
              <th class="c-when">last seen</th>
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
                <Select
                  :model-value="u.role?.id ?? ''"
                  :options="roleChoices"
                  small
                  :disabled="!canManageRoles"
                  @update:model-value="patchUser(u, { roleId: $event || null })"
                />
              </td>
              <td>
                <label class="check">
                  <input
                    type="checkbox"
                    :checked="u.active"
                    :disabled="!isAdmin || u.id === session.me.value?.id"
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
      <div class="panel__table panel__table--head">
        <table class="tbl tbl--head">
          <thead>
            <tr>
              <th>Roles</th>
              <th class="c-act2">access</th>
              <th class="c-del"><span class="sr">Delete</span></th>
            </tr>
          </thead>
          <tbody v-if="loading">
            <tr v-for="n in 2" :key="n">
              <td><span class="sk sk--ctl"></span></td>
              <td class="c-act2"><span class="sk sk--ctl" style="width: 72px"></span></td>
              <td class="c-del"><span class="sk sk--ctl sk--right" style="width: 26px"></span></td>
            </tr>
          </tbody>
          <tbody v-else>
            <tr v-for="r in roles" :key="r.id">
              <td>
                <input
                  class="input input--sm role-name"
                  :value="r.name"
                  :style="{ color: ink(r.color) }"
                  maxlength="40"
                  :readonly="!isAdmin"
                  :tabindex="isAdmin ? undefined : -1"
                  @change="renameRole(r, ($event.target as HTMLInputElement).value)"
                />
              </td>
              <td class="c-act2">
                <button class="btn btn--sm" type="button" :disabled="!isAdmin" @click="openAccess(r)">
                  Access…
                </button>
              </td>
              <td class="c-del">
                <button
                  class="btn btn--sm btn--icon btn--ghost"
                  type="button"
                  aria-label="Delete role"
                  :disabled="!isAdmin"
                  @click="removingRole = r"
                >
                  <X class="ic ic--sm" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="!loading && !roles.length" class="empty empty--sm">
          <span class="empty__g">◇</span>None yet.
        </div>

        <div v-if="loading" class="addrow">
          <span class="sk sk--field"></span>
          <span class="sk sk--field" style="flex: 0 0 56px"></span>
        </div>
        <form v-else class="addrow" @submit.prevent="addRole">
          <input
            v-model="newRole"
            class="input"
            placeholder="Add role…"
            maxlength="40"
            :disabled="!isAdmin"
          />
          <button class="btn" type="submit" :disabled="!isAdmin || !newRole.trim()">Add</button>
        </form>
      </div>
    </section>
    <div v-if="errors.roles" class="err sheet__wide panel__err">{{ errors.roles }}</div>

    <section v-if="canManageRoles" class="panel sheet__wide">
      <div class="panel__table panel__table--head">
        <table class="tbl tbl--head">
          <thead>
            <tr>
              <th>Links</th>
              <th class="c-kind">kind</th>
              <th class="c-role">for</th>
              <th>status</th>
              <th class="c-when">created</th>
              <th class="c-act"><span class="sr">Revoke</span></th>
            </tr>
          </thead>
          <tbody v-if="loading">
            <tr v-for="n in 2" :key="n">
              <td><span class="sk sk--line" style="width: 64px"></span></td>
              <td class="c-kind"><span class="sk sk--line" style="width: 90px"></span></td>
              <td class="c-role"><span class="sk sk--line" style="width: 80px; height: 24px"></span></td>
              <td><span class="sk sk--line" style="width: 150px"></span></td>
              <td class="c-when"><span class="sk sk--line" style="width: 130px"></span></td>
              <td class="c-act"><span class="sk sk--ctl sk--right" style="width: 26px"></span></td>
            </tr>
          </tbody>
          <tbody v-else>
            <tr v-for="i in invites" :key="i.id">
              <td class="key">…{{ i.hint }}</td>
              <td class="c-kind">{{ i.kind === 'reset' ? 'Password reset' : 'Invite' }}</td>
              <td class="c-role">
                <span v-if="i.kind === 'reset'" class="who__lines">
                  {{ nameOf(i.forUser) }}
                  <span v-if="i.forUser && nameOf(i.forUser) !== i.forUser" class="who__login">{{ i.forUser }}</span>
                </span>
                <span v-else-if="i.role" class="taglabel taglabel--plain" :style="{ '--c': i.role.color }">
                  {{ i.role.name }}
                </span>
              </td>
              <td>
                <span v-if="i.status === 'used'" class="who__lines">
                  Used by {{ nameOf(i.usedBy) }}
                  <span v-if="i.usedBy && nameOf(i.usedBy) !== i.usedBy" class="who__login">{{ i.usedBy }}</span>
                </span>
                <template v-else-if="i.status === 'expired'">Expired</template>
                <template v-else>Good until {{ stampAt(i.expiresAt) }}</template>
              </td>
              <td class="stamp">
                <span class="who__lines">
                  <span>{{ stampAt(i.createdAt) }}, <span class="who__by">{{ nameOf(i.createdBy) }}</span></span>
                  <span v-if="i.createdBy && nameOf(i.createdBy) !== i.createdBy" class="who__login">{{ i.createdBy }}</span>
                </span>
              </td>
              <td class="c-act">
                <button
                  v-if="i.status !== 'used'"
                  class="btn btn--sm btn--icon btn--ghost"
                  type="button"
                  aria-label="Delete link"
                  @click="i.kind === 'reset' ? revokeInvite(i) : (revokingInvite = i)"
                >
                  <X class="ic ic--sm" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-if="freshLink" class="field link__fresh">
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
              <X class="ic ic--sm" />
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
          <Select v-model="linkKind" class="invite__role" :options="KIND_CHOICES" />
          <Select
            v-if="linkKind === 'invite'"
            v-model="inviteRole"
            class="invite__role"
            :options="inviteChoices"
          />
          <Select
            v-else
            v-model="resetUser"
            class="invite__role"
            :options="personChoices"
            placeholder="—"
          />
          <div class="sp"></div>
          <button
            class="btn"
            type="button"
            :disabled="inviteBusy || (linkKind === 'reset' && !resetUser)"
            @click="createInvite"
          >
            Create link
          </button>
        </div>
      </div>
    </section>
    <div v-if="canManageRoles && errors.invites" class="err sheet__wide panel__err">
      {{ errors.invites }}
    </div>

    <Dialog v-if="revokingInvite" title="Delete invite link" @close="revokingInvite = null">
      <p>Nobody can join with it any more. This cannot be undone.</p>
      <template #footer>
        <div class="sp"></div>
        <button class="btn" type="button" @click="revokingInvite = null">Cancel</button>
        <button class="btn btn--danger" type="button" @click="confirmRevokeInvite">Delete link</button>
      </template>
    </Dialog>

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
        May delete anything people made
      </label>
      <label class="check access__right">
        <input v-model="accessCanManageRoles" type="checkbox" />
        May give people a role and invite new ones
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
          :disabled="accessBusy || !accessRead"
          @click="saveAccess"
        >
          Save
        </button>
      </template>
    </Dialog>
  </SettingsLayout>
</template>

<style scoped>
/* display:flex, not inline-flex: an inline box aligns to the text baseline and knocks the avatar off centre. */
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
.who__by {
  color: var(--text-dim);
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
.c-kind {
  width: 130px;
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
.link__fresh {
  margin-top: 12px;
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
