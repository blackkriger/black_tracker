<script setup lang="ts">
// One scope's tags: coloured labels, a click renames, the cross deletes, and the row below adds. The colour is the server's, so there is nothing here to pick.
import { nextTick, ref } from 'vue';
import { X } from 'lucide-vue-next';

export interface TagItem {
  id: string;
  name: string;
  color: string;
}

withDefaults(defineProps<{ tags: TagItem[]; canRemove?: boolean }>(), { canRemove: true });
const emit = defineEmits<{
  (e: 'add', name: string): void;
  (e: 'rename', tag: TagItem, name: string): void;
  (e: 'remove', tag: TagItem): void;
}>();

const editingId = ref<string | null>(null);
const draft = ref('');
const fresh = ref('');

async function startEdit(tag: TagItem): Promise<void> {
  editingId.value = tag.id;
  draft.value = tag.name;
  await nextTick();
  document.getElementById(`tag-edit-${tag.id}`)?.focus();
}

function commitEdit(tag: TagItem): void {
  const value = draft.value.trim();
  editingId.value = null;
  if (value && value !== tag.name) emit('rename', tag, value);
}

function add(): void {
  const value = fresh.value.trim();
  if (!value) return;
  emit('add', value);
  fresh.value = '';
}
</script>

<template>
  <div class="taglabels">
    <span v-for="t in tags" :key="t.id" class="taglabel" :style="{ '--c': t.color }">
      <input
        v-if="editingId === t.id"
        :id="`tag-edit-${t.id}`"
        v-model="draft"
        class="taglabel__input"
        maxlength="40"
        @keydown.enter.prevent="commitEdit(t)"
        @keydown.esc.prevent="editingId = null"
        @blur="commitEdit(t)"
      />
      <button v-else class="taglabel__name" type="button" @click="startEdit(t)">{{ t.name }}</button>
      <button
        class="taglabel__x"
        type="button"
        :aria-label="`Delete ${t.name}`"
        :disabled="!canRemove"
        @click="emit('remove', t)"
      ><X class="ic ic--sm" /></button>
    </span>
  </div>

  <form class="addrow" @submit.prevent="add">
    <input v-model="fresh" class="input" placeholder="Add tag…" maxlength="40" />
    <button class="btn" type="submit" :disabled="!fresh.trim()">Add</button>
  </form>
</template>

<style scoped>
.taglabel__name {
  border: 0;
  background: none;
  padding: 0;
  color: inherit;
  font: inherit;
  cursor: text;
}
.addrow {
  margin-top: var(--space-3);
}
</style>
