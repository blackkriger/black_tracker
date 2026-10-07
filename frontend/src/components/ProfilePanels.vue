<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../lib/api';
import { useLive } from '../lib/live';
import { buddyAvatarStyle } from '../lib/avatar';
import { stamp } from '../lib/issues';
import { ink } from '../lib/theme';
import { usePanelErrors } from '../lib/panelErrors';
import { usePeople } from '../lib/people';
import { useSession, type Me, type Messenger } from '../lib/session';
import { describeAgent } from '../lib/userAgent';

interface Session {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  current: boolean;
}

const session = useSession();
const { errors, fail, clear } = usePanelErrors();
const { load: loadPeople } = usePeople();
const me = session.me;

const fullName = ref(me.value?.fullName ?? '');
const nameBusy = ref(false);
const nameSaved = ref(false);

const currentPassword = ref('');
const newPassword = ref('');
const repeatPassword = ref('');
const passwordBusy = ref(false);
const passwordDone = ref(false);

const mismatch = computed(
  () => repeatPassword.value.length > 0 && repeatPassword.value !== newPassword.value
);
const canChangePassword = computed(
  () =>
    currentPassword.value.length > 0 &&
    newPassword.value.length >= 8 &&
    repeatPassword.value === newPassword.value &&
    !passwordBusy.value
);

const sessions = ref<Session[] | null>(null);
const sessionBusy = ref(false);
const others = computed(() => sessions.value?.some((s) => !s.current) ?? false);

const github = ref(me.value?.githubLogin ?? '');
const githubBusy = ref(false);
const githubSaved = ref(false);
const messengerBusy = ref(false);
const MESSENGERS: { key: Messenger; title: string }[] = [
  { key: 'telegram', title: 'Telegram' },
  { key: 'vk', title: 'VK' },
];
const messengers = computed(() => MESSENGERS.filter((m) => me.value?.messengers[m.key].ready));

const since = computed(() => stamp(me.value?.createdAt ?? null));
const role = computed(() => me.value?.role ?? null);

async function saveName(): Promise<void> {
  if (nameBusy.value) return;
  nameBusy.value = true;
  clear('name');
  nameSaved.value = false;
  try {
    const updated = await api<Me>('/me', { method: 'PATCH', body: { fullName: fullName.value } });
    me.value = { ...(me.value as Me), ...updated };
    nameSaved.value = true;
    void loadPeople(true);
  } catch (err) {
    fail('name', err, 'Could not save the name.');
  } finally {
    nameBusy.value = false;
  }
}

async function readSessions(): Promise<void> {
  try {
    sessions.value = await api<Session[]>('/me/sessions');
  } catch (err) {
    sessions.value = [];
    fail('sessions', err, 'Could not read the sessions.');
  }
}

async function endSessions(body: { id: string } | { others: true }): Promise<void> {
  if (sessionBusy.value) return;
  sessionBusy.value = true;
  clear('sessions');
  try {
    await api('/me/sessions', { method: 'DELETE', body });
    await readSessions();
  } catch (err) {
    fail('sessions', err, 'Could not sign the session out.');
  } finally {
    sessionBusy.value = false;
  }
}

async function saveGithub(): Promise<void> {
  if (githubBusy.value) return;
  githubBusy.value = true;
  clear('integrations');
  githubSaved.value = false;
  try {
    const updated = await api<Me>('/me', { method: 'PATCH', body: { githubLogin: github.value } });
    me.value = { ...(me.value as Me), ...updated };
    github.value = updated.githubLogin ?? '';
    githubSaved.value = true;
  } catch (err) {
    fail('integrations', err, 'Could not save the GitHub login.');
  } finally {
    githubBusy.value = false;
  }
}

async function linkMessenger(channel: Messenger): Promise<void> {
  if (messengerBusy.value) return;
  messengerBusy.value = true;
  clear('integrations');
  const tab = window.open('', '_blank');
  try {
    const { url } = await api<{ url: string }>(`/me/${channel}/link`, { method: 'POST' });
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else {
      window.location.href = url;
    }
  } catch (err) {
    tab?.close();
    fail('integrations', err);
  } finally {
    messengerBusy.value = false;
  }
}

async function unlinkMessenger(channel: Messenger): Promise<void> {
  if (messengerBusy.value) return;
  messengerBusy.value = true;
  clear('integrations');
  try {
    await api(`/me/${channel}`, { method: 'DELETE' });
    const now = me.value as Me;
    me.value = { ...now, messengers: { ...now.messengers, [channel]: { ...now.messengers[channel], name: null } } };
  } catch (err) {
    fail('integrations', err);
  } finally {
    messengerBusy.value = false;
  }
}

async function readMe(): Promise<void> {
  try {
    me.value = await api<Me>('/me');
  } catch {}
}

onMounted(() => void readSessions());
useLive(
  (ev) => {
    if (ev.type !== 'session.changed') return;
    void readSessions();
    void readMe();
  },
  () => {
    void readSessions();
    void readMe();
  }
);

async function changePassword(): Promise<void> {
  if (!canChangePassword.value) return;
  passwordBusy.value = true;
  clear('password');
  passwordDone.value = false;
  try {
    await api('/me/password', {
      method: 'POST',
      body: { currentPassword: currentPassword.value, newPassword: newPassword.value },
    });
    currentPassword.value = '';
    newPassword.value = '';
    repeatPassword.value = '';
    passwordDone.value = true;
  } catch (err) {
    fail('password', err, 'Could not change the password.');
  } finally {
    passwordBusy.value = false;
  }
}
</script>

<template>
  <div class="stack">
    <section class="panel">
      <header class="panel__h">Profile</header>
      <form class="panel__b form" @submit.prevent="saveName">
        <div class="who">
          <span class="av av--xl" :style="buddyAvatarStyle(me?.login ?? '')"></span>
          <div class="who__lines">
            <span v-if="role" class="who__role" :style="{ color: ink(role.color) }">{{ role.name }}</span>
            <span class="stamp">SINCE {{ since }}</span>
          </div>
        </div>
        <div class="field">
          <label class="label" for="fullname">Display name</label>
          <input
            id="fullname"
            v-model="fullName"
            class="input"
            maxlength="120"
            :placeholder="me?.login"
          />
        </div>
        <div class="field">
          <label class="label" for="login">Login</label>
          <input id="login" class="input" :value="me?.login" tabindex="-1" readonly />
        </div>
        <div class="row-end">
          <span v-if="nameSaved" class="hint">Saved.</span>
          <button class="btn btn--primary" type="submit" :disabled="nameBusy">Save</button>
        </div>
      </form>
    </section>
    <div v-if="errors.name" class="err panel__err">{{ errors.name }}</div>

    <section class="panel">
      <header class="panel__h">Password</header>
      <form class="panel__b form" @submit.prevent="changePassword">
        <div class="field">
          <label class="label" for="pw0">Current password</label>
          <input id="pw0" v-model="currentPassword" class="input" type="password" autocomplete="current-password" />
        </div>
        <div class="field">
          <label class="label" for="pw1">New password</label>
          <input id="pw1" v-model="newPassword" class="input" type="password" autocomplete="new-password" />
          <span class="hint">At least 8 characters.</span>
        </div>
        <div class="field">
          <label class="label" for="pw2">Repeat new password</label>
          <input
            id="pw2"
            v-model="repeatPassword"
            class="input"
            :class="{ 'is-error': mismatch }"
            type="password"
            autocomplete="new-password"
          />
          <span v-if="mismatch" class="err">Doesn't match the new password.</span>
        </div>
        <div class="row-end">
          <span v-if="passwordDone" class="hint">Password changed.</span>
          <button class="btn btn--primary" type="submit" :disabled="!canChangePassword">
            Change password
          </button>
        </div>
      </form>
    </section>
    <div v-if="errors.password" class="err panel__err">{{ errors.password }}</div>
  </div>

  <div class="stack">
    <section class="panel">
      <header class="panel__h">Integrations</header>
      <div class="panel__b form">
        <form class="form" @submit.prevent="saveGithub">
          <div class="field">
            <label class="label" for="github">GitHub login</label>
            <input
              id="github"
              v-model="github"
              class="input"
              maxlength="200"
              autocomplete="off"
              spellcheck="false"
            />
            <span class="hint">The name in github.com/name, so your commits show up under your name.</span>
          </div>
          <div class="row-end">
            <span v-if="githubSaved" class="hint">Saved.</span>
            <button class="btn btn--primary" type="submit" :disabled="githubBusy">Save</button>
          </div>
        </form>
        <template v-for="m in messengers" :key="m.key">
          <div class="hr"></div>
          <div class="field">
            <label class="label" :for="m.key">{{ m.title }}</label>
            <div class="addrow messenger">
              <input
                :id="m.key"
                class="input"
                :value="me?.messengers[m.key].name ?? ''"
                placeholder="Not linked"
                tabindex="-1"
                readonly
              />
              <button
                v-if="me?.messengers[m.key].name !== null"
                class="btn btn--danger"
                type="button"
                :disabled="messengerBusy"
                @click="unlinkMessenger(m.key)"
              >
                Unlink
              </button>
              <button
                v-else
                class="btn btn--primary"
                type="button"
                :disabled="messengerBusy"
                @click="linkMessenger(m.key)"
              >
                Link
              </button>
            </div>
          </div>
        </template>
      </div>
    </section>
    <div v-if="errors.integrations" class="err panel__err">{{ errors.integrations }}</div>

    <section class="panel">
      <header class="panel__h">Sessions</header>
      <div class="panel__b form">
        <ul class="sess">
          <template v-if="!sessions">
            <li v-for="n in 2" :key="n" class="sess__i">
              <span class="sess__lines">
                <span class="sk sk--line" style="width: 120px"></span>
                <span class="sk sk--line" style="width: 220px"></span>
              </span>
            </li>
          </template>
          <li v-for="s in sessions" :key="s.id" class="sess__i">
            <span class="sess__lines">
              <span class="sess__what">{{ describeAgent(s.userAgent) }}</span>
              <span class="stamp">
                SIGNED IN {{ stamp(s.createdAt) }}<template v-if="s.lastSeenAt">, ACTIVE {{ stamp(s.lastSeenAt) }}</template>
              </span>
            </span>
            <span v-if="s.current" class="hint">This device</span>
            <button
              v-else
              class="btn btn--sm btn--danger"
              type="button"
              :disabled="sessionBusy"
              @click="endSessions({ id: s.id })"
            >
              Sign out
            </button>
          </li>
        </ul>
        <div v-if="others" class="row-end">
          <button class="btn btn--danger" type="button" :disabled="sessionBusy" @click="endSessions({ others: true })">
            Sign out other sessions
          </button>
        </div>
      </div>
    </section>
    <div v-if="errors.sessions" class="err panel__err">{{ errors.sessions }}</div>
  </div>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.messenger {
  margin-top: 0;
}
.who {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.av--xl {
  width: 48px;
  height: 48px;
  font-size: 21px;
}
.who__lines {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.who__role {
  font-weight: 700;
  letter-spacing: 0.04em;
}
.row-end {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
}
.row-end .hint {
  margin-right: auto;
}
.sess {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}
.sess__i {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 10px 0;
  border-top: 1px solid var(--line);
}
.sess__i:first-child {
  padding-top: 0;
  border-top: 0;
}
.sess__lines {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.sess__what {
  color: var(--text);
  font-size: 13px;
}
.sess__i .hint {
  flex: none;
  white-space: nowrap;
}
</style>
