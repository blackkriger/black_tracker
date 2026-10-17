<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import Dialog from './Dialog.vue';
import ImageViewer from './ImageViewer.vue';
import RichText from './RichText.vue';
import { ApiError, TAB_ID, api } from '../lib/api';
import { asHtml, flipCheck, flipStrike, isBlank, trimBlank } from '../lib/richtext';
import { fromGoogleDoc } from '../lib/googleDoc';
import { forgetKeys, keyInfo, refreshKey } from '../lib/issueKeys';
import { buddyAvatarStyle } from '../lib/avatar';
import { useLive } from '../lib/live';
import FileViewer from './FileViewer.vue';
import FileWall from './FileWall.vue';
import Select from './Select.vue';
import { canRead, isPicture } from '../lib/files';
import { usePeople } from '../lib/people';
import { features } from '../lib/features';
import { here, issueViewers } from '../lib/presence';
import PersonName from './PersonName.vue';
import Viewers from './Viewers.vue';
import { useProjects } from '../lib/projects';
import { useFocus } from '../lib/focus';
import { useNotices } from '../lib/notices';
import { useSession } from '../lib/session';
import {
  ArrowDownWideNarrow,
  ArrowUp,
  ArrowUpNarrowWide,
  Bell,
  BellRing,
  Bot,
  ChevronDown,
  ChevronRight,
  FileArchive,
  FileDown,
  FileInput,
  GitCommitHorizontal,
  GitMerge,
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
  type LinkKind,
  type CommentOrder,
  type IssueCommit,
  type Priority,
  type Shot,
} from '../lib/issues';
import { ink } from '../lib/theme';

interface State {
  id: string;
  name: string;
  color: string;
}

const props = defineProps<{
  issueKey?: string;
  createIn?: string | null;
  board: { id: string; name: string; states: State[]; defaultAssigneeId?: string | null };
  boards: { id: string; name: string; slug: string }[];
  tags: IssueTag[];
  project: string;
  nextKey?: string;
  focusComment?: string;
  carriedError?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'changed', issue: Issue): void;
  (e: 'created', issue: Issue, problem?: string): void;
  (e: 'deleted', id: string): void;
  (e: 'tagCreated', tag: IssueTag): void;
  (e: 'moved', boardId: string): void;
  (e: 'linked'): void;
}>();

const { t, te } = useI18n();
const session = useSession();
const pressedScrim = ref(false);
const { projects } = useProjects();
const projectName = computed(
  () => projects.value.find((p) => p.shortName === props.project)?.name ?? props.project
);

const creating = computed(() => !props.issueKey);
const draft = ref({
  summary: '',
  description: '',
  stateId: '',
  priority: 'Normal' as Priority,
  assigneeId: null as string | null,
  watcherId: null as string | null,
  dueDate: null as string | null,
  tagIds: [] as string[],
});

const issue = ref<IssueFull | null>(null);
let issueReads = 0;
const loading = ref(true);
const error = ref<string | null>(null);
const { people, colorOf, colorOfId, nameOf, genderOf, load: loadPeople } = usePeople();
const { load: readNotices } = useNotices();
const { wanted, pending: askedFor } = useFocus();

const tab = ref<'comments' | 'history'>('comments');
const order = ref<CommentOrder>(commentOrder.get());

interface Pushed {
  kind: 'commit' | 'merge';
  by: string | null;
  author: string | null;
  branch: string | null;
  from: string | null;
  at: string;
  commits: IssueCommit[];
}
type Entry = { key: string; at: string; comment?: Comment; event?: Pushed };

const thread = computed<Entry[]>(() => {
  const comments = issue.value?.comments ?? [];
  const pinned = comments.filter((c) => c.pinnedAt).map((c) => ({ key: c.id, at: c.createdAt, comment: c }));
  const flow: Entry[] = [
    ...comments.filter((c) => !c.pinnedAt).map((c) => ({ key: c.id, at: c.createdAt, comment: c })),
    ...(issue.value?.commits ?? []).map((k) => ({
      key: k.id,
      at: k.at,
      event: {
        kind: k.kind,
        by: k.by,
        author: k.author,
        branch: k.branch,
        from: k.mergedFrom,
        at: k.at,
        commits: [k],
      },
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const merged: Entry[] = [];
  for (const entry of flow) {
    const last = merged[merged.length - 1]?.event;
    const now = entry.event;
    if (
      now?.kind === 'commit' &&
      last?.kind === 'commit' &&
      (last.by ?? last.author) === (now.by ?? now.author) &&
      last.branch === now.branch
    ) {
      last.commits.push(...now.commits);
      last.at = now.at;
      continue;
    }
    merged.push(entry);
  }
  return [...pinned, ...(order.value === 'oldest' ? merged : merged.reverse())];
});

function flipOrder(): void {
  order.value = order.value === 'oldest' ? 'newest' : 'oldest';
  commentOrder.set(order.value);
}

const editing = ref(false);
const saving = ref(false);
const titleDraft = ref('');
const bodyDraft = ref('');
const expectedDraft = ref('');
const importing = ref(false);
const docUrl = ref('');
const importBusy = ref(false);
const importError = ref<string | null>(null);
const docInput = ref<HTMLInputElement | null>(null);

async function openImport(): Promise<void> {
  importing.value = true;
  await nextTick();
  docInput.value?.focus();
}

function closeImport(): void {
  importing.value = false;
  docUrl.value = '';
  importError.value = null;
}

async function importDoc(): Promise<void> {
  const url = docUrl.value.trim();
  if (!url || importBusy.value) return;
  importBusy.value = true;
  importError.value = null;
  try {
    const { html } = await api<{ html: string }>('/google-doc', { method: 'POST', body: { url } });
    const doc = fromGoogleDoc(html);
    if (doc.summary) titleDraft.value = doc.summary;
    bodyDraft.value = doc.description;
    closeImport();
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 0;
    importError.value =
      status === 422 ? t('issue.docClosed') : status === 400 ? t('issue.notDocLink') : t('issue.importFailed');
  } finally {
    importBusy.value = false;
  }
}
let titleBase = '';
let bodyBase = '';
let expectedBase = '';

const picking = ref(false);
const linkQuery = ref('');
const linkResults = ref<IssueLink[]>([]);
const searching = ref(false);
const linking = ref(false);
const pendingLinks = ref<IssueLink[]>([]);
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let searches = 0;

type LinkPick = 'related' | 'parentOf' | 'subtaskOf' | 'duplicateOf' | 'duplicatedBy';
const LINK_KINDS: { value: LinkPick; kind: LinkKind }[] = [
  { value: 'related', kind: 'related' },
  { value: 'parentOf', kind: 'child' },
  { value: 'subtaskOf', kind: 'parent' },
  { value: 'duplicateOf', kind: 'duplicateOf' },
  { value: 'duplicatedBy', kind: 'duplicatedBy' },
];
const LINK_PICKS = computed(() => LINK_KINDS.map((p) => ({ ...p, label: t(`issue.picks.${p.value}`) })));
const LINK_GROUPS: LinkKind[] = ['parent', 'child', 'duplicateOf', 'duplicatedBy', 'related'];
const linkPick = ref<LinkPick>('related');

const shownLinks = computed(() => (creating.value ? pendingLinks.value : (issue.value?.links ?? [])));
const linkGroups = computed(() =>
  LINK_GROUPS.map((kind) => ({ kind, label: t(`issue.groups.${kind}`), links: shownLinks.value.filter((l) => l.kind === kind) })).filter(
    (g) => g.links.length
  )
);
const pickable = computed(() =>
  linkPick.value === 'parentOf' || linkPick.value === 'subtaskOf'
    ? linkResults.value.filter((r) => r.projectShort === props.project)
    : linkResults.value
);

watch(linkQuery, (term) => {
  if (searchTimer) clearTimeout(searchTimer);
  const q = term.trim();
  if (!q) {
    ++searches;
    searching.value = false;
    linkResults.value = [];
    return;
  }
  searchTimer = setTimeout(async () => {
    const mine = ++searches;
    searching.value = true;
    try {
      const rows = await api<IssueLink[]>(
        `/issues/search?q=${encodeURIComponent(q)}&exclude=${issue.value?.id ?? ''}`
      );
      if (mine !== searches) return;
      const already = new Set(shownLinks.value.map((l) => l.id));
      linkResults.value = rows.filter((r) => !already.has(r.id));
    } catch {
      if (mine === searches) linkResults.value = [];
    } finally {
      if (mine === searches) searching.value = false;
    }
  }, 200);
});

function openPicker(): void {
  picking.value = true;
  linkPick.value = 'related';
  linkQuery.value = '';
  linkResults.value = [];
}

const commentDraft = ref('');
const DRAFTS = 'tracker:draft:';
const NEW_DRAFTS = 'tracker:new:';
let keptDraft = '';
const draftSaved = ref(false);
let draftNote: ReturnType<typeof setTimeout> | null = null;

function readNew(): { summary: string; description: string; expected?: string } | null {
  try {
    const kept = localStorage.getItem(NEW_DRAFTS + props.board.id);
    return kept ? (JSON.parse(kept) as { summary: string; description: string; expected?: string }) : null;
  } catch {
    return null;
  }
}

function writeNew(summary: string, description: string, expected = ''): void {
  try {
    if (summary || description || expected) {
      localStorage.setItem(NEW_DRAFTS + props.board.id, JSON.stringify({ summary, description, expected }));
    } else {
      localStorage.removeItem(NEW_DRAFTS + props.board.id);
    }
  } catch {}
}

function keepNew(): void {
  if (!creating.value) return;
  writeNew(
    titleDraft.value.trim(),
    isBlank(bodyDraft.value) ? '' : bodyDraft.value,
    isBlank(expectedDraft.value) ? '' : expectedDraft.value
  );
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
  } catch {}
}

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
  // On mouseup the browser has not updated the selection yet, so read it a tick later.
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
    // Skip the opener: its click toggles the set, so closing it here on mousedown would reopen it.
    if (!inside && !(ev.target instanceof Element && ev.target.closest('.react__hold'))) {
      reacting.value = null;
    }
  }
  if (!popup.value) return;
  const bar = document.getElementById('sel-bar');
  if (bar && ev.target instanceof Node && bar.contains(ev.target)) return;
  popup.value = null;
}

function away(ev: MouseEvent, box: DOMRect): number {
  const dx = ev.clientX < box.left ? box.left - ev.clientX : Math.max(0, ev.clientX - box.right);
  const dy = ev.clientY < box.top ? box.top - ev.clientY : Math.max(0, ev.clientY - box.bottom);
  return Math.max(dx, dy);
}

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

function replyToSelection(): void {
  const id = popup.value?.commentId;
  const c = issue.value?.comments.find((row) => row.id === id);
  popup.value = null;
  if (!c) return;
  const picked = window.getSelection()?.toString().trim() ?? '';
  const source = picked || c.text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
  const quote = escapeHtml(source).replace(/\n/g, '<br>');
  // The &nbsp; holds the caret's place: Quill drops a trailing empty paragraph.
  commentDraft.value = `${commentDraft.value}<blockquote>${quote}</blockquote><p>@${c.author.login}&nbsp;</p>`;
  window.getSelection()?.removeAllRanges();
  void nextTick().then(() => composer.value?.focus(true));
}
const posting = ref(false);
const editingComment = ref<string | null>(null);
const commentEdit = ref('');

const fresh = ref<Set<string>>(new Set());
const litComment = ref<string | null>(null);

watch(() => props.focusComment, lookAtComment);
watch(wanted, (w) => {
  if (w) void lookAtComment(w.comment);
});

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
  // Scrolled again because the file wall repacks after draw; cached images give it no time first.
  const bring = (): void => el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  bring();
  setTimeout(bring, 150);
  setTimeout(bring, 500);
  litComment.value = id;
  setTimeout(() => {
    if (litComment.value === id) litComment.value = null;
  }, 2000);
}

const FIELD_OF: Record<string, string> = {
  summary: 'summary',
  description: 'description',
  stateId: 'status',
  status: 'status',
  boardId: 'board',
  board: 'board',
  priority: 'priority',
  assigneeId: 'assignee',
  watcherId: 'watcher',
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
const pending = ref<File[]>([]);
const commentFiles = ref<File[]>([]);

const shown = ref<number | null>(null);
const gallery = computed(() => [
  ...(issue.value?.attachments ?? [])
    .filter((a) => isPicture(a.mime))
    .map((a) => ({ src: `/api/attachments/${a.id}`, name: a.filename })),
  ...[...pending.value, ...commentFiles.value]
    .filter((f) => isPicture(f.type))
    .map((f) => ({ src: previewOf(f) ?? '', name: f.name })),
]);

const hostStates = ref<State[] | null>(null);

async function readHostStates(id: string | undefined, always = false): Promise<void> {
  if (!id || (!always && id === props.board.id)) {
    hostStates.value = null;
    return;
  }
  try {
    const host = await api<{ states: State[] }>(`/boards/${id}`);
    if (issue.value?.boardId === id) hostStates.value = host.states;
  } catch {}
}

watch(
  () => issue.value?.boardId,
  (id) => void readHostStates(id)
);

const stateChoices = computed(() =>
  (hostStates.value ?? props.board.states).map((s) => ({ value: s.id, label: s.name, color: s.color }))
);
const priorityChoices = computed(() =>
  PRIORITIES.map((p) => ({ value: p, label: t(`priority.${p}`), color: priorityColor(p) }))
);
const assigneeChoices = computed(() => [
  { value: '', label: '—' },
  ...people.value.map((p) => ({ value: p.id, label: p.fullName || p.login, color: p.roleColor })),
]);
const boardChoices = computed(() => props.boards.map((b) => ({ value: b.id, label: b.name })));
const tagChoices = computed(() => [
  ...freeTags.value.map((t) => ({ value: t.id, label: t.name, color: t.color })),
  { value: 'new', label: t('issue.newTagChoice') },
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
    .filter((a) => isPicture(a.mime) && !inlinedIn(commentId).has(a.id))
    .map(shotOfAttachment);

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
function historyValue(field: string, value: string | null): { text: string; login: string | null } {
  if (!value) return { text: '—', login: null };
  if (field === 'assignee' || field === 'watcher' || field === 'pinged') return { text: value, login: value };
  if (field === 'due date') return { text: dueLabel(value)?.text ?? value, login: null };
  if (field === 'priority' && te(`priority.${value}`)) return { text: t(`priority.${value}`), login: null };
  return { text: value, login: null };
}

function historyField(field: string): string {
  const key = field.replace(/ (\w)/g, (_, c: string) => c.toUpperCase());
  return te(`issue.history.${key}`) ? t(`issue.history.${key}`) : field;
}

const history = computed(() =>
  (issue.value?.history ?? []).map((h) => ({
    ...h,
    was: h.from ? historyValue(h.field, h.from) : null,
    now: h.to ? historyValue(h.field, h.to) : historyValue(h.field, null),
  }))
);

const pingable = computed(
  () =>
    features.pings &&
    !creating.value &&
    !!issue.value?.assignee &&
    issue.value.assignee.id !== session.me.value?.id
);
const rang = ref(false);
let pinging = false;

async function ping(): Promise<void> {
  if (!issue.value || rang.value || pinging) return;
  pinging = true;
  error.value = null;
  try {
    await api(`/issues/${issue.value.id}/ping`, { method: 'POST' });
    rang.value = true;
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('common.wentWrong');
  } finally {
    pinging = false;
  }
}

const shownAssignee = computed(() =>
  creating.value ? draft.value.assigneeId : (issue.value?.assignee?.id ?? null)
);
const shownWatcher = computed(() =>
  creating.value ? draft.value.watcherId : (issue.value?.watcher?.id ?? null)
);
const propsOpen = ref(false);
const shownDue = computed(() => (creating.value ? draft.value.dueDate : (issue.value?.dueDate ?? null)));

const propsSummary = computed(() => {
  const state = stateChoices.value.find((s) => s.value === shownStateId.value);
  const person = people.value.find((p) => p.id === shownAssignee.value);
  const due = dueLabel(shownDue.value);
  return [
    ...(state ? [{ text: state.label, color: state.color }] : []),
    { text: t(`priority.${shownPriority.value}`), color: priorityColor(shownPriority.value) },
    ...(person ? [{ text: person.fullName || person.login, color: person.roleColor }] : []),
    ...(due ? [{ text: due.text, date: true, late: due.late }] : []),
  ];
});
const wornTags = computed(() =>
  creating.value
    ? props.tags.filter((t) => draft.value.tagIds.includes(t.id))
    : (issue.value?.tags ?? [])
);
const freeTags = computed(() =>
  props.tags.filter((t) => !wornTags.value.some((w) => w.id === t.id))
);
const own = computed(() => (issue.value?.attachments ?? []).filter((a) => !a.commentId));
const ownBytes = computed(() => own.value.reduce((all, a) => all + a.size, 0));
const attachmentIds = (html: string): Set<string> =>
  new Set([...html.matchAll(/\/api\/attachments\/([0-9a-f-]{36})/g)].map((m) => m[1]));
const inlined = computed(() => attachmentIds(issue.value?.description ?? ''));
const inExpected = computed(() => attachmentIds(issue.value?.expected ?? ''));
const inlinedIn = (commentId: string): Set<string> =>
  attachmentIds(issue.value?.comments.find((c) => c.id === commentId)?.text ?? '');
const embedded = (id: string): boolean => inlined.value.has(id) || inExpected.value.has(id);
const images = computed(() => own.value.filter((a) => isPicture(a.mime) && !embedded(a.id)));
const files = computed(() => own.value.filter((a) => !isPicture(a.mime) || embedded(a.id)));
const filesOf = (commentId: string) =>
  (issue.value?.attachments ?? []).filter((a) => a.commentId === commentId);
const bytesOf = (commentId: string) =>
  filesOf(commentId).reduce((all, a) => all + a.size, 0);

const reading = ref<{ id: string; name: string } | null>(null);

function onFileClick(ev: MouseEvent, a: Attachment): void {
  if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
  if (!canRead(a.filename)) return;
  ev.preventDefault();
  reading.value = { id: a.id, name: a.filename };
}

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key !== 'Escape') return;
  if (deleting.value || deletingComment.value || picking.value || makingTag.value || importing.value || shown.value !== null) return;
  if (reading.value) return;
  if (reacting.value) {
    reacting.value = null;
    return;
  }
  if (popup.value) {
    popup.value = null;
    return;
  }
  if (editingComment.value) {
    editingComment.value = null;
    return;
  }
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
const watching = issueViewers(
  () => issue.value?.boardId,
  () => issue.value?.id
);
watch(
  () => issue.value?.id,
  (id) => {
    if (features.presence) here.issueId = id ?? null;
  }
);
onUnmounted(() => {
  if (here.issueId === issue.value?.id) here.issueId = null;
  for (const url of previewUrls.values()) URL.revokeObjectURL(url);
  previewUrls.clear();
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('mouseup', onMouseUp);
  window.removeEventListener('mousedown', onMouseDownAnywhere);
  window.removeEventListener('mousemove', onMouseMove);
});

watch(() => props.issueKey, load, { immediate: true });

const router = useRouter();
forgetKeys();

function issuePath(to: { key: string; projectShort: string; boardSlug: string }): string {
  const here = props.boards.find((b) => b.id === props.board.id)?.slug;
  return to.projectShort === props.project && here
    ? `/${props.project}/${here}/${to.key}`
    : `/${to.projectShort}/${to.boardSlug}/${to.key}`;
}

function followKey(ev: MouseEvent): void {
  if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
  const key = (ev.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a.ikey')?.dataset.key;
  const info = key ? keyInfo(key) : null;
  if (!info) return;
  ev.preventDefault();
  void router.push(issuePath(info));
}

const mainBox = ref<HTMLDivElement | null>(null);
const ivBox = ref<HTMLDivElement | null>(null);
const scrolled = ref(false);

function onMainScroll(ev: Event): void {
  scrolled.value = (ev.currentTarget as HTMLElement).scrollTop > 8;
}

function toTop(): void {
  mainBox.value?.scrollTo({ top: 0, behavior: 'smooth' });
  ivBox.value?.scrollTo({ top: 0, behavior: 'smooth' });
}

watch(
  () => props.issueKey,
  () => {
    scrolled.value = false;
  }
);

useLive((ev) => {
  refreshKey(ev.issueKey);
  const current = issue.value;
  if (!current) return;
  if (ev.type === 'state.changed' || ev.type === 'board.changed') void readHostStates(current.boardId, true);
  if (ev.type === 'board.changed' || ev.type === 'project.changed') void closeIfGone();
  if (ev.type === 'tag.changed') void reload();
  if (ev.issueId !== current.id) {
    if (ev.type.startsWith('issue.') && current.links.some((l) => l.id === ev.issueId)) void reload();
    return;
  }
  if (ev.type === 'issue.deleted') {
    emit('close');
    return;
  }
  void reload().then(() => {
    if (ev.type.startsWith('comment.') || ev.type.startsWith('commit.')) flash(['comments']);
    else if (ev.type.startsWith('attachment.')) flash(['files']);
    else flash((ev.fields ?? []).map((f) => FIELD_OF[f] ?? f));
  });
}, () => void reload());

async function closeIfGone(): Promise<void> {
  if (!props.issueKey) return;
  try {
    await api(`/issues/${encodeURIComponent(props.issueKey)}`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) emit('close');
  }
}

async function reload(): Promise<void> {
  if (!props.issueKey) return;
  const mine = ++issueReads;
  try {
    const got = await api<IssueFull>(`/issues/${encodeURIComponent(props.issueKey)}`);
    if (mine === issueReads) issue.value = got;
  } catch {}
}

async function load(): Promise<void> {
  if (!props.issueKey) {
    draft.value = {
      summary: '',
      description: '',
      stateId: props.createIn ?? props.board.states[0]?.id ?? '',
      priority: 'Normal',
      assigneeId: props.board.defaultAssigneeId ?? null,
      watcherId: null,
      dueDate: null,
      tagIds: [],
    };
    const kept = readNew();
    titleDraft.value = kept?.summary ?? '';
    bodyDraft.value = kept?.description ?? '';
    expectedDraft.value = kept?.expected ?? '';
    editing.value = true;
    loading.value = false;
    return;
  }
  loading.value = true;
  error.value = props.carriedError ?? null;
  const mine = ++issueReads;
  try {
    const got = await api<IssueFull>(`/issues/${encodeURIComponent(props.issueKey)}`);
    if (mine !== issueReads) return;
    issue.value = got;
    keptDraft = readDraft();
    if (keptDraft) commentDraft.value = keptDraft;
    void lookAtComment(askedFor() ?? props.focusComment);
  } catch (err) {
    issue.value = null;
    error.value = err instanceof Error ? err.message : t('issue.loadFailed');
  } finally {
    loading.value = false;
  }
}

async function patch(body: Record<string, unknown>): Promise<boolean> {
  const current = issue.value;
  if (!current) return false;
  error.value = null;
  try {
    const updated = await api<Issue>(`/issues/${current.id}`, { method: 'PATCH', body });
    // Merge into the live ref, not the snapshot: a live event may have replaced it mid-request.
    issue.value = { ...(issue.value ?? current), ...updated };
    emit('changed', updated);
    await reload();
    return true;
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('issue.saveFailed');
    return false;
  }
}

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
        description: trimBlank(bodyDraft.value),
        expected: isBlank(expectedDraft.value) ? '' : trimBlank(expectedDraft.value),
        stateId: draft.value.stateId,
        priority: draft.value.priority,
        assigneeId: draft.value.assigneeId,
        watcherId: draft.value.watcherId,
        dueDate: draft.value.dueDate,
        tagIds: draft.value.tagIds,
      },
    });
    writeNew('', '');
    let problem: string | undefined;
    if (pendingLinks.value.length) {
      for (const link of pendingLinks.value) {
        try {
          await api(`/issues/${made.id}/links`, {
            method: 'POST',
            body: { key: link.key, kind: LINK_KINDS.find((p) => p.kind === link.kind)?.value },
          });
        } catch (err) {
          problem = err instanceof Error ? err.message : t('issue.createdNoLink');
        }
      }
      pendingLinks.value = [];
      emit('linked');
    }
    if (pending.value.length) {
      try {
        await sendFiles(made.id, pending.value);
      } catch (err) {
        problem = err instanceof Error ? err.message : t('issue.createdNoFiles');
      }
      pending.value = [];
    }
    emit('created', made, problem);
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('issue.createFailed');
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
    error.value = err instanceof Error ? err.message : t('issue.starFailed');
  }
}

function startEditing(): void {
  titleBase = issue.value?.summary ?? '';
  bodyBase = issue.value?.description ?? '';
  expectedBase = issue.value?.expected ?? '';
  titleDraft.value = titleBase;
  bodyDraft.value = bodyBase;
  expectedDraft.value = expectedBase;
  editing.value = true;
}

async function saveText(): Promise<void> {
  const current = issue.value;
  if (!current || saving.value) return;
  const summary = titleDraft.value.trim();
  if (!summary) {
    error.value = t('issue.needsTitle');
    return;
  }
  const body: Record<string, unknown> = {};
  if (summary !== titleBase) body.summary = summary;
  if (bodyDraft.value !== bodyBase) body.description = trimBlank(bodyDraft.value);
  if (expectedDraft.value !== expectedBase) {
    body.expected = isBlank(expectedDraft.value) ? '' : trimBlank(expectedDraft.value);
  }
  saving.value = true;
  try {
    if (Object.keys(body).length && !(await patch(body))) return;
    editing.value = false;
  } finally {
    saving.value = false;
  }
}

const makingTag = ref(false);
const newTagName = ref('');
const tagBusy = ref(false);
const tagError = ref<string | null>(null);

function pickTag(chosen: string): void {
  if (!chosen) return;
  if (chosen !== 'new') {
    toggleTag(chosen, true);
    return;
  }
  newTagName.value = '';
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
      body: { name, boardId: props.board.id },
    });
    emit('tagCreated', created);
    makingTag.value = false;
    toggleTag(created.id, true);
  } catch (err) {
    tagError.value = err instanceof Error ? err.message : t('issue.tagFailed');
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
  const text = trimBlank(commentDraft.value);
  const current = issue.value;
  if (isBlank(text) || !current || posting.value) return;
  posting.value = true;
  error.value = null;
  try {
    const created = await api<Comment>(`/issues/${current.id}/comments`, {
      method: 'POST',
      body: { text },
    });
    if (commentFiles.value.length) {
      try {
        await sendFiles(current.id, commentFiles.value, created.id);
      } catch (err) {
        error.value = err instanceof Error ? err.message : t('issue.postedNoFiles');
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
    void readNotices();
    await reload();
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('issue.postFailed');
  } finally {
    posting.value = false;
  }
}

async function rewrite(where: 'description' | 'expected' | Comment, change: (html: string) => string): Promise<void> {
  const current = issue.value;
  if (!current) return;
  if (typeof where === 'string') {
    const before = current[where];
    const next = change(before);
    if (next === before) return;
    issue.value = { ...current, [where]: next };
    if (!(await patch({ [where]: next }))) issue.value = { ...(issue.value ?? current), [where]: before };
    return;
  }
  const next = change(where.text);
  if (next === where.text) return;
  const swap = (text: string): void => {
    const now = issue.value ?? current;
    issue.value = { ...now, comments: now.comments.map((row) => (row.id === where.id ? { ...row, text } : row)) };
  };
  swap(next);
  try {
    await api(`/comments/${where.id}`, { method: 'PATCH', body: { text: next } });
  } catch (err) {
    swap(where.text);
    error.value = err instanceof Error ? err.message : t('issue.commentSaveFailed');
  }
}

function onTextClick(ev: MouseEvent, where: 'description' | 'expected' | Comment): void {
  const target = ev.target as HTMLElement | null;
  const mark = target?.closest<HTMLElement>('.tick[data-check]');
  if (mark) {
    ev.preventDefault();
    void rewrite(where, (html) => flipCheck(html, Number(mark.dataset.check)));
    return;
  }
  const item = where === 'expected' && !target?.closest('a') ? target?.closest<HTMLElement>('li[data-strike]') : null;
  if (item && (window.getSelection()?.isCollapsed ?? true)) {
    void rewrite(where, (html) => flipStrike(html, Number(item.dataset.strike)));
    return;
  }
  followKey(ev);
}

async function saveComment(c: Comment): Promise<void> {
  const text = trimBlank(commentEdit.value);
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
    error.value = err instanceof Error ? err.message : t('issue.commentSaveFailed');
  }
}

async function addLink(key: string): Promise<void> {
  if (!key || linking.value) return;
  if (creating.value) {
    const found = linkResults.value.find((r) => r.key === key);
    const kind = LINK_KINDS.find((p) => p.value === linkPick.value)?.kind ?? 'related';
    if (found) pendingLinks.value = [...pendingLinks.value, { ...found, kind }];
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
      body: { key, kind: linkPick.value },
    });
    const now = issue.value ?? current;
    issue.value = { ...now, links: [...now.links, made] };
    picking.value = false;
    if (linkPick.value === 'duplicateOf') {
      await reload();
      if (issue.value) emit('changed', issue.value);
    }
    emit('linked');
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('issue.linkFailed');
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
    emit('linked');
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('issue.unlinkFailed');
  }
}

const reacting = ref<string | null>(null);
const reactNear = ref(true);
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
    found.names.push(nameOf(r.by));
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
    error.value = err instanceof Error ? err.message : t('issue.reactFailed');
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
    error.value = err instanceof Error ? err.message : t('issue.pinFailed');
  }
}

const deletingComment = ref<Comment | null>(null);

async function confirmRemoveComment(): Promise<void> {
  const c = deletingComment.value;
  deletingComment.value = null;
  if (c) await removeComment(c);
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
    error.value = err instanceof Error ? err.message : t('issue.commentDeleteFailed');
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
    if (!res.ok || !payload?.data) throw new Error(payload?.error ?? t('issue.uploadFailed'));
    if (issue.value) {
      issue.value = { ...issue.value, attachments: [...issue.value.attachments, payload.data] };
    }
  }
}

function picked(ev: Event): File[] {
  const input = ev.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  return files;
}

function accept(list: FileList | File[] | null): File[] {
  const chosen = list ? Array.from(list) : [];
  const tooBig = chosen.filter((f) => f.size > MAX_FILE_BYTES);
  if (tooBig.length) {
    error.value = `${tooBig.map((f) => f.name).join(', ')} — 100mb max for file`;
  }
  return chosen.filter((f) => f.size <= MAX_FILE_BYTES);
}

async function upload(list: FileList | File[] | null): Promise<void> {
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
    error.value = err instanceof Error ? err.message : t('issue.uploadFailed');
  } finally {
    uploading.value = false;
  }
}

const previewUrls = new Map<File, string>();

function previewOf(file: File): string | null {
  if (!isPicture(file.type)) return null;
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

// Keyed by identity, not name: every pasted screenshot is named image.png.
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

function pickCommentFiles(list: FileList | File[] | null): void {
  const chosen = accept(list);
  if (chosen.length) commentFiles.value = [...commentFiles.value, ...chosen];
}

async function addToComment(commentId: string, list: FileList | File[] | null): Promise<void> {
  const chosen = accept(list);
  if (!chosen.length || !issue.value) return;
  uploading.value = true;
  try {
    await sendFiles(issue.value.id, chosen, commentId);
    await reload();
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('issue.uploadFailed');
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
    error.value = err instanceof Error ? err.message : t('issue.fileDeleteFailed');
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
    error.value = err instanceof Error ? err.message : t('issue.deleteFailed');
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      class="iv__scrim"
      @pointerdown="pressedScrim = $event.target === $event.currentTarget"
      @click.self="pressedScrim && emit('close')"
    >
      <section class="dlg iv__win" role="dialog" aria-modal="true">
        <header class="dlg__h">
          <button
            class="btn btn--sm btn--icon btn--ghost"
            type="button"
            :aria-label="t('common.close')"
            @click="emit('close')"
          >
            <X class="ic" />
          </button>
          <button
            class="btn btn--sm btn--icon btn--ghost iv__top"
            :class="{ 'is-off': !scrolled }"
            type="button"
            :aria-label="t('issue.toTop')"
            :aria-hidden="!scrolled"
            :tabindex="scrolled ? 0 : -1"
            @click="toTop"
          >
            <ArrowUp class="ic" />
          </button>
          <div class="sp"></div>
          <span class="iv__path">
            <span class="iv__where iv__project">{{ projectName }}</span>
            <span class="iv__sep">/</span>
            <span class="iv__where">{{ board.name }}</span>
            <span class="iv__sep">/</span>
            <span class="key iv__key">{{ issueKey ?? nextKey ?? t('issue.newIssue') }}</span>
          </span>
          <div class="sp"></div>
          <Viewers v-if="features.presence && !creating" :logins="watching" class="iv__who" />
          <template v-if="creating">
            <button
              class="btn btn--sm btn--icon btn--ghost"
              type="button"
              :title="t('issue.importDoc')"
              :aria-label="t('issue.importDoc')"
              aria-haspopup="dialog"
              @click="openImport"
            >
              <FileInput class="ic" />
            </button>
            <button class="btn btn--sm" type="button" @click="emit('close')">{{ t('common.cancel') }}</button>
            <button
              class="btn btn--sm btn--primary"
              type="button"
              :disabled="saving || !titleDraft.trim()"
              @click="create"
            >
              {{ t('issue.create') }}
            </button>
          </template>
          <template v-else-if="editing">
            <button class="btn btn--sm" type="button" @click="editing = false">{{ t('common.cancel') }}</button>
            <button class="btn btn--sm btn--primary" type="button" :disabled="saving" @click="saveText">
              {{ t('common.save') }}
            </button>
          </template>
          <template v-else>
            <button
              class="btn btn--sm btn--icon btn--ghost iv__star"
              :class="{ 'is-on': issue?.favourite }"
              type="button"
              :title="issue?.favourite ? t('issue.inFavourites') : t('issue.addFavourite')"
              :aria-pressed="issue?.favourite === true"
              :disabled="!issue"
              @click="toggleFavourite"
            >
              <Star class="ic" :fill="issue?.favourite ? 'currentColor' : 'none'" />
            </button>
            <button
              class="btn btn--sm btn--icon btn--ghost"
              type="button"
              :aria-label="t('issue.edit')"
              :disabled="!issue"
              @click="startEditing"
            >
              <Pencil class="ic" />
            </button>
            <button
              class="btn btn--sm btn--icon btn--ghost iv__trash"
              type="button"
              :title="t('common.delete')"
              :aria-label="t('common.delete')"
              :disabled="!session.canDelete.value"
              @click="deleting = true"
            >
              <Trash2 class="ic" />
            </button>
          </template>
        </header>

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
          <aside class="props props--sk">
            <div v-for="n in 6" :key="n" class="prop">
              <span class="sk sk--line" style="width: 54px"></span>
              <span class="sk sk--line" style="height: 30px"></span>
            </div>
          </aside>
        </div>
        <div v-else-if="!issue && !creating" class="empty">
          <span class="empty__g">✕</span>{{ error }}
        </div>

        <div v-else ref="ivBox" class="iv" @scroll="onMainScroll">
          <div ref="mainBox" class="iv__main" @scroll="onMainScroll">
            <input
              v-if="editing"
              v-model="titleDraft"
              class="input iv__title-edit"
              maxlength="300"
              :placeholder="t('issue.titlePlaceholder')"
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
                :placeholder="t('issue.bodyPlaceholder')"
                inline-images
                @files="upload"
                @blur="keepNew"
              />
              <div
                v-else-if="issue?.description && !isBlank(issue.description)"
                class="md iv__body"
                :class="{ 'is-fresh': fresh.has('description') }"
                @click="onTextClick($event, 'description')"
                v-html="asHtml(issue.description, true)"
              ></div>
              <div v-else class="iv__body hint faint">{{ t('issue.nothingWritten') }}</div>

            <div v-if="editing" class="iv__expected">
              <div class="sec-h">{{ t('issue.expected') }}</div>
              <RichText v-model="expectedDraft" min-height="90px" inline-images @files="upload" @blur="keepNew" />
            </div>
            <div
              v-else-if="issue?.expected && !isBlank(issue.expected)"
              class="iv__expected"
              :class="{ 'is-fresh': fresh.has('expected') }"
            >
              <div class="sec-h">{{ t('issue.expected') }}</div>
              <div class="md iv__body" @click="onTextClick($event, 'expected')" v-html="asHtml(issue.expected, true, true)"></div>
            </div>
            </div>

            <div :class="{ 'is-fresh': fresh.has('links') }">
              <div v-if="!shownLinks.length" class="sec-h links">
                <Link2 class="ic links__icon" aria-hidden="true" />
                <span class="hint faint">{{ t('issue.noLinks') }}</span>
                <div class="sp"></div>
                <button class="btn btn--sm btn--ghost" type="button" @click="openPicker">
                  {{ t('issue.addLink') }}
                </button>
              </div>
              <div v-else class="lgroups">
                <template v-for="(g, gi) in linkGroups" :key="g.kind">
                  <span class="sec-h">
                    {{ g.label }}
                    <span v-if="g.kind === 'child'" class="n">
                      {{ g.links.filter((l) => l.resolved).length }}/{{ g.links.length }}
                    </span>
                  </span>
                  <div class="links">
                    <RouterLink
                      v-for="l in g.links"
                      :key="l.id"
                      class="lk"
                      :to="issuePath(l)"
                      :title="`${l.summary} — ${l.stateName}`"
                    >
                      <span class="key lk__key" :style="{ color: ink(l.stateColor) }">{{ l.key }}</span>
                    </RouterLink>
                    <button
                      v-if="gi === linkGroups.length - 1"
                      class="btn btn--sm btn--ghost lgroups__add"
                      type="button"
                      @click="openPicker"
                    >
                      {{ t('issue.editLinks') }}
                    </button>
                  </div>
                </template>
              </div>
            </div>

            <div :class="{ 'is-fresh': fresh.has('files') }">
              <div v-if="own.length" class="sec-h">
                <Paperclip class="ic" aria-hidden="true" />
                <span>{{ t('issue.files', { n: own.length }, own.length) }}, {{ fileSize(ownBytes) }}</span>
                <div class="sp"></div>
                <a
                  v-if="own.length > 1 && issue"
                  class="btn btn--sm btn--ghost"
                  :href="`/api/issues/${issue.id}/files.zip`"
                  download
                >{{ t('issue.downloadAll') }}</a>
              </div>
              <div v-for="a in files" :key="a.id" class="att__cap att__row">
                <a
                  :href="`/api/attachments/${a.id}`"
                  target="_blank"
                  @click="onFileClick($event, a)"
                >{{ a.filename }}</a>
                <span class="stamp">{{ fileSize(a.size) }}<template v-if="inlined.has(a.id)">, {{ t('issue.inDescription') }}</template><template v-else-if="inExpected.has(a.id)">, {{ t('issue.inExpected') }}</template></span>
                <a
                  class="btn btn--sm btn--icon btn--ghost"
                  :href="`/api/attachments/${a.id}`"
                  download
                  :aria-label="t('issue.downloadNamed', { name: a.filename })"
                ><FileDown class="ic ic--sm" /></a>
                <button
                  class="btn btn--sm btn--icon btn--ghost"
                  type="button"
                  :aria-label="t('common.deleteNamed', { name: a.filename })"
                  @click="removeAttachment(a)"
                ><X class="ic ic--sm" /></button>
              </div>
              <FileWall
                :shots="issueShots"
                removable
                @open="shown = galleryIndex($event)"
                @remove="removeAttachmentKey"
              />

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
                  :aria-label="t('files.remove', { name: f.name })"
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
                  @change="upload(picked($event))"
                />
                {{ uploading ? t('issue.uploading') : t('issue.dropFiles') }}
              </label>
            </div>

            <nav v-if="issue" class="itabs" :aria-label="t('issue.detail')">
              <button
                class="itab"
                type="button"
                :aria-selected="tab === 'comments'"
                @click="tab = 'comments'"
              >
                {{ t('issue.comments') }}<span class="n">{{ issue.comments.length }}</span>
              </button>
              <button
                class="itab"
                type="button"
                :aria-selected="tab === 'history'"
                @click="tab = 'history'"
              >
                {{ t('issue.historyTab') }}<span class="n">{{ issue.history.length }}</span>
              </button>
              <div class="sp"></div>
              <button
                v-if="tab === 'comments'"
                class="itab itab--order"
                type="button"
                :title="order === 'oldest' ? t('prefs.oldestFirst') : t('prefs.newestFirst')"
                @click="flipOrder"
              >
                <component :is="order === 'oldest' ? ArrowUpNarrowWide : ArrowDownWideNarrow" class="ic" />
              </button>
            </nav>

            <div
              v-if="issue && tab === 'comments'"
              class="iv__list"
              :class="{ 'is-fresh': fresh.has('comments') }"
            >
              <template v-for="{ key, comment: c, event: e } in thread" :key="key">
                <div v-if="e" class="ev">
                  <component :is="e.kind === 'merge' ? GitMerge : GitCommitHorizontal" class="ic ev__ic" />
                  <div>
                    <div class="ev__head">
                      <span class="cm__who" :style="{ color: ink(colorOf(e.by)) }">{{ e.by ? nameOf(e.by) : e.author }}</span>
                      <span v-if="e.by && nameOf(e.by) !== e.by" class="nick">{{ e.by }}</span>
                      <i18n-t v-if="e.kind === 'merge'" :keypath="`issue.merged.${genderOf(e.by) ?? 'x'}`" tag="span">
                        <template #from><span class="ev__ref">{{ e.from }}</span></template>
                        <template #branch><span class="ev__ref">{{ e.branch }}</span></template>
                      </i18n-t>
                      <i18n-t v-else :keypath="`issue.pushed.${genderOf(e.by) ?? 'x'}`" tag="span" :plural="e.commits.length">
                        <template #n>{{ e.commits.length }}</template>
                        <template #branch><span class="ev__ref">{{ e.branch }}</span></template>
                      </i18n-t>
                    </div>
                    <a
                      v-for="k in e.commits"
                      :key="k.id"
                      class="ev__commit"
                      :href="k.url"
                      target="_blank"
                      rel="noopener noreferrer"
                    ><span class="ev__sha">{{ k.sha.slice(0, 7) }}</span><span class="ev__msg">{{
                      k.message
                    }}</span><time class="stamp ev__at">{{ stampAt(k.at) }}</time></a>
                  </div>
                </div>
                <article
                  v-else-if="c"
                  :id="`comment-${c.id}`"
                  :class="{ 'is-fresh': litComment === c.id }"
                  class="cm"
                >
                  <span class="av av--lg" :style="buddyAvatarStyle(c.author.login)"></span>
                  <div>
                    <div class="cm__head">
                      <span class="cm__who" :style="{ color: ink(colorOf(c.author.login)) }">
                        {{ nameOf(c.author.login) }}
                      </span>
                      <span v-if="c.viaToken" class="api">API</span>
                      <time class="stamp">{{ stampAt(c.createdAt) }}</time>
                      <span v-if="c.editedAt" class="cm__edited">
                        {{ t('issue.edited') }}
                        <span class="selbar cm__when">{{ stampAt(c.editedAt) }}</span>
                      </span>
                      <Pin
                        v-if="c.pinnedAt"
                        class="ic ic--sm cm__pin"
                        :aria-label="c.pinnedBy ? t(`issue.pinnedBy.${genderOf(c.pinnedBy) ?? 'x'}`, { name: nameOf(c.pinnedBy) }) : t('issue.pinned')"
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
                            :aria-label="t('issue.react')"
                            @click="openReactions(c, $event)"
                          ><SmilePlus class="ic ic--sm" /></button>
                        </span>
                        <button class="btn btn--sm btn--ghost" type="button" @click="togglePin(c)">
                          {{ c.pinnedAt ? t('issue.unpin') : t('issue.pin') }}
                        </button>
                        <button
                          v-if="c.author.id === session.me.value?.id"
                          class="btn btn--sm btn--ghost"
                          type="button"
                          @click="editingComment = c.id; commentEdit = c.text"
                        >{{ t('issue.edit') }}</button>
                        <button
                          v-if="c.author.id === session.me.value?.id || session.canDelete.value"
                          class="btn btn--sm btn--ghost"
                          type="button"
                          @click="deletingComment = c"
                        >{{ t('common.delete') }}</button>
                      </span>
                    </div>
                    <template v-if="editingComment === c.id">
                      <RichText
                        v-model="commentEdit"
                        class="cm__edit"
                        min-height="90px"
                        inline-images
                        @files="(list) => addToComment(c.id, list)"
                      >
                        <template #tools>
                          <label class="rt__clip" :title="t('issue.attach')">
                            <input
                              type="file"
                              multiple
                              class="sr"
                              :disabled="uploading"
                              @change="addToComment(c.id, picked($event))"
                            />
                            <Paperclip class="ic" />
                          </label>
                        </template>
                      </RichText>
                      <div class="composer__row">
                        <div class="sp"></div>
                        <button class="btn btn--sm" type="button" @click="editingComment = null">{{ t('common.cancel') }}</button>
                        <button class="btn btn--sm btn--primary" type="button" @click="saveComment(c)">{{ t('common.save') }}</button>
                      </div>
                    </template>
                    <div
                      v-else
                      class="md cm__body"
                      @click="onTextClick($event, c)"
                      v-html="asHtml(c.text, c.author.id === session.me.value?.id)"
                    ></div>

                    <div v-if="filesOf(c.id).length" class="cm__files">
                      <div v-if="filesOf(c.id).length > 1" class="att__cap att__row att__all">
                        <div></div>
                        <div class="att__all__what">
                          {{ t('issue.filesCount', { n: filesOf(c.id).length }, filesOf(c.id).length) }}
                          <span class="stamp">{{ fileSize(bytesOf(c.id)) }}</span>
                        </div>
                        <div class="att__all__go">
                          <a
                            class="btn btn--sm btn--icon btn--ghost"
                            :href="`/api/comments/${c.id}/files.zip`"
                            download
                            :aria-label="t('issue.downloadAll')"
                          ><FileArchive class="ic ic--sm" /></a>
                          <div class="selbar att__all__tip">{{ t('issue.downloadAll') }}</div>
                        </div>
                      </div>
                      <span
                        v-for="a in filesOf(c.id).filter((x) => !isPicture(x.mime) || inlinedIn(c.id).has(x.id))"
                        :key="a.id"
                        class="att__cap att__row"
                      >
                        <a
                          :href="`/api/attachments/${a.id}`"
                          target="_blank"
                          @click="onFileClick($event, a)"
                        >{{ a.filename }}</a>
                        <span class="stamp">{{ fileSize(a.size) }}<template v-if="inlinedIn(c.id).has(a.id)">, {{ t('issue.inComment') }}</template></span>
                        <a
                          class="btn btn--sm btn--icon btn--ghost"
                          :href="`/api/attachments/${a.id}`"
                          download
                          :aria-label="t('issue.downloadNamed', { name: a.filename })"
                        ><FileDown class="ic ic--sm" /></a>
                        <button
                          v-if="editingComment === c.id"
                          class="btn btn--sm btn--icon btn--ghost"
                          type="button"
                          :aria-label="t('common.deleteNamed', { name: a.filename })"
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
              </template>

              <form class="cm" :class="{ 'cm--lead': order === 'newest' }" @submit.prevent="postComment">
                <span class="av av--lg" :style="buddyAvatarStyle(session.me.value?.login ?? '')"></span>
                <div>
                  <RichText
                    ref="composer"
                    v-model="commentDraft"
                    min-height="90px"
                    :placeholder="t('issue.commentPlaceholder')"
                    :disabled="posting"
                    inline-images
                    @files="pickCommentFiles"
                    @blur="keepDraft"
                  >
                    <template #tools>
                      <label class="rt__clip" :title="t('issue.attach')">
                        <input
                          type="file"
                          multiple
                          class="sr"
                          @change="pickCommentFiles(picked($event))"
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
                      :aria-label="t('files.remove', { name: f.name })"
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
                    <span v-if="draftSaved" class="composer__kept">{{ t('issue.draftSaved') }}</span>
                    <div class="sp"></div>
                    <button
                      class="btn btn--sm btn--primary"
                      :class="{ 'is-busy': posting }"
                      type="submit"
                      :disabled="isBlank(commentDraft) || posting"
                    >
                      {{ t('issue.post') }}
                    </button>
                  </div>
                </div>
              </form>
            </div>

            <div v-else-if="issue" class="hist">
              <div v-for="h in history" :key="h.id" class="hi">
                <time>{{ stampAt(h.at) }}</time>
                <span class="hi__who"><PersonName v-if="h.by" :login="h.by" /></span>
                <span class="hi__what">
                  <span v-if="h.viaToken" class="api">API</span>
                  <span class="hi__f">{{ historyField(h.field) }}</span>
                  <template v-if="h.was">
                    <span class="hi__f">
                      <PersonName v-if="h.was.login" :login="h.was.login" />
                      <template v-else>{{ h.was.text }}</template>
                    </span>
                    <span class="hi__arrow">→</span>
                    <span class="hi__t">
                      <PersonName v-if="h.now.login" :login="h.now.login" />
                      <template v-else>{{ h.now.text }}</template>
                    </span>
                  </template>
                  <span v-else-if="h.to" class="hi__t">
                    <PersonName v-if="h.now.login" :login="h.now.login" />
                    <template v-else>{{ h.now.text }}</template>
                  </span>
                </span>
              </div>
              <div v-if="!issue.history.length" class="empty empty--sm">
                <span class="empty__g">◇</span>{{ t('calendar.nothingYet') }}
              </div>
            </div>
          </div>

          <aside class="props">
            <button class="props__toggle" type="button" :aria-expanded="propsOpen" @click="propsOpen = !propsOpen">
              <span class="props__sum">
                <template v-for="(part, i) in propsSummary" :key="i"><template v-if="i">, </template><span
                  :class="{ props__date: part.date, 'is-late': part.late }"
                  :style="{ color: ink(part.color) }"
                >{{ part.text }}</span></template>
              </span>
              <ChevronDown v-if="propsOpen" class="ic" />
              <ChevronRight v-else class="ic" />
            </button>
            <div class="props__all" :class="{ 'is-open': propsOpen }">
              <template v-if="issue && boards.length > 1">
                <div class="prop prop--tall" :class="{ 'is-fresh': fresh.has('board') }">
                  <span class="prop__k">{{ t('fields.board') }}</span>
                  <div class="prop__stack">
                    <Select
                      :model-value="issue.boardId"
                      :options="boardChoices"
                      small
                      @update:model-value="moveBoard"
                    />
                    <span class="hint">{{ t('issue.moveHint') }}</span>
                  </div>
                </div>
                <div class="hr"></div>
              </template>
              <div class="prop" :class="{ 'is-fresh': fresh.has('status') }">
                <span class="prop__k">{{ t('fields.status') }}</span>
                <Select
                  :model-value="shownStateId ?? ''"
                  :options="stateChoices"
                  small
                  @update:model-value="setProp({ stateId: $event })"
                />
              </div>
              <div class="prop" :class="{ 'is-fresh': fresh.has('priority') }">
                <span class="prop__k">{{ t('fields.priority') }}</span>
                <Select
                  :model-value="shownPriority"
                  :options="priorityChoices"
                  small
                  @update:model-value="setProp({ priority: $event as Priority })"
                />
              </div>
              <div class="prop" :class="{ 'is-fresh': fresh.has('assignee') }">
                <span class="prop__k">{{ t('fields.assignee') }}</span>
                <div class="prop__pair">
                  <Select
                    :model-value="shownAssignee ?? ''"
                    :options="assigneeChoices"
                    small
                    @update:model-value="setProp({ assigneeId: $event || null })"
                  />
                  <template v-if="pingable">
                    <span v-if="rang" class="pinged"><BellRing class="ic" /></span>
                    <button
                      v-else
                      class="btn btn--sm btn--icon btn--ghost"
                      type="button"
                      :title="t('issue.ping', { name: nameOf(issue?.assignee?.login) })"
                      :aria-label="t('issue.ping', { name: nameOf(issue?.assignee?.login) })"
                      @click="ping"
                    ><Bell class="ic" /></button>
                  </template>
                </div>
              </div>
              <div class="prop" :class="{ 'is-fresh': fresh.has('watcher') }">
                <span class="prop__k">{{ t('fields.watcher') }}</span>
                <Select
                  :model-value="shownWatcher ?? ''"
                  :options="assigneeChoices"
                  small
                  @update:model-value="setProp({ watcherId: $event || null })"
                />
              </div>
              <div class="prop" :class="{ 'is-fresh': fresh.has('due') }">
                <span class="prop__k">{{ t('fields.due') }}</span>
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
                <span class="prop__k">{{ t('fields.tags') }}</span>
                <div class="prop__tags">
                  <span
                    v-for="tag in wornTags"
                    :key="tag.id"
                    class="taglabel"
                    :style="{ '--c': tag.color }"
                  >
                    {{ tag.name }}
                    <button
                      class="taglabel__x"
                      type="button"
                      :aria-label="t('files.remove', { name: tag.name })"
                      @click="toggleTag(tag.id, false)"
                    ><X class="ic ic--sm" /></button>
                  </span>
                  <Select
                    model-value=""
                    :options="tagChoices"
                    :placeholder="t('tags.addPlaceholder')"
                    small
                    @update:model-value="pickTag"
                  />
                </div>
              </div>

              <template v-if="issue">
                <div class="hr"></div>

                <div class="prop">
                  <span class="prop__k">{{ t('fields.author') }}</span>
                  <span class="pv pv--ro">
                    <span>
                      <span :style="{ color: ink(colorOfId(issue.author?.id)) }">{{
                        issue.author ? nameOf(issue.author.login) : '—'
                      }}</span>
                      <span
                        v-if="issue.author && nameOf(issue.author.login) !== issue.author.login"
                        class="nick"
                      >{{ issue.author.login }}</span>
                      <span v-if="issue.viaBot" class="via" :title="t('issue.viaBot')"><Bot class="ic ic--sm" /></span>
                    </span>
                  </span>
                </div>
                <div class="prop">
                  <span class="prop__k">{{ t('fields.created') }}</span>
                  <span class="pv pv--ro stamp">{{ stampAt(issue.createdAt) }}</span>
                </div>
              </template>
            </div>
          </aside>
        </div>

        <div v-if="error" class="err iv__err">{{ error }}</div>
      </section>

      <Dialog v-if="picking" :title="t('issue.linkTitle')" :width="460" @close="picking = false">
        <div v-if="shownLinks.length" class="pick">
          <template v-for="g in linkGroups" :key="g.kind">
            <div class="sec-h pick__group">{{ g.label }}</div>
            <div v-for="l in g.links" :key="l.id" class="pick__line">
              <span class="key">{{ l.key }}</span>
              <span class="pick__sum">{{ l.summary }}</span>
              <button class="btn btn--sm btn--ghost" type="button" @click="removeLink(l)">{{ t('issue.unlink') }}</button>
            </div>
          </template>
        </div>
        <div v-if="shownLinks.length" class="hr"></div>

        <div class="pick__find">
          <Select v-model="linkPick" class="pick__kind" :options="LINK_PICKS" :label="t('issue.linkKind')" />
          <input
            v-model="linkQuery"
            class="input"
            :placeholder="t('issue.keyOrTitle')"
            autofocus
            @keydown.enter.prevent="pickable[0] && addLink(pickable[0].key)"
          />
        </div>
        <div class="pick">
          <button
            v-for="r in pickable"
            :key="r.id"
            class="pick__row"
            type="button"
            :disabled="linking"
            @click="addLink(r.key)"
          >
            <span class="key">{{ r.key }}</span>
            <span class="pick__sum">{{ r.summary }}</span>
            <span class="pick__state" :style="{ color: ink(r.stateColor) }">{{ r.stateName }}</span>
          </button>
          <p v-if="searching" class="hint">{{ t('issue.searching') }}</p>
          <p v-else-if="linkQuery.trim() && !pickable.length" class="hint">{{ t('issues.nothingFound') }}</p>
        </div>
      </Dialog>

      <Dialog v-if="makingTag" :title="t('issue.newTag')" :width="420" @close="makingTag = false">
        <div class="field">
          <label class="label" for="tag-name">{{ t('settings.name') }}</label>
          <input
            id="tag-name"
            v-model="newTagName"
            class="input"
            maxlength="40"
            autofocus
            @keydown.enter.prevent="createTag"
          />
        </div>
        <div v-if="tagError" class="err">{{ tagError }}</div>
        <template #footer>
          <div class="sp"></div>
          <button class="btn" type="button" @click="makingTag = false">{{ t('common.cancel') }}</button>
          <button
            class="btn btn--primary"
            type="button"
            :disabled="tagBusy || !newTagName.trim()"
            @click="createTag"
          >
            {{ t('issue.create') }}
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
        <button type="button" @click="copySelection">{{ t('users.copy') }}</button>
        <button type="button" @click="replyToSelection">{{ t('issue.reply') }}</button>
      </div>

      <ImageViewer v-model:index="shown" :images="gallery" />
      <FileViewer :file="reading" @close="reading = null" />

      <Dialog v-if="deleting" :title="t('common.deleteNamed', { name: issueKey })" @close="deleting = false">
        <p class="iv__lede">{{ t('issue.deleteText') }}</p>
        <template #footer>
          <button class="btn" type="button" @click="deleting = false">{{ t('common.cancel') }}</button>
          <button class="btn btn--danger" type="button" @click="removeIssue">{{ t('issue.deleteIssue') }}</button>
        </template>
      </Dialog>
      <Dialog v-if="importing" :title="t('issue.importDoc')" :width="460" @close="closeImport">
        <div class="field">
          <label class="label" for="doc-url">{{ t('issue.docLink') }}</label>
          <input id="doc-url" ref="docInput" v-model="docUrl" class="input" type="url" @keydown.enter.prevent="importDoc" />
        </div>
        <div v-if="importError" class="err">{{ importError }}</div>
        <template #footer>
          <button class="btn" type="button" @click="closeImport">{{ t('common.cancel') }}</button>
          <button class="btn btn--primary" type="button" :disabled="!docUrl.trim() || importBusy" @click="importDoc">
            {{ t('issue.import') }}
          </button>
        </template>
      </Dialog>
      <Dialog v-if="deletingComment" :title="t('issue.deleteComment')" @close="deletingComment = null">
        <p class="iv__lede">{{ t('issue.deleteCommentText') }}</p>
        <template #footer>
          <button class="btn" type="button" @click="deletingComment = null">{{ t('common.cancel') }}</button>
          <button class="btn btn--danger" type="button" @click="confirmRemoveComment">{{ t('issue.deleteComment') }}</button>
        </template>
      </Dialog>
    </div>
  </Teleport>
</template>

<style scoped>
.iv__expected {
  margin-top: var(--space-2);
}
.iv__scrim {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-5);
  background: var(--scrim);
}
.iv__win {
  display: flex;
  flex-direction: column;
  width: min(1100px, 100%);
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
.iv__top.is-off {
  visibility: hidden;
}
.iv__star.is-on {
  color: var(--accent);
}
.iv__trash:hover:enabled {
  color: var(--danger-text);
}
.iv__key,
.iv__path {
  flex: 0 0 auto;
}
.iv__path {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  white-space: nowrap;
}
.iv__where {
  font-size: 13px;
  color: var(--text-dim);
}
.iv__project {
  color: var(--accent-bright);
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
.iv__title--ro:hover {
  border-color: transparent;
  background: none;
}
.iv__body :deep(p:last-child) {
  margin-bottom: 0;
}
.hi {
  grid-template-columns: 152px 180px minmax(0, 1fr);
}
.hi__who {
  min-width: 0;
  overflow: hidden;
}
.cm--lead {
  order: -1;
}
.itab--order {
  font-size: 14px;
}
.iv__list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
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
.att__all__tip::before,
.att__all__tip::after {
  left: auto;
  right: 7px;
  margin-left: 0;
}
.links {
  flex-wrap: wrap;
  gap: 6px;
  height: auto;
  min-height: 26px;
}
.lgroups {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  align-items: center;
  gap: 6px 12px;
}
.lgroups .links {
  display: flex;
  align-items: center;
}
.lgroups__add {
  margin-left: auto;
}
.pick__find {
  display: flex;
  gap: 6px;
}
.pick__kind {
  flex: 0 0 150px;
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
.pick__group {
  flex: none;
  padding: 0 8px;
}
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
.react.is-mine .react__n {
  color: var(--accent);
}
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
.cm__edit {
  margin-top: 8px;
}
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
.drop.is-off {
  pointer-events: none;
  opacity: 0.6;
}
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
.props__toggle {
  display: none;
}
.props__all {
  display: contents;
}
.prop__pair {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.pinged {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 26px;
  height: 26px;
  color: var(--text-dim);
}
.prop__pair .btn {
  flex: none;
}
.prop__pair > :first-child {
  flex: 1 1 auto;
  min-width: 0;
}
.iv__who {
  margin-right: 8px;
}
.via {
  margin-left: 8px;
  color: var(--text-muted);
}
.via .ic {
  vertical-align: -2px;
}
.ev {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 12px;
  color: var(--text-dim);
  font-size: 13px;
}
.ev__ic {
  justify-self: center;
  margin-top: 4px;
  color: var(--text-muted);
}
.ev__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
}
.ev__head .nick {
  margin-left: 0;
}
.ev__ref {
  font: 12px var(--font-num);
  color: var(--text-dim);
}
.ev__commit {
  display: flex;
  gap: 10px;
  min-width: 0;
  margin-top: 4px;
  color: var(--text-dim);
  text-decoration: none;
}
.ev__commit:hover {
  color: var(--text);
}
.ev__at {
  flex: none;
  margin-left: auto;
}
.ev__sha {
  flex: none;
  font: 12px var(--font-num);
  color: var(--text-muted);
}
.ev__msg {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 760px) {
  .iv__scrim {
    padding: 0;
  }
  .iv {
    display: flex;
    flex-direction: column;
    gap: 22px;
    padding: 20px 24px 24px;
    overflow-y: auto;
  }
  .iv__main {
    display: contents;
  }
  .iv__main > * {
    order: 2;
  }
  .iv__main > .iv__title,
  .iv__main > .iv__title-edit {
    order: 0;
  }
  .props {
    order: 1;
    padding: 0;
    overflow: visible;
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
  }
  .props--sk .prop:nth-child(n + 2) {
    display: none;
  }
  .props__toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 40px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-dim);
    font: 13px var(--font-ui);
    text-align: left;
    cursor: pointer;
  }
  .props__sum {
    flex: 1 1 auto;
    min-width: 0;
  }
  .props__date {
    font: 12px var(--font-num);
  }
  .props__all:not(.is-open) {
    display: none;
  }
  .props__all.is-open {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-bottom: 10px;
  }
  .iv__project,
  .iv__project + .iv__sep {
    display: none;
  }
  .hi {
    grid-template-columns: auto minmax(0, 1fr);
    gap: 4px 12px;
    padding: 8px 0;
  }
  .hi__what {
    grid-column: 1 / -1;
  }
  .ev__commit {
    flex-wrap: wrap;
    row-gap: 2px;
  }
  .ev__msg {
    order: 2;
    flex-basis: 100%;
    white-space: normal;
  }
}
</style>
