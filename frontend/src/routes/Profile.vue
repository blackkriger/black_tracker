<script setup lang="ts">
import { computed, ref } from 'vue';
import TopBar from '../components/TopBar.vue';
import { api } from '../lib/api';
import { buddyAvatarStyle } from '../lib/avatar';
import { useSession, type Me } from '../lib/session';

const session = useSession();
const me = session.me;

const fullName = ref(me.value?.fullName ?? '');
const nameBusy = ref(false);
const nameSaved = ref(false);
const nameError = ref<string | null>(null);

const currentPassword = ref('');
const newPassword = ref('');
const repeatPassword = ref('');
const passwordBusy = ref(false);
const passwordDone = ref(false);
const passwordError = ref<string | null>(null);

const tokenBusy = ref(false);
// Held only until the page is left: the server keeps a hash, so this is the one moment the value exists anywhere readable.
const freshToken = ref<string | null>(null);
const copied = ref(false);
const tokenError = ref<string | null>(null);

const mismatch = computed(
  () => repeatPassword.value.length > 0 && repeatPassword.value !== newPassword.value
);
const canChangePassword = computed(
  () =>
    currentPassword.value.length > 0 &&
    newPassword.value.length >= 8 &&
    !mismatch.value &&
    !passwordBusy.value
);

const since = computed(() => stamp(me.value?.createdAt ?? null));
const tokenCreated = computed(() => stamp(me.value?.token?.createdAt ?? null));
const tokenUsed = computed(() => stamp(me.value?.token?.lastUsedAt ?? null));

function stamp(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso)
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase();
}

async function saveName(): Promise<void> {
  if (nameBusy.value) return;
  nameBusy.value = true;
  nameError.value = null;
  nameSaved.value = false;
  try {
    const updated = await api<Me>('/me', { method: 'PATCH', body: { fullName: fullName.value } });
    me.value = { ...(me.value as Me), ...updated };
    nameSaved.value = true;
  } catch (err) {
    nameError.value = err instanceof Error ? err.message : 'Could not save the name.';
  } finally {
    nameBusy.value = false;
  }
}

async function changePassword(): Promise<void> {
  if (!canChangePassword.value) return;
  passwordBusy.value = true;
  passwordError.value = null;
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
    passwordError.value = err instanceof Error ? err.message : 'Could not change the password.';
  } finally {
    passwordBusy.value = false;
  }
}

async function regenerate(): Promise<void> {
  if (tokenBusy.value) return;
  tokenBusy.value = true;
  tokenError.value = null;
  copied.value = false;
  try {
    const res = await api<{ token: string }>('/me/regenerate-token', { method: 'POST' });
    freshToken.value = res.token;
    await session.refresh();
  } catch (err) {
    tokenError.value = err instanceof Error ? err.message : 'Could not issue a token.';
  } finally {
    tokenBusy.value = false;
  }
}

async function revoke(): Promise<void> {
  if (tokenBusy.value) return;
  tokenBusy.value = true;
  tokenError.value = null;
  try {
    await api('/me/token', { method: 'DELETE' });
    freshToken.value = null;
    await session.refresh();
  } catch (err) {
    tokenError.value = err instanceof Error ? err.message : 'Could not revoke the token.';
  } finally {
    tokenBusy.value = false;
  }
}

async function copyToken(): Promise<void> {
  if (!freshToken.value) return;
  try {
    await navigator.clipboard.writeText(freshToken.value);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}
</script>

<template>
  <div class="page">
    <TopBar />

    <div class="page__body">
      <div class="grid">
        <div class="stack">
          <section class="panel">
            <header class="panel__h">Profile</header>
            <form class="panel__b form" @submit.prevent="saveName">
              <div class="who">
                <span class="av av--xl" :style="buddyAvatarStyle(me?.login ?? '')"></span>
                <div class="who__lines">
                  <span class="who__login">{{ me?.login }}</span>
                  <span class="stamp">SINCE {{ since }}</span>
                </div>
              </div>
              <div class="field">
                <label class="label" for="fullname">Display name</label>
                <!-- Empty is fine: the placeholder shows the login, which is what stands in for a missing name everywhere. -->
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
                <input id="login" class="input" :value="me?.login" readonly />
              </div>
              <div v-if="nameError" class="err">{{ nameError }}</div>
              <div class="row-end">
                <span v-if="nameSaved" class="hint">Saved.</span>
                <button class="btn btn--primary" type="submit" :disabled="nameBusy">Save</button>
              </div>
            </form>
          </section>

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
              <div v-if="passwordError" class="err">{{ passwordError }}</div>
              <div class="row-end">
                <span v-if="passwordDone" class="hint">Password changed.</span>
                <button class="btn btn--primary" type="submit" :disabled="!canChangePassword">
                  Change password
                </button>
              </div>
            </form>
          </section>
        </div>

        <section class="panel">
          <header class="panel__h">API token</header>
          <div class="panel__b form">
            <p class="token__lede">
              Personal token for scripts and API use. Whatever it does is recorded as
              <strong>your</strong> action, marked <span class="api">API</span> in history.
            </p>

            <div v-if="freshToken" class="field">
              <span class="label">Your new token — copy it now</span>
              <div class="token__row">
                <code class="input token__value">{{ freshToken }}</code>
                <button class="btn" type="button" @click="copyToken">{{ copied ? 'Copied' : 'Copy' }}</button>
              </div>
              <span class="hint">It is stored as a hash, so this is the only time it can be read.</span>
            </div>

            <div v-else-if="me?.token" class="field">
              <span class="label">Token</span>
              <code class="input token__value">trk_••••••••••••{{ me.token.hint }}</code>
              <span class="stamp">
                CREATED {{ tokenCreated }}<template v-if="tokenUsed">, LAST USED {{ tokenUsed }}</template>
                <template v-else>, NEVER USED</template>
              </span>
            </div>

            <div v-else class="empty empty--sm">
              <span class="empty__g">◇</span>
              No token yet.
            </div>

            <div class="token__can">
              <span class="label token__can-h">What the token can do</span>
              <ul class="token__list">
                <li><span class="token__yes">✓</span>Create issues, change status, priority, assignee, tags</li>
                <li><span class="token__no">✕</span>Post or edit comments</li>
              </ul>
            </div>

            <div v-if="tokenError" class="err">{{ tokenError }}</div>

            <div class="token__foot">
              <div class="sp"></div>
              <button v-if="me?.token" class="btn btn--danger" type="button" :disabled="tokenBusy" @click="revoke">
                Revoke
              </button>
              <button class="btn" type="button" :disabled="tokenBusy" @click="regenerate">
                {{ me?.token ? 'Regenerate' : 'Create token' }}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.page__body {
  padding: var(--space-6) var(--space-5);
}
.grid {
  width: 960px;
  max-width: 100%;
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-5);
  align-items: start;
}
@media (max-width: 880px) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
/* Named apart from the board's `.col`, which carries a surface background — reusing that name painted the gap between the panels. */
.stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  min-width: 0;
}
.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
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
.who__login {
  font-weight: 700;
}
.row-end {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-3);
}
/* The confirmation belongs at the start of the row, not crowding the button it reports on. */
.row-end .hint {
  margin-right: auto;
}
.token__lede {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-dim);
}
.token__lede strong {
  color: var(--text);
}
.token__row {
  display: flex;
  gap: 6px;
}
.token__value {
  display: flex;
  align-items: center;
  font-family: var(--font-mono);
  font-size: 12.5px;
  letter-spacing: 0.04em;
  color: var(--accent-bright);
  overflow-x: auto;
  white-space: nowrap;
}
.token__can {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--line-2);
  background: rgba(0, 0, 0, 0.3);
}
.token__can-h {
  color: var(--accent);
}
.token__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  font-size: 13px;
}
.token__list li {
  display: flex;
  gap: 10px;
}
.token__yes,
.token__no {
  width: 14px;
  flex: none;
  font-family: var(--font-num);
}
.token__yes {
  color: #8effa9;
}
.token__no {
  color: var(--danger-text);
}
.token__foot {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--line);
}
</style>
