<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../lib/api';
import banner from '../assets/banner.png';

const route = useRoute();

const token = String(route.params.token ?? '');
const checking = ref(true);
const valid = ref(false);
const login = ref('');

const password = ref('');
const repeat = ref('');
const busy = ref(false);
const error = ref<string | null>(null);

const mismatch = computed(() => repeat.value.length > 0 && repeat.value !== password.value);
const canSubmit = computed(() => password.value.length >= 8 && !mismatch.value && !busy.value);

onMounted(async () => {
  try {
    const found = await api<{ kind: 'invite' | 'reset'; login: string | null }>(
      `/invites/${encodeURIComponent(token)}/check`
    );
    if (found.kind !== 'reset' || !found.login) throw new Error('This link is no longer valid.');
    login.value = found.login;
    valid.value = true;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'This link is no longer valid.';
  } finally {
    checking.value = false;
  }
});

async function onSubmit(): Promise<void> {
  if (!canSubmit.value) return;
  busy.value = true;
  error.value = null;
  try {
    await api(`/invites/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
      body: { password: password.value },
    });
    window.location.assign('/');
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'This link is no longer valid.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="signin">
    <img class="signin__banner" :src="banner" alt="" width="462" height="174" />

    <section class="panel signin__panel" aria-labelledby="reset-title">
      <header id="reset-title" class="panel__h">New password</header>

      <div v-if="checking" class="panel__b signin__form">
        <span class="sk field-sk"></span>
        <span class="sk field-sk"></span>
      </div>

      <div v-else-if="!valid" class="panel__b signin__form">
        <div class="signin__err" role="alert">{{ error }}</div>
        <RouterLink class="btn signin__submit" to="/login">Sign in</RouterLink>
      </div>

      <form v-else class="panel__b signin__form" @submit.prevent="onSubmit">
        <div v-if="error" class="signin__err" role="alert">{{ error }}</div>
        <div class="field">
          <label class="label" for="reset-login">Login</label>
          <input id="reset-login" class="input" :value="login" autocomplete="username" readonly />
        </div>
        <div class="field">
          <label class="label" for="reset-password">New password</label>
          <input
            id="reset-password"
            v-model="password"
            class="input"
            type="password"
            autocomplete="new-password"
            autofocus
          />
          <span class="hint">At least 8 characters.</span>
        </div>
        <div class="field">
          <label class="label" for="reset-repeat">Repeat new password</label>
          <input
            id="reset-repeat"
            v-model="repeat"
            class="input"
            type="password"
            autocomplete="new-password"
          />
          <span v-if="mismatch" class="err">The two do not match.</span>
        </div>
        <button class="btn btn--primary signin__submit" type="submit" :disabled="!canSubmit">
          Set password
        </button>
      </form>
    </section>
  </div>
</template>
