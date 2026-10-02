<script setup lang="ts">
import { computed, ref } from 'vue';
import { api } from '../lib/api';
import { buddyAvatarStyle } from '../lib/avatar';
import { commentOrder, stamp, type CommentOrder } from '../lib/issues';
import { setWrapLines, wrapLines } from '../lib/files';
import { ink, setTheme, theme, type Theme } from '../lib/theme';
import { useNotices, type NoticeKind } from '../lib/notices';
import { usePanelErrors } from '../lib/panelErrors';
import { usePeople } from '../lib/people';
import { useSession, type Me } from '../lib/session';

const session = useSession();
const { errors, fail, clear } = usePanelErrors();
const { load: loadPeople } = usePeople();
const me = session.me;
const { off, toggleKind } = useNotices();

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

const THEMES: { value: Theme; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
];

const order = ref<CommentOrder>(commentOrder.get());
function setOrder(next: CommentOrder): void {
  order.value = next;
  commentOrder.set(next);
}

const KINDS: { kind: NoticeKind; label: string }[] = [
  { kind: 'mention', label: 'Mentions' },
  { kind: 'assigned', label: 'Assigned to you' },
  { kind: 'reaction', label: 'Reactions' },
  { kind: 'starred', label: 'Starred issues' },
];

const STARS: { key: keyof Me['autoStar']; body: string; label: string }[] = [
  { key: 'created', body: 'starCreated', label: 'Created by me' },
  { key: 'assigned', body: 'starAssigned', label: 'Assigned to me' },
  { key: 'commented', body: 'starCommented', label: 'Commented on' },
];

async function setAutoStar(body: string, on: boolean): Promise<void> {
  clear('prefs');
  try {
    const updated = await api<Me>('/me', { method: 'PATCH', body: { [body]: on } });
    me.value = { ...(me.value as Me), ...updated };
  } catch (err) {
    fail('prefs', err);
  }
}

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

  <section class="panel">
    <header class="panel__h">Preferences</header>
    <div class="panel__b form">
      <div class="pairs">
        <div class="field">
          <span class="label">Theme</span>
          <label v-for="t in THEMES" :key="t.value" class="flag">
            <input type="radio" name="theme" :checked="theme === t.value" @change="setTheme(t.value)" />
            {{ t.label }}
          </label>
        </div>
        <div class="field">
          <span class="label">Comments read</span>
          <label class="flag">
            <input
              type="radio"
              name="comment-order"
              :checked="order === 'oldest'"
              @change="setOrder('oldest')"
            />
            Oldest first
          </label>
          <label class="flag">
            <input
              type="radio"
              name="comment-order"
              :checked="order === 'newest'"
              @change="setOrder('newest')"
            />
            Newest first
          </label>
        </div>
      </div>
      <div class="pairs">
        <div class="field">
          <span class="label">Notices shown</span>
          <label v-for="k in KINDS" :key="k.kind" class="flag">
            <input
              type="checkbox"
              :checked="!off.includes(k.kind)"
              @change="toggleKind(k.kind)"
            />
            {{ k.label }}
          </label>
        </div>
        <div class="field">
          <span class="label">Files</span>
          <label class="flag">
            <input
              type="checkbox"
              :checked="wrapLines"
              @change="setWrapLines(($event.target as HTMLInputElement).checked)"
            />
            Wrap long lines
          </label>
        </div>
      </div>
      <div class="pairs">
        <div class="field">
          <span class="label">Star automatically</span>
          <label v-for="s in STARS" :key="s.key" class="flag">
            <input
              type="checkbox"
              :checked="me?.autoStar[s.key] ?? false"
              @change="setAutoStar(s.body, ($event.target as HTMLInputElement).checked)"
            />
            {{ s.label }}
          </label>
        </div>
      </div>
    </div>
  </section>
  <div v-if="errors.prefs" class="err panel__err">{{ errors.prefs }}</div>
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
.pairs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
  align-items: start;
}
.flag {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
</style>
