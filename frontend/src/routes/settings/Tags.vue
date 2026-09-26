<script setup lang="ts">
// Tags by where they live: the global ones first, then one container per project. The container title is the scope, so no row has to spell it out.
import { computed, onMounted, ref } from 'vue';
import SettingsLayout from '../../components/SettingsLayout.vue';
import TagLabels, { type TagItem } from '../../components/TagLabels.vue';
import { api } from '../../lib/api';
import { useLive } from '../../lib/live';
import { usePanelErrors } from '../../lib/panelErrors';
import { useSession } from '../../lib/session';
import { useProjects } from '../../lib/projects';

interface Tag extends TagItem {
  projectId: string | null;
  /** The server folded this name into one tag usable everywhere, because it already lived on another project. */
  merged?: boolean;
}

const { projects, load: loadProjects } = useProjects();
const { canDelete } = useSession();

const tags = ref<Tag[]>([]);
const loading = ref(true);
// Keyed by the container the action happened in: 'global', or the project's id.
const { errors, fail, clear } = usePanelErrors();
const notices = ref<Record<string, string | null>>({});

function note(scope: string, text: string | null): void {
  notices.value = { ...notices.value, [scope]: text };
}

async function reload(): Promise<void> {
  tags.value = await api<Tag[]>('/tags');
}

useLive((ev) => {
  if (['tag.changed', 'project.changed'].includes(ev.type)) void reload().catch(() => {});
});

const globalTags = computed(() => tags.value.filter((t) => t.projectId === null));
const tagsOf = (projectId: string) => tags.value.filter((t) => t.projectId === projectId);

onMounted(async () => {
  try {
    await loadProjects();
    tags.value = await api<Tag[]>('/tags');
  } catch (err) {
    fail('global', err, 'Could not load tags.');
  } finally {
    loading.value = false;
  }
});

async function add(scope: string, name: string, project?: string): Promise<void> {
  clear(scope);
  note(scope, null);
  try {
    const created = await api<Tag>('/tags', {
      method: 'POST',
      body: project ? { name, project } : { name },
    });
    // A merge moves rows around — one tag becomes global and its twins are gone — so the list is read again rather than patched.
    if (created.merged) {
      note(
        scope,
        `${created.name} already existed on another project, so it is one tag now, usable everywhere.`
      );
      await reload();
      return;
    }
    tags.value = [...tags.value, created];
  } catch (err) {
    fail(scope, err);
  }
}

async function rename(scope: string, tag: TagItem, name: string): Promise<void> {
  clear(scope);
  note(scope, null);
  try {
    const updated = await api<Tag>(`/tags/${tag.id}`, { method: 'PATCH', body: { name } });
    if (updated.merged) {
      note(
        scope,
        `${updated.name} already existed on another project, so it is one tag now, usable everywhere.`
      );
      await reload();
      return;
    }
    tags.value = tags.value.map((row) => (row.id === tag.id ? updated : row));
  } catch (err) {
    fail(scope, err);
  }
}

async function remove(scope: string, tag: TagItem): Promise<void> {
  clear(scope);
  try {
    await api(`/tags/${tag.id}`, { method: 'DELETE' });
    tags.value = tags.value.filter((row) => row.id !== tag.id);
  } catch (err) {
    fail(scope, err);
  }
}
</script>

<template>
  <SettingsLayout>
    <!-- While the tags load the page keeps its shape: the global container, then one project container under it, both filled with label-shaped placeholders. -->
    <template v-if="loading">
      <section class="panel sheet__wide">
        <header class="panel__h">Global tags<span class="panel__end">Usable on every project</span></header>
        <div class="panel__b">
          <div class="taglabels">
            <span v-for="w in [64, 92, 48, 76]" :key="w" class="sk tag-sk" :style="{ width: `${w}px` }"></span>
          </div>
          <div class="addrow">
            <span class="sk field-sk"></span>
            <span class="sk btn-sk"></span>
          </div>
        </div>
      </section>

      <section class="panel sheet__wide">
        <header class="panel__h"><span class="sk head-sk"></span></header>
        <div class="panel__b">
          <div class="taglabels">
            <span v-for="w in [80, 56, 68]" :key="w" class="sk tag-sk" :style="{ width: `${w}px` }"></span>
          </div>
          <div class="addrow">
            <span class="sk field-sk"></span>
            <span class="sk btn-sk"></span>
          </div>
        </div>
      </section>
    </template>

    <section v-if="!loading" class="panel sheet__wide">
      <header class="panel__h">Global tags<span class="panel__end">Usable on every project</span></header>
      <div class="panel__b">
        <div v-if="!globalTags.length" class="empty empty--sm"><span class="empty__g">◇</span>None yet.</div>
        <TagLabels
          :tags="globalTags"
          :can-remove="canDelete"
          @add="add('global', $event)"
          @rename="(t, n) => rename('global', t, n)"
          @remove="(t) => remove('global', t)"
        />
      </div>
    </section>
    <p v-if="notices.global" class="hint sheet__wide panel__err">{{ notices.global }}</p>
    <div v-if="errors.global" class="err sheet__wide panel__err">{{ errors.global }}</div>

    <template v-for="p in !loading ? projects : []" :key="p.id">
    <section class="panel sheet__wide">
      <header class="panel__h">
        {{ p.name }}<span class="panel__end">{{ p.shortName }} only</span>
      </header>
      <div class="panel__b">
        <div v-if="!tagsOf(p.id).length" class="empty empty--sm"><span class="empty__g">◇</span>None yet.</div>
        <TagLabels
          :tags="tagsOf(p.id)"
          :can-remove="canDelete"
          @add="add(p.id, $event, p.shortName)"
          @rename="(t, n) => rename(p.id, t, n)"
          @remove="(t) => remove(p.id, t)"
        />
      </div>
    </section>
    <p v-if="notices[p.id]" class="hint sheet__wide panel__err">{{ notices[p.id] }}</p>
    <div v-if="errors[p.id]" class="err sheet__wide panel__err">{{ errors[p.id] }}</div>
    </template>
  </SettingsLayout>
</template>

<style scoped>
.tag-sk {
  display: block;
  height: 24px;
}
.head-sk {
  display: block;
  width: 140px;
  height: 14px;
}
/* The add row keeps its place too, or the panel grows the moment the tags land. */
.field-sk {
  display: block;
  flex: 1 1 auto;
  height: 34px;
}
.btn-sk {
  display: block;
  flex: 0 0 56px;
  height: 34px;
}
</style>
