<script setup lang="ts">
// One issue, opened over the board it lives on: the text on the left, what it is on the right, and underneath it everything that has been said and done about it. Every edit is its own small write — there is no Save for the issue as a whole.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import Dialog from './Dialog.vue';
import RichText from './RichText.vue';
import { TAB_ID, api } from '../lib/api';
import { asHtml, isBlank } from '../lib/richtext';
import { buddyAvatarStyle } from '../lib/avatar';
import { useLive } from '../lib/live';
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
  /** The issue being read. Absent means this window is writing a new one. */
  issueKey?: string;
  /** The column a new issue starts in. */
  createIn?: string | null;
  board: { id: string; name: string; states: State[] };
  tags: IssueTag[];
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'changed', issue: Issue): void;
  (e: 'created', issue: Issue): void;
  (e: 'deleted', id: string): void;
}>();

const session = useSession();

const creating = computed(() => !props.issueKey);
// What a new issue is so far. An existing one is written a field at a time; this one is written all at once, when it is saved.
const draft = ref({
  summary: '',
  description: '',
  stateId: '',
  priority: 'Normal' as Priority,
  assigneeId: null as string | null,
  dueDate: null as string | null,
  tagIds: [] as string[],
});

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

// Fields somebody else changed a moment ago, lit for as long as the animation runs.
const fresh = ref<Set<string>>(new Set());

// The names the server sends for what changed, in the names this screen knows them by.
const FIELD_OF: Record<string, string> = {
  summary: 'summary',
  description: 'description',
  stateId: 'status',
  status: 'status',
  priority: 'priority',
  assigneeId: 'assignee',
  dueDate: 'due',
  tagIds: 'tags',
};

function flash(names: string[]): void {
  if (!names.length) return;
  const next = new Set(fresh.value);
  for (const n of names) next.add(n);
  fresh.value = next;
  setTimeout(() => {
    const after = new Set(fresh.value);
    for (const n of names) after.delete(n);
    fresh.value = after;
  }, 2000);
}

const uploading = ref(false);
const dragOver = ref(false);
// Files chosen before there is anything to attach them to: a new issue, or a comment that has not been posted. They are uploaded the moment their owner exists.
const pending = ref<File[]>([]);
const commentFiles = ref<File[]>([]);
const deleting = ref(false);

const shownStateId = computed(() => (creating.value ? draft.value.stateId : issue.value?.stateId));
const shownPriority = computed(() =>
  creating.value ? draft.value.priority : (issue.value?.priority ?? 'Normal')
);
const shownAssignee = computed(() =>
  creating.value ? draft.value.assigneeId : (issue.value?.assignee?.id ?? null)
);
const shownDue = computed(() => (creating.value ? draft.value.dueDate : (issue.value?.dueDate ?? null)));
const state = computed(() => props.board.states.find((s) => s.id === shownStateId.value) ?? null);
const wornTags = computed(() =>
  creating.value
    ? props.tags.filter((t) => draft.value.tagIds.includes(t.id))
    : (issue.value?.tags ?? [])
);
const freeTags = computed(() =>
  props.tags.filter((t) => !wornTags.value.some((w) => w.id === t.id))
);
// The issue's own files; anything hanging off a comment is shown under that comment instead.
const own = computed(() => (issue.value?.attachments ?? []).filter((a) => !a.commentId));
const images = computed(() => own.value.filter((a) => a.mime.startsWith('image/')));
const files = computed(() => own.value.filter((a) => !a.mime.startsWith('image/')));
const filesOf = (commentId: string) =>
  (issue.value?.attachments ?? []).filter((a) => a.commentId === commentId);

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key !== 'Escape') return;
  if (deleting.value) deleting.value = false;
  else if (creating.value || !editing.value) emit('close');
  else editing.value = false;
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  void api<{ id: string; login: string; fullName: string }[]>('/people')
    .then((rows) => (people.value = rows))
    .catch(() => {});
});
onUnmounted(() => window.removeEventListener('keydown', onKeydown));

watch(() => props.issueKey, load, { immediate: true });

// The issue is being read by more than one person: what they do to it lands here as it happens.
useLive((ev) => {
  const current = issue.value;
  if (!current || ev.issueId !== current.id) return;
  void reload().then(() => {
    if (ev.type.startsWith('comment.')) flash(['comments']);
    else if (ev.type.startsWith('attachment.')) flash(['files']);
    else flash((ev.fields ?? []).map((f) => FIELD_OF[f] ?? f));
  });
});

// A second read of the same issue, without the skeleton: the window is already on screen.
async function reload(): Promise<void> {
  if (!props.issueKey) return;
  try {
    issue.value = await api<IssueFull>(`/issues/${encodeURIComponent(props.issueKey)}`);
  } catch {
    /* the next event, or closing and opening it again, will do */
  }
}

async function load(): Promise<void> {
  if (!props.issueKey) {
    // A window opened on nothing starts in edit mode, in the column it was opened from.
    draft.value = {
      summary: '',
      description: '',
      stateId: props.createIn ?? props.board.states[0]?.id ?? '',
      priority: 'Normal',
      assigneeId: null,
      dueDate: null,
      tagIds: [],
    };
    titleDraft.value = '';
    bodyDraft.value = '';
    editing.value = true;
    loading.value = false;
    return;
  }
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
async function patch(body: Record<string, unknown>): Promise<boolean> {
  const current = issue.value;
  if (!current) return false;
  error.value = null;
  try {
    const updated = await api<Issue>(`/issues/${current.id}`, { method: 'PATCH', body });
    // Read from the ref again rather than the snapshot: an event may have replaced the issue while this was in flight.
    issue.value = { ...(issue.value ?? current), ...updated };
    emit('changed', updated);
    // The answer carries the issue but not what it did to the record: history is read again so it grows as you work.
    await reload();
    return true;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not save the change.';
    return false;
  }
}

// Each property either goes straight to the server or into the draft, depending on which kind of window this is.
function setProp(body: Record<string, unknown>): void {
  if (!creating.value) {
    void patch(body);
    return;
  }
  draft.value = { ...draft.value, ...body };
}

async function create(): Promise<void> {
  const summary = titleDraft.value.trim();
  if (!summary || saving.value) return;
  saving.value = true;
  error.value = null;
  try {
    const made = await api<Issue>(`/boards/${props.board.id}/issues`, {
      method: 'POST',
      body: {
        summary,
        description: bodyDraft.value,
        stateId: draft.value.stateId,
        priority: draft.value.priority,
        assigneeId: draft.value.assigneeId,
        dueDate: draft.value.dueDate,
        tagIds: draft.value.tagIds,
      },
    });
    if (pending.value.length) {
      try {
        await sendFiles(made.id, pending.value);
      } catch (err) {
        // The issue is made; only the files failed, and saying so is better than losing the issue with them.
        error.value = err instanceof Error ? err.message : 'The issue was created without the files.';
      }
      pending.value = [];
    }
    emit('created', made);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not create the issue.';
  } finally {
    saving.value = false;
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
    // Leaving edit mode on a failed write would throw away what they just typed.
    if (Object.keys(body).length && !(await patch(body))) return;
    editing.value = false;
  } finally {
    saving.value = false;
  }
}

function toggleTag(tagId: string, on: boolean): void {
  const next = on
    ? [...wornTags.value.map((t) => t.id), tagId]
    : wornTags.value.map((t) => t.id).filter((id) => id !== tagId);
  setProp({ tagIds: next });
}

async function postComment(): Promise<void> {
  const text = commentDraft.value;
  const current = issue.value;
  if (isBlank(text) || !current || posting.value) return;
  posting.value = true;
  error.value = null;
  try {
    const created = await api<Comment>(`/issues/${current.id}/comments`, {
      method: 'POST',
      body: { text },
    });
    const now = issue.value ?? current;
    issue.value = { ...now, comments: [...now.comments, created] };
    commentDraft.value = '';
    if (commentFiles.value.length) {
      await sendFiles(current.id, commentFiles.value, created.id);
      commentFiles.value = [];
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not post the comment.';
  } finally {
    posting.value = false;
  }
}

async function saveComment(c: Comment): Promise<void> {
  const text = commentEdit.value;
  editingComment.value = null;
  const current = issue.value;
  if (!current || isBlank(text) || text === c.text) return;
  try {
    const updated = await api<{ editedAt: string }>(`/comments/${c.id}`, {
      method: 'PATCH',
      body: { text },
    });
    const now = issue.value ?? current;
    issue.value = {
      ...now,
      comments: now.comments.map((row) =>
        row.id === c.id ? { ...row, text, editedAt: updated.editedAt } : row
      ),
    };
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not save the comment.';
  }
}

async function togglePin(c: Comment): Promise<void> {
  const current = issue.value;
  if (!current) return;
  error.value = null;
  try {
    const updated = await api<{ pinnedAt: string | null; pinnedBy: string | null }>(
      `/comments/${c.id}/pin`,
      { method: 'PUT', body: { pinned: !c.pinnedAt } }
    );
    const now = issue.value ?? current;
    const comments = now.comments.map((row) =>
      row.id === c.id ? { ...row, pinnedAt: updated.pinnedAt, pinnedBy: updated.pinnedBy } : row
    );
    // Pinned ones lead the thread, and the rest keep their order.
    issue.value = {
      ...now,
      comments: [...comments].sort(
        (a, b) =>
          Number(!!b.pinnedAt) - Number(!!a.pinnedAt) || a.createdAt.localeCompare(b.createdAt)
      ),
    };
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not pin the comment.';
  }
}

async function removeComment(c: Comment): Promise<void> {
  const current = issue.value;
  if (!current) return;
  try {
    await api(`/comments/${c.id}`, { method: 'DELETE' });
    const now = issue.value ?? current;
    issue.value = { ...now, comments: now.comments.filter((row) => row.id !== c.id) };
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not delete the comment.';
  }
}

async function sendFiles(issueId: string, list: File[], commentId?: string): Promise<void> {
  for (const file of list) {
    const form = new FormData();
    form.append('file', file);
    const where = commentId ? `?comment=${commentId}` : '';
    const res = await fetch(`/api/issues/${issueId}/attachments${where}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Tab-Id': TAB_ID },
      body: form,
    });
    const payload = (await res.json().catch(() => null)) as
      | { data?: Attachment; error?: string }
      | null;
    if (!res.ok || !payload?.data) throw new Error(payload?.error ?? 'Could not upload the file.');
    if (issue.value) {
      issue.value = { ...issue.value, attachments: [...issue.value.attachments, payload.data] };
    }
  }
}

// On an issue that exists the file goes straight up; on one being written it waits in the list until there is an issue to hang it on.
async function upload(list: FileList | null): Promise<void> {
  const chosen = list ? Array.from(list) : [];
  if (!chosen.length) return;
  dragOver.value = false;
  if (creating.value || !issue.value) {
    pending.value = [...pending.value, ...chosen];
    return;
  }
  uploading.value = true;
  error.value = null;
  try {
    await sendFiles(issue.value.id, chosen);
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not upload the file.';
  } finally {
    uploading.value = false;
  }
}

function dropPending(name: string, from: 'issue' | 'comment'): void {
  const list = from === 'issue' ? pending : commentFiles;
  const at = list.value.findIndex((f) => f.name === name);
  if (at >= 0) list.value = list.value.filter((_, i) => i !== at);
}

function pickCommentFiles(list: FileList | null): void {
  if (!list?.length) return;
  commentFiles.value = [...commentFiles.value, ...Array.from(list)];
}

async function removeAttachment(a: Attachment): Promise<void> {
  const current = issue.value;
  if (!current) return;
  try {
    await api(`/attachments/${a.id}`, { method: 'DELETE' });
    const now = issue.value ?? current;
    issue.value = { ...now, attachments: now.attachments.filter((row) => row.id !== a.id) };
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
          <span class="key iv__key">{{ issueKey ?? 'New issue' }}</span>
          <span v-if="state" class="iv__state" :style="{ color: state.color }">{{ state.name }}</span>
          <div class="sp"></div>
          <template v-if="creating">
            <button class="btn btn--sm" type="button" @click="emit('close')">Cancel</button>
            <button
              class="btn btn--sm btn--primary"
              type="button"
              :disabled="saving || !titleDraft.trim()"
              @click="create"
            >
              Create
            </button>
          </template>
          <template v-else-if="editing">
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

        <div v-if="loading && !creating" class="iv__loading">
          <span class="sk sk--line" style="width: 320px; height: 24px"></span>
          <span class="sk sk--line" style="width: 100%; height: 64px"></span>
        </div>
        <div v-else-if="!issue && !creating" class="empty">
          <span class="empty__g">✕</span>{{ error }}
        </div>

        <div v-else class="iv">
          <div class="iv__main">
            <input
              v-if="editing"
              v-model="titleDraft"
              class="input iv__title-edit"
              maxlength="300"
              placeholder="What needs doing?"
              autofocus
              @keydown.enter.prevent="creating ? create() : saveText()"
            />
            <h1
              v-else
              class="iv__title iv__title--ro"
              :class="{ 'is-fresh': fresh.has('summary') }"
            >{{ issue?.summary }}</h1>

            <div>
              <div class="sec-h">Description</div>
              <RichText
                v-if="editing"
                v-model="bodyDraft"
                placeholder="What is this about?"
                @files="upload"
              />
              <div
                v-else-if="issue?.description && !isBlank(issue.description)"
                class="md iv__body"
                :class="{ 'is-fresh': fresh.has('description') }"
                v-html="asHtml(issue.description)"
              ></div>
              <div v-else class="md iv__body hint">Nothing written yet.</div>
            </div>

            <div :class="{ 'is-fresh': fresh.has('files') }">
              <div class="sec-h">
                Files<span class="n">{{ own.length + pending.length }}</span>
              </div>
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

              <!-- Chosen, not yet uploaded: they go up the moment the issue exists. -->
              <div v-for="f in pending" :key="f.name" class="att__cap att__row att__row--wait">
                <span class="att__name">{{ f.name }}</span>
                <span class="stamp">{{ fileSize(f.size) }}</span>
                <button
                  class="btn btn--sm btn--icon btn--ghost"
                  type="button"
                  :aria-label="`Remove ${f.name}`"
                  @click="dropPending(f.name, 'issue')"
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

            <nav v-if="issue" class="itabs" aria-label="Issue detail">
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

            <div
              v-if="issue && tab === 'comments'"
              class="iv__list"
              :class="{ 'is-fresh': fresh.has('comments') }"
            >
              <article
                v-for="c in issue.comments"
                :key="c.id"
                class="cm"
              >
                <span class="av av--lg" :style="buddyAvatarStyle(c.author.login)"></span>
                <div>
                  <div class="cm__head">
                    <span class="cm__who">{{ c.author.login }}</span>
                    <time class="stamp">{{ stampAt(c.createdAt) }}</time>
                    <span v-if="c.editedAt" class="cm__edited">edited</span>
                    <svg
                      v-if="c.pinnedAt"
                      class="cm__pin"
                      viewBox="0 0 16 16"
                      width="12"
                      height="12"
                      role="img"
                      :aria-label="c.pinnedBy ? `Pinned by ${c.pinnedBy}` : 'Pinned'"
                    >
                      <title>{{ c.pinnedBy ? `Pinned by ${c.pinnedBy}` : 'Pinned' }}</title>
                      <path
                        fill="currentColor"
                        d="M9.5 1.5 14.5 6.5 12.9 8.1 12 7.9 9.2 10.7 9.6 13.2 8.6 14.2 5.3 10.9 1.9 14.3 1.7 14.1 5.1 10.7 1.8 7.4 2.8 6.4 5.3 6.8 8.1 4 7.9 3.1z"
                      />
                    </svg>
                    <span class="cm__acts">
                      <button class="btn btn--sm btn--ghost" type="button" @click="togglePin(c)">
                        {{ c.pinnedAt ? 'Unpin' : 'Pin' }}
                      </button>
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
                    <RichText v-model="commentEdit" min-height="90px" />
                    <div class="composer__row">
                      <div class="sp"></div>
                      <button class="btn btn--sm" type="button" @click="editingComment = null">Cancel</button>
                      <button class="btn btn--sm btn--primary" type="button" @click="saveComment(c)">Save</button>
                    </div>
                  </template>
                  <div v-else class="md cm__body" v-html="asHtml(c.text)"></div>

                  <div v-if="filesOf(c.id).length" class="cm__files">
                    <template v-for="a in filesOf(c.id)" :key="a.id">
                      <a
                        v-if="a.mime.startsWith('image/')"
                        class="cm__shot"
                        :href="`/api/attachments/${a.id}`"
                        target="_blank"
                      >
                        <img :src="`/api/attachments/${a.id}`" :alt="a.filename" />
                      </a>
                      <span v-else class="att__cap att__row">
                        <a :href="`/api/attachments/${a.id}`" target="_blank">{{ a.filename }}</a>
                        <span class="stamp">{{ fileSize(a.size) }}</span>
                      </span>
                    </template>
                  </div>
                </div>
              </article>

              <form class="cm" @submit.prevent="postComment">
                <span class="av av--lg" :style="buddyAvatarStyle(session.me.value?.login ?? '')"></span>
                <div>
                  <RichText
                    v-model="commentDraft"
                    min-height="90px"
                    placeholder="Write a comment…"
                    @files="pickCommentFiles"
                  >
                    <template #tools>
                      <label class="rt__clip" title="Attach files">
                        <input
                          type="file"
                          multiple
                          class="sr"
                          @change="pickCommentFiles(($event.target as HTMLInputElement).files)"
                        />
                        <svg viewBox="0 0 16 16" width="13" height="13" role="img" aria-label="Attach files">
                          <path
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.3"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M12.4 7.3 7 12.7a3 3 0 0 1-4.2-4.2l5.8-5.8a2 2 0 0 1 2.8 2.8l-5.7 5.7a1 1 0 0 1-1.4-1.4l5.1-5.1"
                          />
                        </svg>
                      </label>
                    </template>
                  </RichText>
                  <div v-if="commentFiles.length" class="cm__waiting">
                    <span v-for="f in commentFiles" :key="f.name" class="att__cap att__row">
                      <span class="att__name">{{ f.name }}</span>
                      <span class="stamp">{{ fileSize(f.size) }}</span>
                      <button
                        class="btn btn--sm btn--icon btn--ghost"
                        type="button"
                        :aria-label="`Remove ${f.name}`"
                        @click="dropPending(f.name, 'comment')"
                      >✕</button>
                    </span>
                  </div>
                  <div class="composer__row">
                    <div class="sp"></div>
                    <button
                      class="btn btn--sm btn--primary"
                      type="submit"
                      :disabled="isBlank(commentDraft) || posting"
                    >
                      Post
                    </button>
                  </div>
                </div>
              </form>
            </div>

            <div v-else-if="issue" class="hist">
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
            <div class="prop" :class="{ 'is-fresh': fresh.has('status') }">
              <span class="prop__k">Status</span>
              <select
                class="input input--sm"
                :value="shownStateId"
                @change="setProp({ stateId: ($event.target as HTMLSelectElement).value })"
              >
                <option v-for="s in board.states" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
            </div>
            <div class="prop" :class="{ 'is-fresh': fresh.has('priority') }">
              <span class="prop__k">Priority</span>
              <select
                class="input input--sm"
                :value="shownPriority"
                @change="setProp({ priority: ($event.target as HTMLSelectElement).value as Priority })"
              >
                <option v-for="p in PRIORITIES" :key="p" :value="p">{{ p }}</option>
              </select>
            </div>
            <div class="prop" :class="{ 'is-fresh': fresh.has('assignee') }">
              <span class="prop__k">Assignee</span>
              <select
                class="input input--sm"
                :value="shownAssignee ?? ''"
                @change="setProp({ assigneeId: ($event.target as HTMLSelectElement).value || null })"
              >
                <option value="">—</option>
                <option v-for="p in people" :key="p.id" :value="p.id">
                  {{ p.fullName || p.login }}
                </option>
              </select>
            </div>
            <div class="prop" :class="{ 'is-fresh': fresh.has('due') }">
              <span class="prop__k">Due</span>
              <!-- A date that has gone by says so by being red; there is no word for it anywhere else. -->
              <input
                class="input input--sm"
                :class="{ 'is-late': dueLabel(shownDue)?.late }"
                type="date"
                :value="shownDue ?? ''"
                @change="setProp({ dueDate: ($event.target as HTMLInputElement).value || null })"
              />
            </div>

            <div class="hr"></div>

            <div class="prop prop--tall" :class="{ 'is-fresh': fresh.has('tags') }">
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

            <template v-if="issue">
              <div class="hr"></div>

              <div class="prop">
                <span class="prop__k">Author</span>
                <span class="pv pv--ro">{{ issue.author?.login ?? '—' }}</span>
              </div>
              <div class="prop">
                <span class="prop__k">Created</span>
                <span class="pv pv--ro stamp">{{ stamp(issue.createdAt) }}</span>
              </div>
            </template>
          </aside>
        </div>

        <div v-if="error" class="err iv__err">{{ error }}</div>
      </section>

      <Dialog v-if="deleting" :title="`Delete ${issueKey}`" @close="deleting = false">
        <p class="iv__lede">This takes its comments, files and history with it. This cannot be undone.</p>
        <template #footer>
          <button class="btn" type="button" @click="deleting = false">Cancel</button>
          <button class="btn btn--danger" type="button" @click="removeIssue">Delete issue</button>
        </template>
      </Dialog>
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
  /* The window is the screen, less the scrim's gutter: an issue with nothing in it yet is the same window as one with a year of history behind it. */
  height: 100%;
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
/* The theme lets a dialog's title span take the whole bar; here the key and the status are two labels that belong side by side. */
.iv__key,
.iv__state {
  flex: 0 0 auto;
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
.iv__body :deep(p:last-child) {
  margin-bottom: 0;
}
/* The buttons belong to the field above them, not stuck to its edge. */
.rt + .composer__row {
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
.cm__body :deep(p:last-child) {
  margin-bottom: 0;
}
/* A pushpin drawn rather than written: the theme speaks in glyphs, and a word in the middle of a name line reads as part of the name. */
.cm__pin {
  flex: none;
  color: var(--accent);
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
.att__row a,
.att__name {
  flex: 1;
  color: var(--text);
  text-decoration: none;
}
.att__row--wait {
  border-style: dashed;
}
.cm__files {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px;
  margin-top: 8px;
}
.cm__shot {
  display: block;
  width: 160px;
  border: 1px solid var(--line);
}
.cm__shot img {
  display: block;
  width: 100%;
  height: 100px;
  object-fit: cover;
}
/* The clip sits among the toolbar's own buttons and behaves like one. */
.rt__clip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 24px;
  min-width: 26px;
  color: var(--text-dim);
  cursor: pointer;
}
.rt__clip:hover {
  color: var(--text);
  background: var(--surface);
}
.cm__waiting {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
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
.iv__lede {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-dim);
}
</style>
