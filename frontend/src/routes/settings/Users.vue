<script setup lang="ts">
// Who can get in, and what they cannot open. Accounts are never deleted — an account carries authorship of issues, comments and history — so the switch here is on and off. Boards are taken away one at a time; everything else is open to everyone signed in.
import { computed, onMounted, ref } from 'vue';
import SettingsLayout from '../../components/SettingsLayout.vue';
import Dialog from '../../components/Dialog.vue';
import TagLabels, { type TagItem } from '../../components/TagLabels.vue';
import { api } from '../../lib/api';
import { buddyAvatarStyle } from '../../lib/avatar';
import { useProjects } from '../../lib/projects';
import { useSession } from '../../lib/session';

interface Role extends TagItem {}

interface User {
  id: string;
  login: string;
  fullName: string;
  isAdmin: boolean;
  active: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  role: Role | null;
}

interface Invite {
  id: string;
  hint: string;
  isAdmin: boolean;
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
const error = ref<string | null>(null);

const inviteAdmin = ref(false);
const inviteRole = ref('');
const inviteBusy = ref(false);
// Held only until the page is left: the server keeps a hash, so this is the one moment the link exists anywhere readable.
const freshLink = ref<string | null>(null);
const copied = ref(false);

const accessFor = ref<User | null>(null);
const denied = ref<string[]>([]);
const accessBusy = ref(false);

const boardsByProject = computed(() =>
  projects.value.filter((p) => p.boards.length).map((p) => ({ ...p, boards: p.boards }))
);

onMounted(async () => {
  try {
    await loadProjects();
    [users.value, invites.value, roles.value] = await Promise.all([
      api<User[]>('/users'),
      api<Invite[]>('/invites'),
      api<Role[]>('/roles'),
    ]);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not load the accounts.';
  } finally {
    loading.value = false;
  }
});

function report(err: unknown): void {
  error.value = err instanceof Error ? err.message : 'Something went wrong.';
}

function stamp(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso)
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase();
}

async function patchUser(u: User, body: Record<string, unknown>): Promise<void> {
  error.value = null;
  try {
    const updated = await api<User>(`/users/${u.id}`, { method: 'PATCH', body });
    users.value = users.value.map((row) => (row.id === u.id ? updated : row));
  } catch (err) {
    report(err);
  }
}

async function addRole(name: string): Promise<void> {
  error.value = null;
  try {
    roles.value = [...roles.value, await api<Role>('/roles', { method: 'POST', body: { name } })];
  } catch (err) {
    report(err);
  }
}

async function renameRole(role: TagItem, name: string): Promise<void> {
  error.value = null;
  try {
    const updated = await api<Role>(`/roles/${role.id}`, { method: 'PATCH', body: { name } });
    roles.value = roles.value.map((r) => (r.id === role.id ? updated : r));
    // Whoever wears it is holding the old name on this screen until it is read again.
    users.value = users.value.map((u) => (u.role?.id === role.id ? { ...u, role: updated } : u));
  } catch (err) {
    report(err);
  }
}

async function removeRole(): Promise<void> {
  const role = removingRole.value;
  if (!role) return;
  error.value = null;
  try {
    await api(`/roles/${role.id}`, { method: 'DELETE' });
    roles.value = roles.value.filter((r) => r.id !== role.id);
    users.value = users.value.map((u) => (u.role?.id === role.id ? { ...u, role: null } : u));
    removingRole.value = null;
  } catch (err) {
    report(err);
    removingRole.value = null;
  }
}

async function createInvite(): Promise<void> {
  if (inviteBusy.value) return;
  inviteBusy.value = true;
  error.value = null;
  copied.value = false;
  try {
    const created = await api<Invite & { token: string }>('/invites', {
      method: 'POST',
      body: { isAdmin: inviteAdmin.value, roleId: inviteRole.value || null },
    });
    const { token, ...row } = created;
    freshLink.value = `${location.origin}/join/${token}`;
    invites.value = [row, ...invites.value];
    inviteAdmin.value = false;
    inviteRole.value = '';
  } catch (err) {
    report(err);
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
  error.value = null;
  try {
    await api(`/invites/${i.id}`, { method: 'DELETE' });
    invites.value = invites.value.filter((row) => row.id !== i.id);
  } catch (err) {
    report(err);
  }
}

async function openAccess(u: User): Promise<void> {
  accessFor.value = u;
  denied.value = [];
  try {
    const res = await api<{ deniedBoards: string[] }>(`/users/${u.id}/access`);
    denied.value = res.deniedBoards;
  } catch (err) {
    report(err);
  }
}

function toggleBoard(boardId: string, allowed: boolean): void {
  denied.value = allowed
    ? denied.value.filter((id) => id !== boardId)
    : [...denied.value, boardId];
}

async function saveAccess(): Promise<void> {
  const u = accessFor.value;
  if (!u || accessBusy.value) return;
  accessBusy.value = true;
  error.value = null;
  try {
    await api(`/users/${u.id}/access`, { method: 'PUT', body: { deniedBoards: denied.value } });
    accessFor.value = null;
  } catch (err) {
    report(err);
  } finally {
    accessBusy.value = false;
  }
}
</script>

<template>
  <SettingsLayout>
    <div v-if="error" class="err sheet__wide">{{ error }}</div>

    <section class="panel sheet__wide">
      <header class="panel__h">Users</header>
      <div class="panel__table">
        <table class="tbl">
          <thead>
            <tr>
              <th>Person</th>
              <th class="c-role">Role</th>
              <th class="c-flag">Admin</th>
              <th class="c-flag">Active</th>
              <th class="c-when">Joined</th>
              <th class="c-when">Last seen</th>
              <th class="c-act"><span class="sr">Access</span></th>
            </tr>
          </thead>
          <tbody>
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
                    :checked="u.isAdmin"
                    :disabled="u.id === session.me.value?.id"
                    @change="patchUser(u, { isAdmin: ($event.target as HTMLInputElement).checked })"
                  />
                </label>
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
              <td class="c-act">
                <button class="btn btn--sm" type="button" @click="openAccess(u)">Access…</button>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-if="loading" class="empty empty--sm"><span class="empty__g">◇</span>Loading…</div>
      </div>
    </section>

    <section class="panel sheet__wide">
      <header class="panel__h">Roles</header>
      <div class="panel__b">
        <div v-if="!roles.length" class="empty empty--sm"><span class="empty__g">◇</span>None yet.</div>
        <TagLabels
          :tags="roles"
          add-placeholder="Add role…"
          @add="addRole"
          @rename="renameRole"
          @remove="removingRole = $event"
        />
      </div>
    </section>

    <section class="panel sheet__wide">
      <header class="panel__h">Invite links</header>
      <div class="panel__b">
        <div v-if="freshLink" class="field">
          <span class="label">The link — copy it now</span>
          <div class="link__row">
            <code class="input link__value">{{ freshLink }}</code>
            <button class="btn" type="button" @click="copyLink">{{ copied ? 'Copied' : 'Copy' }}</button>
          </div>
          <span class="hint">It is stored as a hash, so this is the only time it can be read.</span>
        </div>

        <div class="addrow">
          <select v-model="inviteRole" class="input invite__role">
            <option value="">No role</option>
            <option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>
          <label class="check">
            <input v-model="inviteAdmin" type="checkbox" />
            Admin
          </label>
          <div class="sp"></div>
          <button class="btn" type="button" :disabled="inviteBusy" @click="createInvite">
            Create link
          </button>
        </div>
      </div>

      <div v-if="invites.length" class="panel__table">
        <table class="tbl">
          <thead>
            <tr>
              <th>Link</th>
              <th class="c-role">Role</th>
              <th class="c-flag">Admin</th>
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
              <td>{{ i.isAdmin ? 'Yes' : '' }}</td>
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

    <Dialog
      v-if="removingRole"
      :title="`Delete ${removingRole.name}?`"
      @close="removingRole = null"
    >
      <p>Whoever wears it stops wearing one. This cannot be undone.</p>
      <template #footer>
        <div class="sp"></div>
        <button class="btn" type="button" @click="removingRole = null">Cancel</button>
        <button class="btn btn--danger" type="button" @click="removeRole">Delete</button>
      </template>
    </Dialog>

    <Dialog
      v-if="accessFor"
      :title="`Access — ${accessFor.fullName || accessFor.login}`"
      :width="420"
      @close="accessFor = null"
    >
      <p v-if="accessFor.isAdmin" class="hint">An admin opens every board.</p>
      <div v-for="p in boardsByProject" :key="p.id" class="access__group">
        <span class="label">{{ p.shortName }} {{ p.name }}</span>
        <label v-for="b in p.boards" :key="b.id" class="check access__row">
          <input
            type="checkbox"
            :checked="!denied.includes(b.id)"
            :disabled="accessFor.isAdmin"
            @change="toggleBoard(b.id, ($event.target as HTMLInputElement).checked)"
          />
          {{ b.name }}
        </label>
      </div>
      <div v-if="!boardsByProject.length" class="empty empty--sm">
        <span class="empty__g">◇</span>No boards yet.
      </div>

      <template #footer>
        <div class="sp"></div>
        <button class="btn" type="button" @click="accessFor = null">Cancel</button>
        <button
          class="btn btn--primary"
          type="button"
          :disabled="accessBusy || accessFor.isAdmin"
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
.c-act {
  width: 92px;
  text-align: right;
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
.access__row {
  font-size: 13px;
}
</style>
