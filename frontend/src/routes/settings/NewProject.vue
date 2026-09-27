<script setup lang="ts">
// A project starts empty: its boards are added from the project's own settings, each with the starting four statuses.
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import SettingsLayout from '../../components/SettingsLayout.vue';
import { api } from '../../lib/api';
import { useProjects } from '../../lib/projects';

const router = useRouter();
const projects = useProjects();

const shortName = ref('');
const name = ref('');
const busy = ref(false);
const error = ref<string | null>(null);

const keyLooksRight = computed(() => /^[A-Z][A-Z0-9]*$/.test(shortName.value.trim()));
const canCreate = computed(() => keyLooksRight.value && name.value.trim().length > 0 && !busy.value);

async function create(): Promise<void> {
  if (!canCreate.value) return;
  busy.value = true;
  error.value = null;
  try {
    const created = await api<{ shortName: string }>('/projects', {
      method: 'POST',
      body: { shortName: shortName.value.trim(), name: name.value.trim() },
    });
    await projects.load(true);
    await router.push(`/settings/${created.shortName}`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not create the project.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <SettingsLayout>
    <section class="panel sheet__wide">
      <header class="panel__h">New project</header>
      <form class="panel__b form" @submit.prevent="create">
        <div class="field">
          <label class="label" for="key">Key</label>
          <input
            id="key"
            v-model="shortName"
            class="input"
            maxlength="20"
            placeholder="PROJ"
            @input="shortName = shortName.toUpperCase()"
          />
          <span class="hint">Upper-case letters and digits.</span>
        </div>
        <div class="field">
          <label class="label" for="name">Name</label>
          <input id="name" v-model="name" class="input" maxlength="200" placeholder="Project" />
        </div>
        <div v-if="error" class="err">{{ error }}</div>
        <div class="row-end">
          <button class="btn btn--primary" type="submit" :disabled="!canCreate">Create project</button>
        </div>
      </form>
    </section>
  </SettingsLayout>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.row-end {
  display: flex;
  justify-content: flex-end;
}
</style>
