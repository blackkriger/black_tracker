<script setup lang="ts">
// One issue, opened over the board it lives on: the text on the left, what it is on the right, and underneath it everything that has been said and done about it. Every edit is its own small write — there is no Save for the issue as a whole.
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import Dialog from './Dialog.vue';
import ImageViewer from './ImageViewer.vue';
import RichText from './RichText.vue';
import { TAB_ID, api } from '../lib/api';
import { asHtml, isBlank } from '../lib/richtext';
import { buddyAvatarStyle } from '../lib/avatar';
import { useLive } from '../lib/live';
import FileViewer from './FileViewer.vue';
import FileWall from './FileWall.vue';
import Select from './Select.vue';
import { canRead } from '../lib/files';
import { usePeople } from '../lib/people';
import { useFocus } from '../lib/focus';
import { useNotices } from '../lib/notices';
import { useSession } from '../lib/session';
import {
  ArrowDown,
  ArrowUp,
  FileArchive,
  FileDown,
  Link2,
  Paperclip,
  Pencil,
  Pin,
  SmilePlus,
  Star,
  Trash2,
  X,
} from 'lucide-vue-next';
import {
  PRIORITIES,
  dueLabel,
  MAX_FILE_BYTES,
  REACTIONS,
  commentOrder,
  fileSize,
  priorityColor,
  stampAt,
  type Attachment,
  type Comment,
  type Issue,
  type IssueFull,
  type IssueLink,
  type IssueTag,
  type CommentOrder,
  type Priority,
  type Shot,
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
  /** Every board of the project, so an issue can be moved to another one. */
  boards: { id: string; name: string; slug: string }[];
  tags: IssueTag[];
  /** The project's key, which is what a tag made here can be scoped to. */
  project: string;
  /** What the issue being written will be called once it exists. */
  nextKey?: string;
  /** A comment to scroll to and light up, when the window was opened by a notice. */
  focusComment?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'changed', issue: Issue): void;
  (e: 'created', issue: Issue): void;
  (e: 'deleted', id: string): void;
  (e: 'tagCreated', tag: IssueTag): void;
  (e: 'moved', boardId: string): void;
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
const { people, colorOf, colorOfId, load: loadPeople } = usePeople();
const { load: readNotices } = useNotices();
const { wanted, pending: askedFor } = useFocus();

const tab = ref<'comments' | 'history'>('comments');
const order = ref<CommentOrder>(commentOrder.get());

// Pinned first whichever way the rest reads.
const thread = computed(() =>
  [...(issue.value?.comments ?? [])].sort(
    (a, b) =>
      Number(!!b.pinnedAt) - Number(!!a.pinnedAt) ||
      (order.value === 'oldest'
        ? a.createdAt.localeCompare(b.createdAt)
        : b.createdAt.localeCompare(a.createdAt))
  )
);

function flipOrder(): void {
  order.value = order.value === 'oldest' ? 'newest' : 'oldest';
  commentOrder.set(order.value);
}

// The title and the description are the issue's text: they are edited together, deliberately, and saved in one write.
const editing = ref(false);
const saving = ref(false);
const titleDraft = ref('');
const bodyDraft = ref('');

// Linking: the chain opens a small window that searches by key or by title, and the pair is all that is stored.
const picking = ref(false);
const linkQuery = ref('');
const linkResults = ref<IssueLink[]>([]);
const searching = ref(false);
const linking = ref(false);
const pendingLinks = ref<IssueLink[]>([]);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

// What is shown beside the chain: the issue's links, or the ones a new issue will be given.
const shownLinks = computed(() => (creating.value ? pendingLinks.value : (issue.value?.links ?? [])));

watch(linkQuery, (term) => {
  if (searchTimer) clearTimeout(searchTimer);
  const q = term.trim();
  if (!q) {
    linkResults.value = [];
    return;
  }
  // A keystroke is not a query: the search waits for the typing to stop.
  searchTimer = setTimeout(async () => {
    searching.value = true;
    try {
      const rows = await api<IssueLink[]>(
        `/issues/search?q=${encodeURIComponent(q)}&exclude=${issue.value?.id ?? ''}`
      );
      const already = new Set(shownLinks.value.map((l) => l.id));
      linkResults.value = rows.filter((r) => !already.has(r.id));
    } catch {
      linkResults.value = [];
    } finally {
      searching.value = false;
    }
  }, 200);
});

function openPicker(): void {
  picking.value = true;
  linkQuery.value = '';
  linkResults.value = [];
}

const commentDraft = ref('');
// What was typed and not posted, kept per issue in this browser. It is a draft, not a
// record: nobody else needs it and it never reaches the server.
const DRAFTS = 'tracker:draft:';
// An issue being written is kept the same way, one per board: what you were starting on
// that board is what comes back when you open a new issue there again.
const NEW_DRAFTS = 'tracker:new:';
let keptDraft = '';
const draftSaved = ref(false);
let draftNote: ReturnType<typeof setTimeout> | null = null;

function readNew(): { summary: string; description: string } | null {
  try {
    const kept = localStorage.getItem(NEW_DRAFTS + props.board.id);
    return kept ? (JSON.parse(kept) as { summary: string; description: string }) : null;
  } catch {
    return null;
  }
}

function writeNew(summary: string, description: string): void {
  try {
    if (summary || description) {
      localStorage.setItem(NEW_DRAFTS + props.board.id, JSON.stringify({ summary, description }));
    } else {
      localStorage.removeItem(NEW_DRAFTS + props.board.id);
    }
  } catch {
    /* a browser that refuses storage simply keeps no draft */
  }
}

function keepNew(): void {
  if (!creating.value) return;
  writeNew(titleDraft.value.trim(), isBlank(bodyDraft.value) ? '' : bodyDraft.value);
}

function readDraft(): string {
  if (!props.issueKey) return '';
  try {
    return localStorage.getItem(DRAFTS + props.issueKey) ?? '';
  } catch {
    return '';
  }
}

function writeDraft(text: string): void {
  if (!props.issueKey) return;
  try {
    if (text) localStorage.setItem(DRAFTS + props.issueKey, text);
    else localStorage.removeItem(DRAFTS + props.issueKey);
  } catch {
    /* a browser that refuses storage simply keeps no draft */
  }
}

// On the way out of the field, and only when there is something new to keep.
function keepDraft(): void {
  if (!props.issueKey) return;
  const text = isBlank(commentDraft.value) ? '' : commentDraft.value;
  if (text === keptDraft) return;
  keptDraft = text;
  writeDraft(text);
  if (!text) return;
  draftSaved.value = false;
  if (draftNote) clearTimeout(draftNote);
  void nextTick(() => {
    draftSaved.value = true;
    draftNote = setTimeout(() => (draftSaved.value = false), 2400);
  });
}
const composer = ref<InstanceType<typeof RichText> | null>(null);

// Selecting text inside a comment raises a small bar over it: copy what is highlighted, or answer it with a quote. It fades when the cursor wanders off and is gone once the selection is.
const popup = ref<{ x: number; y: number; commentId: string; above: boolean } | null>(null);
const popupNear = ref(true);

function commentUnder(node: Node | null): string | null {
  let el = node ? (node.nodeType === 1 ? (node as HTMLElement) : node.parentElement) : null;
  while (el) {
    if (el.id.startsWith('comment-')) return el.id.slice('comment-'.length);
    el = el.parentElement;
  }
  return null;
}

function onMouseUp(): void {
  // After the mouse is up the browser still has the old selection for a tick.
  setTimeout(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      popup.value = null;
      return;
    }
    const commentId = commentUnder(sel.anchorNode);
    if (!commentId) {
      popup.value = null;
      return;
    }
    const box = sel.getRangeAt(0).getBoundingClientRect();
    if (!box.width && !box.height) {
      popup.value = null;
      return;
    }
    // Below the selection when there is no room above it, so it is never drawn off the top of the window.
    const above = box.top > 48;
    popup.value = {
      x: box.left + box.width / 2,
      y: above ? box.top : box.bottom,
      commentId,
      above,
    };
    popupNear.value = true;
  }, 0);
}

function onMouseDownAnywhere(ev: MouseEvent): void {
  if (reacting.value) {
    const set = document.getElementById('react-set');
    const inside = set && ev.target instanceof Node && set.contains(ev.target);
    // The button that opened it handles its own press, so only the rest of the page closes it.
    if (!inside && !(ev.target instanceof Element && ev.target.closest('.react__hold'))) {
      reacting.value = null;
    }
  }
  if (!popup.value) return;
  const bar = document.getElementById('sel-bar');
  if (bar && ev.target instanceof Node && bar.contains(ev.target)) return;
  popup.value = null;
}

/** How far the pointer is from a box, zero anywhere inside it. */
function away(ev: MouseEvent, box: DOMRect): number {
  const dx = ev.clientX < box.left ? box.left - ev.clientX : Math.max(0, ev.clientX - box.right);
  const dy = ev.clientY < box.top ? box.top - ev.clientY : Math.max(0, ev.clientY - box.bottom);
  return Math.max(dx, dy);
}

// Walk away from it and it fades; come back and it returns. Distance to the box, with room around it.
function onMouseMove(ev: MouseEvent): void {
  if (reacting.value) {
    const set = document.getElementById('react-set');
    if (set) reactNear.value = away(ev, set.getBoundingClientRect()) <= 80;
  }
  if (!popup.value) return;
  const bar = document.getElementById('sel-bar');
  if (!bar) return;
  popupNear.value = away(ev, bar.getBoundingClientRect()) <= 80;
}

function copySelection(): void {
  const text = window.getSelection()?.toString() ?? '';
  if (text) void navigator.clipboard.writeText(text).catch(() => {});
  window.getSelection()?.removeAllRanges();
  popup.value = null;
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);

// A reply is the quoted words, then the author's name, then room to write. Several replies stack in one comment rather than replacing each other.
function replyToSelection(): void {
  const id = popup.value?.commentId;
  const c = issue.value?.comments.find((row) => row.id === id);
  popup.value = null;
  if (!c) return;
  const picked = window.getSelection()?.toString().trim() ?? '';
  const source = picked || c.text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
  const quote = escapeHtml(source).replace(/\n/g, '<br>');
  // The quote, then who is being answered, then a space to carry on from — Quill drops a trailing empty paragraph, so the space is what holds the caret's place.
  commentDraft.value = `${commentDraft.value}<blockquote>${quote}</blockquote><p>@${c.author.login}&nbsp;</p>`;
  window.getSelection()?.removeAllRanges();
  void nextTick().then(() => composer.value?.focus(true));
}
const posting = ref(false);
const editingComment = ref<string | null>(null);
const commentEdit = ref('');

// Fields somebody else changed a moment ago, lit for as long as the animation runs.
const fresh = ref<Set<string>>(new Set());
// The comment a notice pointed at: shown, scrolled to and lit the same way a change is.
const litComment = ref<string | null>(null);

watch(() => props.focusComment, lookAtComment);
// Asked for again while the window is already open: the same comment, a new asking.
watch(wanted, (w) => {
  if (w) void lookAtComment(w.comment);
});

/** Waits for the pictures in the window, which land after the text and push it about. */
function settled(): Promise<void> {
  const shots = [...document.querySelectorAll<HTMLImageElement>('.iv img')].filter(
    (img) => !img.complete
  );
  if (!shots.length) return Promise.resolve();
  return new Promise((done) => {
    let left = shots.length;
    const tick = (): void => {
      if (--left <= 0) done();
    };
    for (const img of shots) {
      img.addEventListener('load', tick, { once: true });
      img.addEventListener('error', tick, { once: true });
    }
    // However slow they are, the comment is reached in the end.
    setTimeout(done, 1500);
  });
}

async function lookAtComment(id?: string): Promise<void> {
  if (!id) return;
  tab.value = 'comments';
  await nextTick();
  await settled();
  await nextTick();
  const el = document.getElementById(`comment-${id}`);
  if (!el) return;
  // The wall of files repacks a frame or two after the window draws, and a cached picture
  // gives it no time to settle before this runs; the place is taken again as it moves.
  const bring = (): void => el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  bring();
  setTimeout(bring, 150);
  setTimeout(bring, 500);
  litComment.value = id;
  setTimeout(() => {
    if (litComment.value === id) litComment.value = null;
  }, 2000);
}

// The names the server sends for what changed, in the names this screen knows them by.
const FIELD_OF: Record<string, string> = {
  summary: 'summary',
  description: 'description',
  stateId: 'status',
  status: 'status',
  boardId: 'board',
  board: 'board',
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

// The two walls of waiting files pack themselves: blocks keep their own heights and drop into whichever column is shortest.
// Every picture on the issue, in the order they are shown, and which one the viewer has open.
const shown = ref<number | null>(null);
const gallery = computed(() => [
  ...(issue.value?.attachments ?? [])
    .filter((a) => a.mime.startsWith('image/'))
    .map((a) => ({ src: `/api/attachments/${a.id}`, name: a.filename })),
  ...[...pending.value, ...commentFiles.value]
    .filter((f) => f.type.startsWith('image/'))
    .map((f) => ({ src: previewOf(f) ?? '', name: f.name })),
]);

const stateChoices = computed(() =>
  props.board.states.map((s) => ({ value: s.id, label: s.name, color: s.color }))
);
const priorityChoices = PRIORITIES.map((p) => ({ value: p, label: p, color: priorityColor(p) }));
// A name is written in the colour of the role that wears it.
const assigneeChoices = computed(() => [
  { value: '', label: '—' },
  ...people.value.map((p) => ({ value: p.id, label: p.fullName || p.login, color: p.roleColor })),
]);
const boardChoices = computed(() => props.boards.map((b) => ({ value: b.id, label: b.name })));
// The last entry is not a tag but the way to make one.
const tagChoices = computed(() => [
  ...freeTags.value.map((t) => ({ value: t.id, label: t.name, color: t.color })),
  { value: 'new', label: 'New tag…' },
]);

const shotOfFile = (f: File): Shot => ({
  key: keyOf(f),
  src: previewOf(f) ?? '',
  name: f.name,
  size: f.size,
});
const shotOfAttachment = (a: Attachment): Shot => ({
  key: a.id,
  src: `/api/attachments/${a.id}`,
  name: a.filename,
  size: a.size,
});

const issueShots = computed(() => images.value.map(shotOfAttachment));
const pendingShots = computed(() => pending.value.filter(previewOf).map(shotOfFile));
const commentShots = computed(() => commentFiles.value.filter(previewOf).map(shotOfFile));
const shotsOf = (commentId: string): Shot[] =>
  filesOf(commentId)
    .filter((a) => a.mime.startsWith('image/'))
    .map(shotOfAttachment);

// The walls hand back the key they were given; which list it belongs to is this side's business.
function openPending(key: string, from: 'issue' | 'comment'): void {
  const file = (from === 'issue' ? pending.value : commentFiles.value).find(
    (f) => keyOf(f) === key
  );
  if (file) shown.value = galleryOfFile(file);
}

function dropPendingKey(key: string, from: 'issue' | 'comment'): void {
  const file = (from === 'issue' ? pending.value : commentFiles.value).find(
    (f) => keyOf(f) === key
  );
  if (file) dropPending(file, from);
}

function removeAttachmentKey(id: string): void {
  const a = (issue.value?.attachments ?? []).find((row) => row.id === id);
  if (a) void removeAttachment(a);
}

const galleryOfFile = (file: File): number =>
  gallery.value.findIndex((g) => g.src === previewOf(file));
const galleryIndex = (id: string): number =>
  gallery.value.findIndex((g) => g.src === `/api/attachments/${id}`);
const deleting = ref(false);

const shownStateId = computed(() => (creating.value ? draft.value.stateId : issue.value?.stateId));
const shownPriority = computed(() =>
  creating.value ? draft.value.priority : (issue.value?.priority ?? 'Normal')
);
const shownAssignee = computed(() =>
  creating.value ? draft.value.assigneeId : (issue.value?.assignee?.id ?? null)
);
const shownDue = computed(() => (creating.value ? draft.value.dueDate : (issue.value?.dueDate ?? null)));
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
const ownBytes = computed(() => own.value.reduce((all, a) => all + a.size, 0));
const images = computed(() => own.value.filter((a) => a.mime.startsWith('image/')));
const files = computed(() => own.value.filter((a) => !a.mime.startsWith('image/')));
const filesOf = (commentId: string) =>
  (issue.value?.attachments ?? []).filter((a) => a.commentId === commentId);
const bytesOf = (commentId: string) =>
  filesOf(commentId).reduce((all, a) => all + a.size, 0);

// The file being read over the issue, if any: a name that can be read opens the reader,
// and every other way of reaching it still downloads it.
const reading = ref<{ id: string; name: string } | null>(null);

function onFileClick(ev: MouseEvent, a: Attachment): void {
  if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
  if (!canRead(a.filename)) return;
  ev.preventDefault();
  reading.value = { id: a.id, name: a.filename };
}

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key !== 'Escape') return;
  // Anything opened over this window answers Escape first; only when nothing is does it close the issue.
  if (deleting.value || picking.value || makingTag.value || shown.value !== null) return;
  if (reading.value) return;
  if (creating.value || !editing.value) emit('close');
  else editing.value = false;
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('mousedown', onMouseDownAnywhere);
  window.addEventListener('mousemove', onMouseMove);
  void loadPeople();
});
onUnmounted(() => {
  for (const url of previewUrls.values()) URL.revokeObjectURL(url);
  previewUrls.clear();
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('mouseup', onMouseUp);
  window.removeEventListener('mousedown', onMouseDownAnywhere);
  window.removeEventListener('mousemove', onMouseMove);
});

watch(() => props.issueKey, load, { immediate: true });

// The issue is being read by more than one person: what they do to it lands here as it happens.
useLive((ev) => {
  const current = issue.value;
  if (!current || ev.issueId !== current.id) return;
  if (ev.type === 'issue.deleted') {
    // Someone deleted it while it was open; there is nothing left to read.
    emit('close');
    return;
  }
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
    const kept = readNew();
    titleDraft.value = kept?.summary ?? '';
    bodyDraft.value = kept?.description ?? '';
    editing.value = true;
    loading.value = false;
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    issue.value = await api<IssueFull>(`/issues/${encodeURIComponent(props.issueKey)}`);
    keptDraft = readDraft();
    if (keptDraft) commentDraft.value = keptDraft;
    void lookAtComment(askedFor() ?? props.focusComment);
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
// A board owns its columns, so an issue arriving on another one cannot keep the status it wore: it lands in that board's default column, and the window follows it there.
async function moveBoard(boardId: string): Promise<void> {
  const current = issue.value;
  if (!current || boardId === current.boardId) return;
  if (await patch({ boardId })) emit('moved', boardId);
}

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
    writeNew('', '');
    if (pendingLinks.value.length) {
      for (const link of pendingLinks.value) {
        try {
          await api(`/issues/${made.id}/links`, { method: 'POST', body: { key: link.key } });
        } catch (err) {
          error.value = err instanceof Error ? err.message : 'The issue was created without a link.';
        }
      }
      pendingLinks.value = [];
    }
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

async function toggleFavourite(): Promise<void> {
  const current = issue.value;
  if (!current) return;
  const next = !current.favourite;
  issue.value = { ...current, favourite: next };
  try {
    await api(`/issues/${current.id}/favourite`, { method: 'PUT', body: { favourite: next } });
    emit('changed', { ...current, favourite: next });
  } catch (err) {
    issue.value = { ...(issue.value as IssueFull), favourite: current.favourite };
    error.value = err instanceof Error ? err.message : 'Could not change the star.';
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
  if (!summary) {
    error.value = 'An issue needs a title.';
    return;
  }
  const body: Record<string, unknown> = {};
  if (summary !== current.summary) body.summary = summary;
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

const makingTag = ref(false);
const newTagName = ref('');
const newTagScope = ref('project');
const tagBusy = ref(false);
const tagError = ref<string | null>(null);

// The picker never keeps what was picked: the tag it named is worn a moment later, or a dialog is open over it.
function pickTag(chosen: string): void {
  if (!chosen) return;
  if (chosen !== 'new') {
    toggleTag(chosen, true);
    return;
  }
  newTagName.value = '';
  newTagScope.value = 'project';
  tagError.value = null;
  makingTag.value = true;
}

async function createTag(): Promise<void> {
  const name = newTagName.value.trim();
  if (!name || tagBusy.value) return;
  tagBusy.value = true;
  tagError.value = null;
  try {
    const created = await api<IssueTag>('/tags', {
      method: 'POST',
      body: newTagScope.value === 'global' ? { name } : { name, project: props.project },
    });
    // The board keeps the list this window reads from, so it hears about the new one before it is worn.
    emit('tagCreated', created);
    makingTag.value = false;
    toggleTag(created.id, true);
  } catch (err) {
    tagError.value = err instanceof Error ? err.message : 'Could not create the tag.';
  } finally {
    tagBusy.value = false;
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
    // The comment is posted first because a file has to hang off something, and nothing is shown until its files are up: half a comment on screen is worse than a moment's wait. If the files fail the comment still exists, so it is shown anyway and only the files are complained about.
    if (commentFiles.value.length) {
      try {
        await sendFiles(current.id, commentFiles.value, created.id);
      } catch (err) {
        error.value = err instanceof Error ? err.message : 'The comment was posted without the files.';
      }
      commentFiles.value = [];
    }
    const now = issue.value ?? current;
    if (!now.comments.some((row) => row.id === created.id)) {
      issue.value = { ...now, comments: [...now.comments, created] };
    }
    commentDraft.value = '';
    keptDraft = '';
    writeDraft('');
    // A name in what was just posted is waiting for somebody, this tab's own reader included.
    void readNotices();
    // The record gained a line; the history tab is looking at the old one until it is read again.
    await reload();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not post the comment.';
  } finally {
    posting.value = false;
  }
}

async function saveComment(c: Comment): Promise<void> {
  const text = commentEdit.value;
  const current = issue.value;
  if (!current) return;
  if (isBlank(text) || text === c.text) {
    editingComment.value = null;
    return;
  }
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
    editingComment.value = null;
    void readNotices();
    await reload();
  } catch (err) {
    // The editor stays open with the text still in it; closing it would throw the words away.
    error.value = err instanceof Error ? err.message : 'Could not save the comment.';
  }
}

async function addLink(key: string): Promise<void> {
  if (!key || linking.value) return;
  if (creating.value) {
    // Nothing to link to yet: the pair is made the moment the issue is.
    const found = linkResults.value.find((r) => r.key === key);
    if (found) pendingLinks.value = [...pendingLinks.value, found];
    picking.value = false;
    return;
  }
  const current = issue.value;
  if (!current) return;
  linking.value = true;
  error.value = null;
  try {
    const made = await api<IssueLink>(`/issues/${current.id}/links`, {
      method: 'POST',
      body: { key },
    });
    const now = issue.value ?? current;
    issue.value = { ...now, links: [...now.links, made] };
    picking.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not link them.';
  } finally {
    linking.value = false;
  }
}

async function removeLink(link: IssueLink): Promise<void> {
  if (creating.value) {
    pendingLinks.value = pendingLinks.value.filter((l) => l.id !== link.id);
    return;
  }
  const current = issue.value;
  if (!current) return;
  error.value = null;
  try {
    await api(`/issues/${current.id}/links/${link.id}`, { method: 'DELETE' });
    const now = issue.value ?? current;
    issue.value = { ...now, links: now.links.filter((l) => l.id !== link.id) };
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not unlink them.';
  }
}

// A nod at what somebody wrote. Clicking one that is already yours takes it back.
const reacting = ref<string | null>(null);
const reactNear = ref(true);
// Held over the whole page rather than inside the comment: the list of comments scrolls,
// and anything hanging out of it would be cut off at the edge.
const reactAt = ref({ x: 0, y: 0 });
const reactingOn = computed(
  () => issue.value?.comments.find((c) => c.id === reacting.value) ?? null
);

function openReactions(c: Comment, ev: MouseEvent): void {
  if (reacting.value === c.id) {
    reacting.value = null;
    return;
  }
  const box = (ev.currentTarget as HTMLElement).getBoundingClientRect();
  reactAt.value = { x: box.left + box.width / 2, y: box.top };
  reactNear.value = true;
  reacting.value = c.id;
}

interface Nod {
  emoji: string;
  n: number;
  mine: boolean;
  who: string;
}

function reactionsOf(c: Comment): Nod[] {
  const me = session.me.value?.login;
  const byEmoji = new Map<string, Nod & { names: string[] }>();
  for (const r of c.reactions ?? []) {
    const found = byEmoji.get(r.emoji) ?? { emoji: r.emoji, n: 0, mine: false, who: '', names: [] };
    found.n += 1;
    found.names.push(r.by);
    if (r.by === me) found.mine = true;
    byEmoji.set(r.emoji, found);
  }
  return [...byEmoji.values()].map((r) => ({ ...r, who: r.names.join(', ') }));
}

async function react(c: Comment, emoji: string): Promise<void> {
  reacting.value = null;
  error.value = null;
  try {
    await api(`/comments/${c.id}/reactions`, { method: 'PUT', body: { emoji } });
    void readNotices();
    await reload();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not react.';
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
    issue.value = {
      ...now,
      comments: now.comments.map((row) =>
        row.id === c.id ? { ...row, pinnedAt: updated.pinnedAt, pinnedBy: updated.pinnedBy } : row
      ),
    };
    await reload();
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
    void readNotices();
    await reload();
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
/** Splits what was chosen into what will fit and what will not, and says so about the rest. */
function accept(list: FileList | null): File[] {
  const chosen = list ? Array.from(list) : [];
  const tooBig = chosen.filter((f) => f.size > MAX_FILE_BYTES);
  if (tooBig.length) {
    error.value = `${tooBig.map((f) => f.name).join(', ')} — 10mb max for file`;
  }
  return chosen.filter((f) => f.size <= MAX_FILE_BYTES);
}

async function upload(list: FileList | null): Promise<void> {
  dragOver.value = false;
  const chosen = accept(list);
  if (!chosen.length) return;
  if (creating.value || !issue.value) {
    pending.value = [...pending.value, ...chosen];
    return;
  }
  uploading.value = true;
  try {
    await sendFiles(issue.value.id, chosen);
    await reload();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not upload the file.';
  } finally {
    uploading.value = false;
  }
}

// A preview lives as long as the window does: the url is made once per file and released when the window closes.
const previewUrls = new Map<File, string>();

function previewOf(file: File): string | null {
  if (!file.type.startsWith('image/')) return null;
  let url = previewUrls.get(file);
  if (!url) {
    url = URL.createObjectURL(file);
    previewUrls.set(file, url);
  }
  return url;
}

function forgetPreview(file: File): void {
  const url = previewUrls.get(file);
  if (url) {
    URL.revokeObjectURL(url);
    previewUrls.delete(file);
  }
}

// Files are told apart by identity, not by name: two screenshots pasted a minute apart are both "image.png".
const fileKeys = new WeakMap<File, string>();
let nextFileKey = 1;

function keyOf(file: File): string {
  let key = fileKeys.get(file);
  if (!key) {
    key = `f${nextFileKey++}`;
    fileKeys.set(file, key);
  }
  return key;
}

function dropPending(file: File, from: 'issue' | 'comment'): void {
  const list = from === 'issue' ? pending : commentFiles;
  forgetPreview(file);
  list.value = list.value.filter((f) => f !== file);
}

function pickCommentFiles(list: FileList | null): void {
  const chosen = accept(list);
  if (chosen.length) commentFiles.value = [...commentFiles.value, ...chosen];
}

// A comment being edited can be given more files; they belong to a comment that already exists, so they go straight up.
async function addToComment(commentId: string, list: FileList | null): Promise<void> {
  const chosen = accept(list);
  if (!chosen.length || !issue.value) return;
  uploading.value = true;
  try {
    await sendFiles(issue.value.id, chosen, commentId);
    await reload();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not upload the file.';
  } finally {
    uploading.value = false;
  }
}

async function removeAttachment(a: Attachment): Promise<void> {
  const current = issue.value;
  if (!current) return;
  try {
    await api(`/attachments/${a.id}`, { method: 'DELETE' });
    const now = issue.value ?? current;
    issue.value = { ...now, attachments: now.attachments.filter((row) => row.id !== a.id) };
    await reload();
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
          <button
            class="btn btn--sm btn--icon btn--ghost"
            type="button"
            aria-label="Close"
            @click="emit('close')"
          >
            <X class="ic" />
          </button>
          <div class="sp"></div>
          <span class="iv__path">
            <span class="key iv__where">{{ project }}</span>
            <span class="iv__sep">/</span>
            <span class="iv__where">{{ board.name }}</span>
            <span class="iv__sep">/</span>
            <span class="key iv__key">{{ issueKey ?? nextKey ?? 'NEW ISSUE' }}</span>
          </span>
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
              class="btn btn--sm btn--icon btn--ghost iv__star"
              :class="{ 'is-on': issue?.favourite }"
              type="button"
              :title="issue?.favourite ? 'In favourites' : 'Add to favourites'"
              :aria-pressed="issue?.favourite === true"
              :disabled="!issue"
              @click="toggleFavourite"
            >
              <Star class="ic" :fill="issue?.favourite ? 'currentColor' : 'none'" />
            </button>
            <button
              class="btn btn--sm btn--icon btn--ghost"
              type="button"
              aria-label="Edit"
              :disabled="!issue"
              @click="startEditing"
            >
              <Pencil class="ic" />
            </button>
            <button
              class="btn btn--sm btn--icon btn--ghost iv__trash"
              type="button"
              title="Delete"
              aria-label="Delete"
              :disabled="!session.canDelete.value"
              @click="deleting = true"
            >
              <Trash2 class="ic" />
            </button>
          </template>
        </header>

        <!-- The same two columns, with a placeholder the size of every control that is coming. -->
        <div v-if="loading && !creating" class="iv">
          <div class="iv__main">
            <span class="sk sk--line" style="width: 46%; height: 29px"></span>
            <div>
              <span class="sk sk--line" style="width: 94%"></span>
              <span class="sk sk--line iv__sk-line" style="width: 82%"></span>
              <span class="sk sk--line iv__sk-line" style="width: 64%"></span>
            </div>
            <div class="sec-h links">
              <span class="sk sk--line" style="width: 14px; height: 14px"></span>
              <span class="sk sk--line" style="width: 74px; height: 24px"></span>
            </div>
            <span class="sk sk--line" style="height: 56px"></span>
            <div class="itabs">
              <span class="sk sk--line iv__sk-tab" style="width: 92px"></span>
              <span class="sk sk--line iv__sk-tab" style="width: 70px"></span>
            </div>
            <div class="iv__list">
              <div v-for="w in [190, 150]" :key="w" class="cm">
                <span class="sk sk--av"></span>
                <div>
                  <span class="sk sk--line" :style="{ width: `${w}px` }"></span>
                  <span class="sk sk--line iv__sk-line" style="width: 88%"></span>
                </div>
              </div>
            </div>
          </div>
          <aside class="props">
            <div v-for="n in 6" :key="n" class="prop">
              <span class="sk sk--line" style="width: 54px"></span>
              <span class="sk sk--line" style="height: 30px"></span>
            </div>
          </aside>
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
              @blur="keepNew"
              @keydown.enter.prevent="creating ? create() : saveText()"
            />
            <h1
              v-else
              class="iv__title iv__title--ro"
              :class="{ 'is-fresh': fresh.has('summary') }"
            >{{ issue?.summary }}</h1>

            <div>
              <RichText
                v-if="editing"
                v-model="bodyDraft"
                placeholder="What is this about?"
                @files="upload"
                @blur="keepNew"
              />
              <div
                v-else-if="issue?.description && !isBlank(issue.description)"
                class="md iv__body"
                :class="{ 'is-fresh': fresh.has('description') }"
                v-html="asHtml(issue.description)"
              ></div>
              <div v-else class="iv__body hint faint">Nothing written yet.</div>
            </div>

            <div :class="{ 'is-fresh': fresh.has('links') }">
              <div class="sec-h links">
                <Link2 class="ic links__icon" aria-hidden="true" />
                <RouterLink
                  v-for="l in shownLinks"
                  :key="l.id"
                  class="lk"
                  :to="`/${l.projectShort}/${l.boardSlug}/${l.key}`"
                  :title="`${l.summary} — ${l.stateName}`"
                >
                  <span class="key lk__key" :style="{ color: l.stateColor }">{{ l.key }}</span>
                </RouterLink>
                <span v-if="!shownLinks.length" class="hint faint">No links yet.</span>
                <div class="sp"></div>
                <button class="btn btn--sm btn--ghost" type="button" @click="openPicker">
                  Add link…
                </button>
              </div>
            </div>

            <div :class="{ 'is-fresh': fresh.has('files') }">
              <div v-if="own.length" class="sec-h">
                <Paperclip class="ic" aria-hidden="true" />
                <span>{{ own.length }} {{ own.length === 1 ? 'file' : 'files' }}, {{ fileSize(ownBytes) }}</span>
                <div class="sp"></div>
                <a
                  v-if="own.length > 1 && issue"
                  class="btn btn--sm btn--ghost"
                  :href="`/api/issues/${issue.id}/files.zip`"
                  download
                >Download all</a>
              </div>
              <div v-for="a in files" :key="a.id" class="att__cap att__row">
                <a
                  :href="`/api/attachments/${a.id}`"
                  target="_blank"
                  @click="onFileClick($event, a)"
                >{{ a.filename }}</a>
                <span class="stamp">{{ fileSize(a.size) }}</span>
                <a
                  class="btn btn--sm btn--icon btn--ghost"
                  :href="`/api/attachments/${a.id}`"
                  download
                  :aria-label="`Download ${a.filename}`"
                ><FileDown class="ic ic--sm" /></a>
                <button
                  class="btn btn--sm btn--icon btn--ghost"
                  type="button"
                  :aria-label="`Delete ${a.filename}`"
                  @click="removeAttachment(a)"
                ><X class="ic ic--sm" /></button>
              </div>
              <FileWall
                :shots="issueShots"
                removable
                @open="shown = galleryIndex($event)"
                @remove="removeAttachmentKey"
              />

              <!-- Chosen, not yet uploaded: anything that takes the whole row is listed first, and the pictures pack themselves underneath. -->
              <div
                v-for="f in pending.filter((x) => !previewOf(x))"
                :key="keyOf(f)"
                class="att__cap att__row att__row--wait"
              >
                <span class="att__name">{{ f.name }}</span>
                <span class="stamp">{{ fileSize(f.size) }}</span>
                <button
                  class="btn btn--sm btn--icon btn--ghost"
                  type="button"
                  :aria-label="`Remove ${f.name}`"
                  @click="dropPending(f, 'issue')"
                ><X class="ic ic--sm" /></button>
              </div>
              <FileWall
                :shots="pendingShots"
                removable
                waiting
                @open="openPending($event, 'issue')"
                @remove="dropPendingKey($event, 'issue')"
              />
              <label
                class="drop"
                :class="{ 'drop--idle': !dragOver, 'is-off': uploading }"
                @dragover.prevent="dragOver = true"
                @dragleave="dragOver = false"
                @drop.prevent="upload(($event as DragEvent).dataTransfer?.files ?? null)"
              >
                <input
                  type="file"
                  multiple
                  class="sr"
                  :disabled="uploading"
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
              <div class="sp"></div>
              <button
                v-if="tab === 'comments'"
                class="itab itab--order"
                type="button"
                :title="order === 'oldest' ? 'Oldest first' : 'Newest first'"
                @click="flipOrder"
              >
                <component :is="order === 'oldest' ? ArrowUp : ArrowDown" class="ic" />
              </button>
            </nav>

            <div
              v-if="issue && tab === 'comments'"
              class="iv__list"
              :class="{ 'is-fresh': fresh.has('comments') }"
            >
              <article
                v-for="c in thread"
                :id="`comment-${c.id}`"
                :class="{ 'is-fresh': litComment === c.id }"
                :key="c.id"
                class="cm"
              >
                <span class="av av--lg" :style="buddyAvatarStyle(c.author.login)"></span>
                <div>
                  <div class="cm__head">
                    <span class="cm__who" :style="{ color: colorOf(c.author.login) }">
                      {{ c.author.login }}
                    </span>
                    <time class="stamp">{{ stampAt(c.createdAt) }}</time>
                    <span v-if="c.editedAt" class="cm__edited">
                      edited
                      <span class="selbar cm__when">{{ stampAt(c.editedAt) }}</span>
                    </span>
                    <Pin
                      v-if="c.pinnedAt"
                      class="ic ic--sm cm__pin"
                      :aria-label="c.pinnedBy ? `Pinned by ${c.pinnedBy}` : 'Pinned'"
                    />
                    <span class="cm__acts">
                      <span class="cm__react">
                      <span v-for="r in reactionsOf(c)" :key="r.emoji" class="react__one">
                        <button
                          class="react"
                          :class="{ 'is-mine': r.mine }"
                          type="button"
                          @click="react(c, r.emoji)"
                        >{{ r.emoji }}<span class="react__n">{{ r.n }}</span></button>
                        <span class="selbar react__who">{{ r.who }}</span>
                      </span>
                        <button
                          class="btn btn--sm btn--icon btn--ghost react__hold"
                          type="button"
                          aria-label="React"
                          @click="openReactions(c, $event)"
                        ><SmilePlus class="ic ic--sm" /></button>
                      </span>
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
                    <RichText
                      v-model="commentEdit"
                      class="cm__edit"
                      min-height="90px"
                      @files="(list) => addToComment(c.id, list)"
                    >
                      <template #tools>
                        <label class="rt__clip" title="Attach files">
                          <input
                            type="file"
                            multiple
                            class="sr"
                            :disabled="uploading"
                            @change="addToComment(c.id, ($event.target as HTMLInputElement).files)"
                          />
                          <Paperclip class="ic" />
                        </label>
                      </template>
                    </RichText>
                    <div class="composer__row">
                      <div class="sp"></div>
                      <button class="btn btn--sm" type="button" @click="editingComment = null">Cancel</button>
                      <button class="btn btn--sm btn--primary" type="button" @click="saveComment(c)">Save</button>
                    </div>
                  </template>
                  <div v-else class="md cm__body" v-html="asHtml(c.text)"></div>

                  <div v-if="filesOf(c.id).length" class="cm__files">
                    <div v-if="filesOf(c.id).length > 1" class="att__cap att__row att__all">
                      <div></div>
                      <div class="att__all__what">
                        {{ filesOf(c.id).length }} files
                        <span class="stamp">{{ fileSize(bytesOf(c.id)) }}</span>
                      </div>
                      <div class="att__all__go">
                        <a
                          class="btn btn--sm btn--icon btn--ghost"
                          :href="`/api/comments/${c.id}/files.zip`"
                          download
                          aria-label="Download all"
                        ><FileArchive class="ic ic--sm" /></a>
                        <div class="selbar att__all__tip">Download all</div>
                      </div>
                    </div>
                    <span
                      v-for="a in filesOf(c.id).filter((x) => !x.mime.startsWith('image/'))"
                      :key="a.id"
                      class="att__cap att__row"
                    >
                      <a
                        :href="`/api/attachments/${a.id}`"
                        target="_blank"
                        @click="onFileClick($event, a)"
                      >{{ a.filename }}</a>
                      <span class="stamp">{{ fileSize(a.size) }}</span>
                      <a
                        class="btn btn--sm btn--icon btn--ghost"
                        :href="`/api/attachments/${a.id}`"
                        download
                        :aria-label="`Download ${a.filename}`"
                      ><FileDown class="ic ic--sm" /></a>
                      <button
                        v-if="editingComment === c.id"
                        class="btn btn--sm btn--icon btn--ghost"
                        type="button"
                        :aria-label="`Delete ${a.filename}`"
                        @click="removeAttachment(a)"
                      ><X class="ic ic--sm" /></button>
                    </span>
                    <FileWall
                      :shots="shotsOf(c.id)"
                      :removable="editingComment === c.id"
                      @open="shown = galleryIndex($event)"
                      @remove="removeAttachmentKey"
                    />
                  </div>
                </div>
              </article>

              <form class="cm" :class="{ 'cm--lead': order === 'newest' }" @submit.prevent="postComment">
                <span class="av av--lg" :style="buddyAvatarStyle(session.me.value?.login ?? '')"></span>
                <div>
                  <RichText
                    ref="composer"
                    v-model="commentDraft"
                    min-height="90px"
                    placeholder="Write a comment…"
                    :disabled="posting"
                    @files="pickCommentFiles"
                    @blur="keepDraft"
                  >
                    <template #tools>
                      <label class="rt__clip" title="Attach files">
                        <input
                          type="file"
                          multiple
                          class="sr"
                          @change="pickCommentFiles(($event.target as HTMLInputElement).files)"
                        />
                        <Paperclip class="ic" />
                      </label>
                    </template>
                  </RichText>
                  <div
                    v-for="f in commentFiles.filter((x) => !previewOf(x))"
                    :key="keyOf(f)"
                    class="att__cap att__row att__row--wait"
                  >
                    <span class="att__name">{{ f.name }}</span>
                    <span class="stamp">{{ fileSize(f.size) }}</span>
                    <button
                      class="btn btn--sm btn--icon btn--ghost"
                      type="button"
                      :aria-label="`Remove ${f.name}`"
                      :disabled="posting"
                      @click="dropPending(f, 'comment')"
                    ><X class="ic ic--sm" /></button>
                  </div>
                  <FileWall
                    :shots="commentShots"
                    :removable="!posting"
                    waiting
                    @open="openPending($event, 'comment')"
                    @remove="dropPendingKey($event, 'comment')"
                  />
                  <div class="composer__row">
                    <span v-if="draftSaved" class="composer__kept">Draft saved</span>
                    <div class="sp"></div>
                    <button
                      class="btn btn--sm btn--primary"
                      :class="{ 'is-busy': posting }"
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
                <span class="hi__who" :style="{ color: colorOf(h.by) }">{{ h.by }}</span>
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
            <template v-if="issue && boards.length > 1">
              <div class="prop prop--tall" :class="{ 'is-fresh': fresh.has('board') }">
                <span class="prop__k">Board</span>
                <div class="prop__stack">
                  <Select
                    :model-value="issue.boardId"
                    :options="boardChoices"
                    small
                    @update:model-value="moveBoard"
                  />
                  <span class="hint">Moving it resets the status.</span>
                </div>
              </div>
              <div class="hr"></div>
            </template>
            <div class="prop" :class="{ 'is-fresh': fresh.has('status') }">
              <span class="prop__k">Status</span>
              <Select
                :model-value="shownStateId ?? ''"
                :options="stateChoices"
                small
                @update:model-value="setProp({ stateId: $event })"
              />
            </div>
            <div class="prop" :class="{ 'is-fresh': fresh.has('priority') }">
              <span class="prop__k">Priority</span>
              <Select
                :model-value="shownPriority"
                :options="priorityChoices"
                small
                @update:model-value="setProp({ priority: $event as Priority })"
              />
            </div>
            <div class="prop" :class="{ 'is-fresh': fresh.has('assignee') }">
              <span class="prop__k">Assignee</span>
              <Select
                :model-value="shownAssignee ?? ''"
                :options="assigneeChoices"
                small
                @update:model-value="setProp({ assigneeId: $event || null })"
              />
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

            <!-- Nothing to wear and nothing to choose from: the row would only say the word Tags. -->
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
                  ><X class="ic ic--sm" /></button>
                </span>
                <Select
                  model-value=""
                  :options="tagChoices"
                  placeholder="Add tag…"
                  small
                  @update:model-value="pickTag"
                />
              </div>
            </div>

            <template v-if="issue">
              <div class="hr"></div>

              <div class="prop">
                <span class="prop__k">Author</span>
                <span class="pv pv--ro" :style="{ color: colorOfId(issue.author?.id) }">
                  {{ issue.author?.login ?? '—' }}
                </span>
              </div>
              <div class="prop">
                <span class="prop__k">Created</span>
                <span class="pv pv--ro stamp">{{ stampAt(issue.createdAt) }}</span>
              </div>
            </template>
          </aside>
        </div>

        <div v-if="error" class="err iv__err">{{ error }}</div>
      </section>

      <Dialog v-if="picking" title="Link an issue" :width="460" @close="picking = false">
        <div v-if="shownLinks.length" class="pick">
          <div v-for="l in shownLinks" :key="l.id" class="pick__line">
            <span class="key">{{ l.key }}</span>
            <span class="pick__sum">{{ l.summary }}</span>
            <button class="btn btn--sm btn--ghost" type="button" @click="removeLink(l)">Unlink</button>
          </div>
        </div>
        <div v-if="shownLinks.length" class="hr"></div>

        <input
          v-model="linkQuery"
          class="input"
          placeholder="Key or title…"
          autofocus
          @keydown.enter.prevent="linkResults[0] && addLink(linkResults[0].key)"
        />
        <div class="pick">
          <button
            v-for="r in linkResults"
            :key="r.id"
            class="pick__row"
            type="button"
            :disabled="linking"
            @click="addLink(r.key)"
          >
            <span class="key">{{ r.key }}</span>
            <span class="pick__sum">{{ r.summary }}</span>
            <span class="pick__state" :style="{ color: r.stateColor }">{{ r.stateName }}</span>
          </button>
          <p v-if="searching" class="hint">Searching…</p>
          <p v-else-if="linkQuery.trim() && !linkResults.length" class="hint">Nothing found.</p>
        </div>
      </Dialog>

      <Dialog v-if="makingTag" title="New tag" :width="420" @close="makingTag = false">
        <div class="field">
          <label class="label" for="tag-name">Name</label>
          <input
            id="tag-name"
            v-model="newTagName"
            class="input"
            maxlength="40"
            autofocus
            @keydown.enter.prevent="createTag"
          />
        </div>
        <div class="field">
          <label class="label" for="tag-scope">Scope</label>
          <Select
            id="tag-scope"
            v-model="newTagScope"
            :options="[
              { value: 'project', label: `${project} only` },
              { value: 'global', label: 'Global' },
            ]"
          />
        </div>
        <div v-if="tagError" class="err">{{ tagError }}</div>
        <template #footer>
          <div class="sp"></div>
          <button class="btn" type="button" @click="makingTag = false">Cancel</button>
          <button
            class="btn btn--primary"
            type="button"
            :disabled="tagBusy || !newTagName.trim()"
            @click="createTag"
          >
            Create
          </button>
        </template>
      </Dialog>

      <div
        v-if="reactingOn"
        id="react-set"
        class="selbar react__menu"
        :class="{ 'is-far': !reactNear }"
        :style="{ left: `${reactAt.x}px`, top: `${reactAt.y}px` }"
      >
        <button
          v-for="e in REACTIONS"
          :key="e"
          class="react"
          type="button"
          @click="react(reactingOn, e)"
        >{{ e }}</button>
      </div>

      <div
        v-if="popup"
        id="sel-bar"
        class="selbar"
        :class="{ 'is-far': !popupNear, 'is-below': !popup.above }"
        :style="{ left: `${popup.x}px`, top: `${popup.y}px` }"
      >
        <button type="button" @click="copySelection">Copy</button>
        <button type="button" @click="replyToSelection">Reply</button>
      </div>

      <ImageViewer v-model:index="shown" :images="gallery" />
      <FileViewer :file="reading" @close="reading = null" />

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
.iv__star.is-on {
  color: var(--accent);
}
/* It sits with the pencil and the close, and only says what it is when reached for. */
.iv__trash:hover:enabled {
  color: var(--danger-text);
}
.iv__key,
.iv__path {
  flex: 0 0 auto;
}
/* Where the issue lives, ahead of its key: the project, the board, then the card itself — one reading, so it keeps its own spacing rather than the header's. */
.iv__path {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.iv__where {
  font-size: 13px;
  color: var(--text-dim);
}
.iv__sep {
  font-size: 13px;
  color: var(--text-faint);
}
.iv__key {
  font-size: 13px;
}
.iv__sk-line {
  margin-top: 8px;
}
.iv__sk-tab {
  margin: 11px 12px;
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
/* The day and the clock ride together in the first column, so it is wider than the theme's default. */
.hi {
  grid-template-columns: 152px 96px minmax(0, 1fr);
}
/* Newest first puts the box you write in at the head of the thread, where the next comment will appear. */
.cm--lead {
  order: -1;
}
/* The one control in the tab row that is not a tab: it never carries the selected underline. */
.itab--order {
  font-size: 14px;
}
.iv__list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
/* Over the selection, out of the flow: it follows the highlight rather than the layout. One plate with two words on it — no buttons drawn inside a box drawn inside a box. */
.selbar.is-far {
  opacity: 0.25;
}
.selbar.is-below {
  transform: translate(-50%, 8px);
}
.selbar.is-below::before,
.selbar.is-below::after {
  top: auto;
  bottom: 100%;
  border-top-color: transparent;
}
.selbar.is-below::before {
  border-bottom-color: var(--line-2);
}
.selbar.is-below::after {
  margin-top: 0;
  margin-bottom: -1px;
  border-bottom-color: var(--card);
}
.cm__body :deep(blockquote) {
  margin: 0 0 8px;
  padding-left: 10px;
  border-left: 2px solid var(--line-2);
  color: var(--text-dim);
}
.cm__body :deep(p:last-child) {
  margin-bottom: 0;
}
/* A pushpin drawn rather than written: the theme speaks in glyphs, and a word in the middle of a name line reads as part of the name. */
.cm__pin {
  flex: none;
  color: var(--accent);
}
.att__row {
  height: 32px;
  border: 1px solid var(--line);
  margin-top: 8px;
}
.att__row a,
.att__name {
  flex: 0 1 auto;
  color: var(--text);
  text-decoration: none;
}
.att__row .stamp {
  flex: 0 0 auto;
  margin-right: auto;
}
.att__row--wait {
  border-style: dashed;
}
/* What the whole set weighs stands in the middle of the line, the way the viewer's bar
   holds its own middle: three columns of equal weight, the way out on the right. */
.att__all {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
}
.att__all__what {
  display: flex;
  align-items: center;
  gap: 10px;
}
.att__all__go {
  position: relative;
  display: inline-flex;
  justify-self: end;
}
/* Held over the icon by its right edge, not its middle: the icon is already at the end of
   the line, and a box centred on it would hang out past it. */
.att__all__tip {
  position: absolute;
  right: 0;
  bottom: 100%;
  display: none;
  padding: 5px 10px;
  transform: translateY(-8px);
  color: var(--text-dim);
  font-size: 12px;
  white-space: nowrap;
}
.att__all__go:hover .att__all__tip {
  display: block;
}
/* The box hangs by its right edge, so its pointer stands over the middle of the icon
   rather than the middle of the box. */
.att__all__tip::before,
.att__all__tip::after {
  left: auto;
  right: 7px;
  margin-left: 0;
}
/* One line: the chain, what it holds, and the way to add more. The keys are enough — the title rides in the tooltip. */
.links {
  flex-wrap: wrap;
  gap: 6px;
  height: auto;
  min-height: 26px;
}
.links__icon {
  flex: none;
  color: var(--text-muted);
}
.lk {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--line-2);
  text-decoration: none;
}
.lk:hover {
  background: var(--card-hover);
}
.lk__key {
  font-size: 11.5px;
}
.pick__line {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 32px;
  padding: 0 8px;
}
/* The search answers in rows that look like what they will become. */
.pick {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 320px;
  overflow-y: auto;
}
.pick__row {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 32px;
  padding: 0 8px;
  border: 1px solid transparent;
  background: none;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.pick__row:hover {
  border-color: var(--line-2);
  background: var(--card-hover);
}
.pick__sum {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.pick__state {
  font-size: 12px;
}
.cm__files {
  display: flex;
  flex-direction: column;
}
/* The nods stand in the line that names the author, before what can be done to the comment. */
.cm__react {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-right: 4px;
}
.react {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 4px;
  border: 0;
  background: none;
  color: var(--text-dim);
  font-size: 13px;
  cursor: pointer;
}
.react:hover {
  color: var(--text);
}
/* Yours is the one written in gold; nothing is framed. */
.react.is-mine .react__n {
  color: var(--accent);
}
/* Who nodded, held over the nod until the pointer leaves it. */
.react__one {
  position: relative;
  display: inline-flex;
}
.react__who {
  position: absolute;
  left: 50%;
  bottom: 100%;
  display: none;
  padding: 5px 10px;
  transform: translate(-50%, -8px);
  color: var(--text-dim);
  font-size: 12px;
  white-space: nowrap;
}
.react__one:hover .react__who {
  display: block;
}
.react__n {
  font: 11px var(--font-num);
}
.react__menu {
  gap: 4px;
  padding: 4px;
}
/* Said once, quietly, and gone: it is a reassurance, not a state. */
.composer__kept {
  color: var(--text-muted);
  font-size: 12px;
  animation: draft-fade 2.4s ease-in forwards;
}
@keyframes draft-fade {
  0%,
  55% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
/* Open for editing, the box stands off the name and the time above it. */
.cm__edit {
  margin-top: 8px;
}
/* The same box the selection puts up, held over the word until the pointer leaves it. */
.cm__edited {
  position: relative;
}
.cm__when {
  position: absolute;
  left: 50%;
  bottom: 100%;
  display: none;
  padding: 5px 10px;
  transform: translate(-50%, -8px);
  color: var(--text-dim);
  font: 12px var(--font-num);
  white-space: nowrap;
}
.cm__edited:hover .cm__when {
  display: block;
}
/* Nothing answers while a file is on its way up, so the same one cannot be sent twice. */
.drop.is-off {
  pointer-events: none;
  opacity: 0.6;
}
/* The pictures keep to themselves under the rows, each at thumbnail size. */
.cm__shots {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px;
  margin-top: 8px;
}
.cm__pic {
  position: relative;
  display: block;
}
/* Only while the comment is open for editing, and over the corner of the picture so the row keeps its shape. */
.cm__pic-x {
  position: absolute;
  top: 3px;
  right: 3px;
  background: var(--card);
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
.prop__stack {
  display: flex;
  flex-direction: column;
  gap: 4px;
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
