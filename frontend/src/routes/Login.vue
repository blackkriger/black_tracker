<script setup lang="ts">
import { ref } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useSession } from '../lib/session';
import banner from '../assets/banner.png';

const { t } = useI18n();
const login = ref('');
const password = ref('');
const error = ref<string | null>(null);
const busy = ref(false);

const session = useSession();
const route = useRoute();

async function onSubmit(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    await session.signIn(login.value.trim(), password.value);
    const next = route.query.next;
    const target =
      typeof next === 'string' && next.startsWith('/') && !next.startsWith('/login') ? next : '/';
    window.location.assign(target);
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('auth.signInFailed');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="signin">
    <img class="signin__banner" :src="banner" alt="" width="462" height="174" />

    <section class="panel signin__panel" aria-labelledby="signin-title">
      <header class="panel__h" id="signin-title">{{ t('auth.signIn') }}</header>
      <form class="panel__b signin__form" @submit.prevent="onSubmit">
        <div v-if="error" class="signin__err" role="alert">{{ error }}</div>
        <div class="field">
          <label class="label" for="login">{{ t('auth.login') }}</label>
          <input id="login" v-model="login" class="input" autocomplete="username" autofocus />
        </div>
        <div class="field">
          <label class="label" for="password">{{ t('auth.password') }}</label>
          <input
            id="password"
            v-model="password"
            class="input"
            type="password"
            autocomplete="current-password"
          />
        </div>
        <button class="btn btn--primary signin__submit" type="submit" :disabled="busy">
          {{ busy ? t('auth.signingIn') : t('auth.signIn') }}
        </button>
      </form>
    </section>

  </div>
</template>
