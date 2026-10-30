<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ApiError, api } from '../lib/api';
import { useTitle } from '../lib/title';
import { messageOf } from '../lib/panelErrors';
import { PASSWORD_MIN } from '../../../shared/rules';

const { t } = useI18n();
useTitle(() => t('auth.createAccount'));
const route = useRoute();

const token = String(route.params.token ?? '');
const checking = ref(true);
const valid = ref(false);
const role = ref<{ name: string; color: string } | null>(null);

const login = ref('');
const password = ref('');
const repeat = ref('');
const busy = ref(false);
const error = ref<string | null>(null);
const loginError = ref<string | null>(null);
watch(login, () => (loginError.value = null));

const mismatch = computed(() => repeat.value.length > 0 && repeat.value !== password.value);
const canSubmit = computed(
  () =>
    login.value.trim().length >= 2 &&
    password.value.length >= PASSWORD_MIN &&
    repeat.value === password.value &&
    !busy.value
);

onMounted(async () => {
  try {
    const invite = await api<{
      kind: 'invite' | 'reset';
      role: { name: string; color: string } | null;
    }>(`/invites/${encodeURIComponent(token)}/check`);
    if (invite.kind !== 'invite') throw new Error(t('auth.inviteGone'));
    role.value = invite.role;
    valid.value = true;
  } catch (err) {
    error.value = messageOf(err, t('auth.inviteGone'));
  } finally {
    checking.value = false;
  }
});

async function onSubmit(): Promise<void> {
  if (!canSubmit.value) return;
  busy.value = true;
  error.value = null;
  loginError.value = null;
  try {
    await api(`/invites/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
      body: { login: login.value.trim(), password: password.value },
    });
    window.location.assign('/');
  } catch (err) {
    const message = messageOf(err, t('auth.createFailed'));
    if (err instanceof ApiError && (err.status === 409 || /login/i.test(message))) {
      loginError.value = message;
    } else {
      error.value = message;
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="signin">
    <section class="panel signin__panel" aria-labelledby="join-title">
      <header id="join-title" class="panel__h">
        {{ t('auth.createAccount') }}
        <span v-if="checking || role" class="panel__end">
          <span v-if="checking" class="sk sk--line join__role-sk"></span>
          <span v-else-if="role" class="taglabel taglabel--plain" :style="{ '--c': role.color }">
            {{ role.name }}
          </span>
        </span>
      </header>

      <div v-if="checking" class="panel__b signin__form">
        <span class="sk field-sk"></span>
        <span class="sk field-sk"></span>
      </div>

      <div v-else-if="!valid" class="panel__b signin__form">
        <div class="signin__err" role="alert">{{ error }}</div>
        <RouterLink class="btn signin__submit" to="/login">{{ t('auth.signIn') }}</RouterLink>
      </div>

      <form v-else class="panel__b signin__form" @submit.prevent="onSubmit">
        <div v-if="error" class="signin__err" role="alert">{{ error }}</div>
        <div class="field">
          <label class="label" for="join-login">{{ t('auth.login') }}</label>
          <input
            id="join-login"
            v-model="login"
            class="input"
            autocomplete="username"
            maxlength="32"
            autofocus
          />
          <span v-if="loginError" class="err">{{ loginError }}</span>
        </div>
        <div class="field">
          <label class="label" for="join-password">{{ t('auth.password') }}</label>
          <input
            id="join-password"
            v-model="password"
            class="input"
            type="password"
            autocomplete="new-password"
          />
          <span class="hint">{{ t('auth.atLeast8') }}</span>
        </div>
        <div class="field">
          <label class="label" for="join-repeat">{{ t('auth.repeatPassword') }}</label>
          <input
            id="join-repeat"
            v-model="repeat"
            class="input"
            type="password"
            autocomplete="new-password"
          />
          <span v-if="mismatch" class="err">{{ t('auth.mismatch') }}</span>
        </div>
        <button class="btn btn--primary signin__submit" type="submit" :disabled="!canSubmit">
          {{ busy ? t('auth.creating') : t('auth.createAccount') }}
        </button>
      </form>
    </section>
  </div>
</template>

<style scoped>
.join__role-sk {
  width: 72px;
  height: 24px;
}
</style>
