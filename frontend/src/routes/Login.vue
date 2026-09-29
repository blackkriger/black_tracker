<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSession } from '../lib/session';
import banner from '../assets/banner.png';

const login = ref('');
const password = ref('');
const error = ref<string | null>(null);
const busy = ref(false);

const session = useSession();
const router = useRouter();
const route = useRoute();

async function onSubmit(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    await session.signIn(login.value.trim(), password.value);
    // Back to where they were headed, or to the root, which decides which board to open.
    const next = route.query.next;
    const target =
      typeof next === 'string' && next.startsWith('/') && !next.startsWith('/login') ? next : '/';
    await router.replace(target);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not sign in.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="signin">
    <img class="signin__banner" :src="banner" alt="" width="462" height="174" />

    <section class="panel signin__panel" aria-labelledby="signin-title">
      <header class="panel__h" id="signin-title">Sign in</header>
      <form class="panel__b signin__form" @submit.prevent="onSubmit">
        <div v-if="error" class="signin__err" role="alert">{{ error }}</div>
        <div class="field">
          <label class="label" for="login">Login</label>
          <input id="login" v-model="login" class="input" autocomplete="username" autofocus />
        </div>
        <div class="field">
          <label class="label" for="password">Password</label>
          <input
            id="password"
            v-model="password"
            class="input"
            type="password"
            autocomplete="current-password"
          />
        </div>
        <button class="btn btn--primary signin__submit" type="submit" :disabled="busy">
          {{ busy ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
    </section>

  </div>
</template>

<style scoped>
.signin {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-6);
  padding: var(--space-5);
}
.signin__banner {
  display: block;
  width: 462px;
  max-width: 100%;
  height: auto;
}
.signin__panel {
  width: 360px;
  max-width: 100%;
}
.signin__form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.signin__err {
  padding: 10px 12px;
  background: rgba(255, 80, 102, 0.08);
  border: 1px solid rgba(255, 80, 102, 0.35);
  color: var(--danger-text);
  font-size: 12.5px;
}
.signin__submit {
  height: 38px;
  margin-top: var(--space-1);
}
</style>
