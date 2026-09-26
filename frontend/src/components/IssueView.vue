<script setup lang="ts">
// One issue, opened over the board it lives on: the text on the left, what it is on the right, and underneath it everything that has been said and done about it. Every edit is its own small write — there is no Save for the issue as a whole.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { api } from '../lib/api';
import { buddyAvatarStyle } from '../lib/avatar';
import { useSession } from '../lib/session';
import {
  PRIORITIES,
  dueLabel,
  fileSize,
  stamp,
  stampAt,
  type Attachment,
  type Comment,
  type Issue,
  type IssueFull,
  type IssueTag,
  type Priority,
} from '../lib/issues';

interface State {
  id: string;
  name: string;
  color: string;
}

const props = defineProps<{
  issueKey: string;
  board: { id: string; name: string; states: State[] };
  tags: IssueTag[];
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'changed', issue: Issue): void;
  (e: 'deleted', id: string): void;
}>();

const session = useSession();

const issue = ref<IssueFull | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const people = ref<{ id: string; login: string; fullName: string }[]>([]);

const tab = ref<'comments' | 'history'>('comments');

// The title and the description are the issue's text: they are edited together, deliberately, and saved in one write.
const editing = ref(false);
const saving = ref(false);
const titleDraft = ref('');
const bodyDraft = ref('');

const commentDraft = ref('');
const posting = ref(false);
const editingComment = ref<string | null>(null);
const commentEdit = ref('');

const uploading = ref(false);
const dragOver = ref(false);
const deleting = ref(false);

const state = computed(() => props.board.states.find((s) => s.id === issue.value?.stateId) ?? null);
const wornTags = computed(() => issue.value?.tags ?? []);
const freeTags = computed(() =>
  props.tags.filter((t) => !wornTags.value.some((w) => w.id === t.id))
);
const images = computed(() =>
  (issue.value?.attachments ?? []).filter((a) => a.mime.startsWith('image/'))
);
const files = computed(() =>
  (issue.value?.attachments ?? []).filter((a) => !a.mime.startsWith('image/'))
);

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key !== 'Escape') return;
  if (editing.value) editing.value = false;
  else emit('close');
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  void api<{ id: string; login: string; fullName: string }[]>('/people')
    .then((rows) => (people.value = rows))
    .catch(() => {});
});
onUnmounted(() => window.removeEventListener('keydown', onKeydown));

watch(() => props.issueKey, load, { immediate: true });

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    issue.value = await api<IssueFull>(`/issues/${encodeURIComponent(props.issueKey)}`);
  } catch (err) {
    issue.value = null;
    error.value = err instanceof Error ? err.message : 'Could not load the issue.';
  } finally {
    loading.value = false;
  }
}

// Every property writes on its own and hands the card the new shape.
async function patch(body: Record<string, unknown>): Promise<void> {
  const current = issue.value;
  if (!current) return;
  error.value = null;
  try {
    const updated = await api<Issue>(`/issues/${current.id}`, { method: 'PATCH', body });
    issue.value = { ...current, ...updated };
    emit('changed', updated);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not save the change.';
  }
}

function startEditing(): void {
  titleDraft.value = issue.value?.summary ?? '';
  bodyDraft.value = issue.value?.description ?? '';
  editing.value = true;
}

async function saveText(): Promise<void> {
  const current = issue.value;
  if (!current || saving.value) return;
  const summary = titleDraft.value.trim();
  const body: Record<string, unknown> = {};
  if (summary && summary !== current.summary) body.summary = summary;
  if (bodyDraft.value !== current.description) body.description = bodyDraft.value;
  saving.value = true;
  try {
    if (Object.keys(body).length) await patch(body);
    editing.value = false;
  } finally {
    saving.value = false;
  }
}

function toggleTag(tagId: string, on: boolean): void {
  const next = on
    ? [...wornTags.value.map((t) => t.id), tagId]
    : wornTags.value.map((t) => t.id).filter((id) => id !== tagId);
  void patch({ tagIds: next });
}

async function postComment(): Promise<void> {
  const text = commentDraft.value.trim();
  const current = issue.value;
  if (!text || !current || posting.value) return;
  posting.value = true;
  error.value = null;
  try {
    const created = await api<Comment>(`/issues/${current.id}/comments`, {
      method: 'POST',
      body: { text },
    });
    issue.value = { ...current, comments: [...current.comments, created] };
    commentDraft.value = '';
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not post the comment.';
  } finally {
    posting.value = false;
  }
}

async function saveComment(c: Comment): Promise<void> {
  const text = commentEdit.value.trim();
  editingComment.value = null;
  const current = issue.value;
  if (!current || !text || text === c.text) return;
  try {
    const updated = await api<{ editedAt: string }>(`/comments/${c.id}`, {
      method: 'PATCH',
      body: { text },
    });
    issue.value = {
      ...current,
      comments: current.comments.map((row) =>
        row.id === c.id ? { ...row, text, editedAt: updated.editedAt } : row
      ),
    };
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not save the comment.';
  }
}

async function removeComment(c: Comment): Promise<void> {
  const current = issue.value;
  if (!current) return;
  try {
    await api(`/comments/${c.id}`, { method: 'DELETE' });
    issue.value = { ...current, comments: current.comments.filter((row) => row.id !== c.id) };
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not delete the comment.';
  }
}

async function upload(list: FileList | null): Promise<void> {
  const current = issue.value;
  if (!list?.length || !current) return;
  uploading.value = true;
  error.value = null;
  try {
    for (const file of Array.from(list)) {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/issues/${current.id}/attachments`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const payload = (await res.json().catch(() => null)) as
        | { data?: Attachment; error?: string }
        | null;
      if (!res.ok || !payload?.data) throw new Error(payload?.error ?? 'Could not upload the file.');
      issue.value = {
        ...(issue.value as IssueFull),
        attachments: [...(issue.value as IssueFull).attachments, payload.data],
      };
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not upload the file.';
  } finally {
    uploading.value = false;
    dragOver.value = false;
  }
}

async function removeAttachment(a: Attachment): Promise<void> {
  const current = issue.value;
  if (!current) return;
  try {
    await api(`/attachments/${a.id}`, { method: 'DELETE' });
    issue.value = {
      ...current,
      attachments: current.attachments.filter((row) => row.id !== a.id),
    };
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not delete the file.';
  }
}

async function removeIssue(): Promise<void> {
  const current = issue.value;
  if (!current) return;
  try {
    await api(`/issues/${current.id}`, { method: 'DELETE' });
    emit('deleted', current.id);
  } catch (err) {
    deleting.value = false;
    error.value = err instanceof Error ? err.message : 'Could not delete the issue.';
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="iv__scrim" @click.self="emit('close')">
      <section class="dlg iv__win" role="dialog" aria-modal="true">
        <header class="dlg__h">
          <span class="key iv__key">{{ issueKey }}</span>
          <span v-if="state" class="iv__state" :style="{ color: state.color }">{{ state.name }}</span>
          <div class="sp"></div>
          <template v-if="editing">
            <button class="btn btn--sm" type="button" @click="editing = false">Cancel</button>
            <button class="btn btn--sm btn--primary" type="button" :disabled="saving" @click="saveText">
              Save
            </button>
          </template>
          <template v-else>
            <button
              class="btn btn--sm btn--icon btn--ghost"
              type="button"
              aria-label="Edit"
              :disabled="!issue"
              @click="startEditing"
            >
              ✎
            </button>
            <button
              class="btn btn--sm btn--danger"
              type="button"
              :disabled="!session.canDelete.value"
              @click="deleting = true"
            >
              Delete
            </button>
          </template>
          <button
            class="btn btn--sm btn--icon btn--ghost"
            type="button"
            aria-label="Close"
            @click="emit('close')"
          >
            ✕
          </button>
        </header>

        <div v-if="loading" class="iv__loading">
          <span class="sk sk--line" style="width: 320px; height: 24px"></span>
          <span class="sk sk--line" style="width: 100%; height: 64px"></span>
        </div>
        <div v-else-if="!issue" class="empty"><span class="empty__g">✕</span>{{ error }}</div>

        <div v-else class="iv">
          <div class="iv__main">
            <input
              v-if="editing"
              v-model="titleDraft"
              class="input iv__title-edit"
              maxlength="300"
              autofocus
              @keydown.enter.prevent="saveText"
            />
            <h1 v-else class="iv__title iv__title--ro">{{ issue.summary }}</h1>

            <div>
              <div class="sec-h">Description</div>
              <textarea v-if="editing" v-model="bodyDraft" class="input iv__body-edit"></textarea>
              <div v-else class="md iv__body">{{ issue.description || 'Nothing written yet.' }}</div>
            </div>

            <div>
              <div class="sec-h">Files<span class="n">{{ issue.attachments.length }}</span></div>
              <div v-if="images.length" class="atts">
                <figure v-for="a in images" :key="a.id" class="att">
                  <a class="att__img" :href="`/api/attachments/${a.id}`" target="_blank">
                    <img :src="`/api/attachments/${a.id}`" :alt="a.filename" class="att__pic" />
                  </a>
                  <figcaption class="att__cap">
                    <span>{{ a.filename }}</span>
                    <button
                      class="btn btn--sm btn--icon btn--ghost"
                      type="button"
                      :aria-label="`Delete ${a.filename}`"
                      @click="removeAttachment(a)"
                    >✕</button>
                  </figcaption>
                </figure>
              </div>
              <div v-for="a in files" :key="a.id" class="att__cap att__row">
                <a :href="`/api/attachments/${a.id}`" target="_blank">{{ a.filename }}</a>
                <span class="stamp">{{ fileSize(a.size) }}</span>
                <button
                  class="btn btn--sm btn--icon btn--ghost"
                  type="button"
                  :aria-label="`Delete ${a.filename}`"
                  @click="removeAttachment(a)"
                >✕</button>
              </div>
              <label
                class="drop"
                :class="{ 'drop--idle': !dragOver }"
                @dragover.prevent="dragOver = true"
                @dragleave="dragOver = false"
                @drop.prevent="upload(($event as DragEvent).dataTransfer?.files ?? null)"
              >
                <input
                  type="file"
                  multiple
                  class="sr"
                  @change="upload(($event.target as HTMLInputElement).files)"
                />
                {{ uploading ? 'Uploading…' : 'Drop files here, or click to choose' }}
              </label>
            </div>

            <nav class="itabs" aria-label="Issue detail">
              <button
                class="itab"
                type="button"
                :aria-selected="tab === 'comments'"
                @click="tab = 'comments'"
              >
                Comments<span class="n">{{ issue.comments.length }}</span>
              </button>
              <button
                class="itab"
                type="button"
                :aria-selected="tab === 'history'"
                @click="tab = 'history'"
              >
                History<span class="n">{{ issue.history.length }}</span>
              </button>
            </nav>

            <div v-if="tab === 'comments'" class="iv__list">
              <article v-for="c in issue.comments" :key="c.id" class="cm">
                <span class="av av--lg" :style="buddyAvatarStyle(c.author.login)"></span>
                <div>
                  <div class="cm__head">
                    <span class="cm__who">{{ c.author.login }}</span>
                    <time class="stamp">{{ stamp(c.createdAt) }}</time>
                    <span v-if="c.editedAt" class="cm__edited">edited</span>
                    <span class="cm__acts">
                      <button
                        v-if="c.author.id === session.me.value?.id"
                        class="btn btn--sm btn--ghost"
                        type="button"
                        @click="editingComment = c.id; commentEdit = c.text"
                      >Edit</button>
                      <button
                        v-if="c.author.id === session.me.value?.id || session.canDelete.value"
                        class="btn btn--sm btn--ghost"
                        type="button"
                        @click="removeComment(c)"
                      >Delete</button>
                    </span>
                  </div>
                  <template v-if="editingComment === c.id">
                    <textarea v-model="commentEdit" class="input iv__body-edit"></textarea>
                    <div class="composer__row">
                      <div class="sp"></div>
                      <button class="btn btn--sm" type="button" @click="editingComment = null">Cancel</button>
                      <button class="btn btn--sm btn--primary" type="button" @click="saveComment(c)">Save</button>
                    </div>
                  </template>
                  <div v-else class="md cm__body">{{ c.text }}</div>
                </div>
              </article>

              <form class="cm cm--new" @submit.prevent="postComment">
                <span class="av av--lg" :style="buddyAvatarStyle(session.me.value?.login ?? '')"></span>
                <div>
                  <textarea
                    v-model="commentDraft"
                    class="input iv__body-edit"
                    placeholder="Write a comment…"
                  ></textarea>
                  <div class="composer__row">
                    <div class="sp"></div>
                    <button
                      class="btn btn--sm btn--primary"
                      type="submit"
                      :disabled="!commentDraft.trim() || posting"
                    >
                      Post
                    </button>
                  </div>
                </div>
              </form>
            </div>

            <div v-else class="hist">
              <div v-for="h in issue.history" :key="h.id" class="hi">
                <time>{{ stampAt(h.at) }}</time>
                <span class="hi__who">{{ h.by }}</span>
                <span class="hi__what">
                  <span class="hi__f">{{ h.field }}</span>
                  <!-- Nothing before it means there is nothing to point away from: the value stands alone. -->
                  <template v-if="h.from">
                    <span class="hi__f">{{ h.from }}</span>
                    <span class="hi__arrow">→</span>
                    <span class="hi__t">{{ h.to ?? '—' }}</span>
                  </template>
                  <span v-else-if="h.to" class="hi__t">{{ h.to }}</span>
                </span>
              </div>
              <div v-if="!issue.history.length" class="empty empty--sm">
                <span class="empty__g">◇</span>Nothing yet.
              </div>
            </div>
          </div>

          <aside class="props">
            <div class="prop">
              <span class="prop__k">Status</span>
              <select
                class="input input--sm"
                :value="issue.stateId"
                @change="patch({ stateId: ($event.target as HTMLSelectElement).value })"
              >
                <option v-for="s in board.states" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
            </div>
            <div class="prop">
              <span class="prop__k">Priority</span>
              <select
                class="input input--sm"
                :value="issue.priority"
                @change="patch({ priority: ($event.target as HTMLSelectElement).value as Priority })"
              >
                <option v-for="p in PRIORITIES" :key="p" :value="p">{{ p }}</option>
              </select>
            </div>
            <div class="prop">
              <span class="prop__k">Assignee</span>
              <select
                class="input input--sm"
                :value="issue.assignee?.id ?? ''"
                @change="patch({ assigneeId: ($event.target as HTMLSelectElement).value || null })"
              >
                <option value="">—</option>
                <option v-for="p in people" :key="p.id" :value="p.id">
                  {{ p.fullName || p.login }}
                </option>
              </select>
            </div>
            <div class="prop">
              <span class="prop__k">Due</span>
              <!-- A date that has gone by says so by being red; there is no word for it anywhere else. -->
              <input
                class="input input--sm"
                :class="{ 'is-late': dueLabel(issue.dueDate)?.late }"
                type="date"
                :value="issue.dueDate ?? ''"
                @change="patch({ dueDate: ($event.target as HTMLInputElement).value || null })"
              />
            </div>

            <div class="hr"></div>

            <div class="prop prop--tall">
              <span class="prop__k">Tags</span>
              <div class="prop__tags">
                <span
                  v-for="t in wornTags"
                  :key="t.id"
                  class="taglabel"
                  :style="{ '--c': t.color }"
                >
                  {{ t.name }}
                  <button
                    class="taglabel__x"
                    type="button"
                    :aria-label="`Remove ${t.name}`"
                    @click="toggleTag(t.id, false)"
                  >✕</button>
                </span>
                <select
                  v-if="freeTags.length"
                  class="input input--sm"
                  value=""
                  @change="toggleTag(($event.target as HTMLSelectElement).value, true)"
                >
                  <option value="">Add tag…</option>
                  <option v-for="t in freeTags" :key="t.id" :value="t.id">{{ t.name }}</option>
                </select>
              </div>
            </div>

            <div class="hr"></div>

            <div class="prop">
              <span class="prop__k">Author</span>
              <span class="pv pv--ro">{{ issue.author?.login ?? '—' }}</span>
            </div>
            <div class="prop">
              <span class="prop__k">Created</span>
              <span class="pv pv--ro stamp">{{ stamp(issue.createdAt) }}</span>
            </div>
          </aside>
        </div>

        <div v-if="error" class="err iv__err">{{ error }}</div>
      </section>

      <div v-if="deleting" class="iv__confirm">
        <section class="dlg iv__confirm-win" role="dialog" aria-modal="true">
          <header class="dlg__h"><span>Delete {{ issueKey }}</span></header>
          <div class="dlg__b">
            <p>This takes its comments, files and history with it. This cannot be undone.</p>
          </div>
          <div class="dlg__f">
            <button class="btn" type="button" @click="deleting = false">Cancel</button>
            <button class="btn btn--danger" type="button" @click="removeIssue">Delete issue</button>
          </div>
        </section>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.iv__scrim {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-5);
  background: rgba(0, 0, 0, 0.7);
}
.iv__win {
  display: flex;
  flex-direction: column;
  width: min(1100px, 100%);
  /* An issue with nothing in it yet keeps the same window as one with a year of history behind it. */
  min-height: min(760px, 100%);
  max-height: 100%;
  overflow: hidden;
}
.iv {
  flex: 1 1 auto;
  min-height: 0;
}
.iv__main,
.props {
  overflow-y: auto;
}
.iv__key {
  font-size: 13px;
}
.iv__state {
  font-size: 12.5px;
}
.iv__loading {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px 24px;
}
.iv__title-edit {
  height: 38px;
  font: 600 20px var(--font-ui);
}
/* Out of edit mode the text is text: nothing here invites a click that would change it. */
.iv__title--ro:hover {
  border-color: transparent;
  background: none;
}
.iv__body {
  white-space: pre-wrap;
}
.iv__body-edit {
  width: 100%;
  height: 120px;
  padding: 10px;
  line-height: 1.55;
  resize: vertical;
}
/* The buttons belong to the field above them, not stuck to its edge. */
.iv__body-edit + .composer__row {
  margin-top: 8px;
}
/* The day and the clock ride together in the first column, so it is wider than the theme's default. */
.hi {
  grid-template-columns: 152px 96px minmax(0, 1fr);
}
.iv__list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.cm__body {
  white-space: pre-wrap;
}
.att__pic {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.att__row {
  height: 32px;
  border: 1px solid var(--line);
  margin-top: 8px;
}
.att__row a {
  flex: 1;
  color: var(--text);
  text-decoration: none;
}
.drop {
  height: 56px;
  margin-top: 8px;
  cursor: pointer;
}
.is-late {
  color: var(--danger-text);
}
.prop--tall {
  align-items: start;
  padding: 6px 0;
}
.prop__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.iv__err {
  padding: 0 24px 16px;
}
.iv__confirm {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
}
.iv__confirm-win {
  width: 360px;
}
.iv__confirm p {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-dim);
}
</style>
