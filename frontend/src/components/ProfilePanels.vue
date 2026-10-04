<script setup lang="ts">
import { computed, ref } from 'vue';
import { api } from '../lib/api';
import { buddyAvatarStyle } from '../lib/avatar';
import { stamp } from '../lib/issues';
import { ink } from '../lib/theme';
import { usePanelErrors } from '../lib/panelErrors';
import { usePeople } from '../lib/people';
import { useSession, type Me } from '../lib/session';

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
  </div>

  <div class="stack">
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
</template>

<style scoped>
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
</style>
