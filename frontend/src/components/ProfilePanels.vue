<script setup lang="ts">
// Who you are here: the name the tracker calls you and the password behind it in one
// column, the handful of choices the tracker keeps for you in the other. Everything the API
// side of the account needs lives in ApiPanels instead.
import { computed, ref } from 'vue';
import { api } from '../lib/api';
import { buddyAvatarStyle } from '../lib/avatar';
import { commentOrder, stamp, type CommentOrder } from '../lib/issues';
import { setWrapLines, wrapLines } from '../lib/files';
import { setTheme, theme, type Theme } from '../lib/theme';
import { useNotices, type NoticeKind } from '../lib/notices';
import { useSession, type Me } from '../lib/session';
import { ink } from '../lib/theme';

const session = useSession();
const me = session.me;
const { off, toggleKind } = useNotices();

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
const role = computed(() => me.value?.role ?? null);

// ── what the tracker remembers about how you like to read it ──
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
];

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
</script>

<template>
  <div class="stack">
    <section class="panel">
      <header class="panel__h">Profile</header>
      <form class="panel__b form" @submit.prevent="saveName">
        <div class="who">
          <span class="av av--xl" :style="buddyAvatarStyle(me?.login ?? '')"></span>
          <div class="who__lines">
            <!-- The name and the login are both in the fields below, so this line carries the role; with no role it is the date alone. -->
            <span v-if="role" class="who__role" :style="{ color: ink(role.color) }">{{ role.name }}</span>
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
          <input id="login" class="input" :value="me?.login" tabindex="-1" readonly />
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
    </div>
  </section>
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
/* The confirmation belongs at the start of the row, not crowding the button it reports on. */
.row-end .hint {
  margin-right: auto;
}
/* Two groups of switches side by side, each under its own label. */
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
