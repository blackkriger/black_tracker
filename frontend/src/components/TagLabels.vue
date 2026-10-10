<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { X } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';

export interface TagItem {
  id: string;
  name: string;
  color: string;
}

withDefaults(defineProps<{ tags: TagItem[]; canRemove?: boolean }>(), { canRemove: true });
const { t } = useI18n();
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
    <span v-for="tag in tags" :key="tag.id" class="taglabel" :style="{ '--c': tag.color }">
      <input
        v-if="editingId === tag.id"
        :id="`tag-edit-${tag.id}`"
        v-model="draft"
        class="taglabel__input"
        maxlength="40"
        @keydown.enter.prevent="commitEdit(tag)"
        @keydown.esc.prevent="editingId = null"
        @blur="commitEdit(tag)"
      />
      <button v-else class="taglabel__name" type="button" @click="startEdit(tag)">{{ tag.name }}</button>
      <button
        class="taglabel__x"
        type="button"
        :aria-label="t('common.deleteNamed', { name: tag.name })"
        :disabled="!canRemove"
        @click="emit('remove', tag)"
      ><X class="ic ic--sm" /></button>
    </span>
  </div>

  <form class="addrow" @submit.prevent="add">
    <input v-model="fresh" class="input" :placeholder="t('tags.addPlaceholder')" maxlength="40" />
    <button class="btn" type="submit" :disabled="!fresh.trim()">{{ t('common.add') }}</button>
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
</style>
