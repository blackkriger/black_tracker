import { todayKey } from './calendar';

export interface Person {
  id: string;
  login: string;
}

export interface Shot {
  key: string;
  src: string;
  name: string;
  size: number;
}

export interface IssueTag {
  id: string;
  name: string;
  color: string;
}

export type Priority = 'Critical' | 'Major' | 'Normal' | 'Minor';

export interface Issue {
  id: string;
  key: string;
  projectId: string;
  boardId: string;
  summary: string;
  description: string;
  stateId: string;
  priority: Priority;
  assignee: Person | null;
  author: Person | null;
  dueDate: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  viaBot?: boolean;
  favourite: boolean;
  tags: IssueTag[];
  subtasks?: { done: number; total: number } | null;
}

// Must match REACTIONS in backend issue-routes.ts; the server rejects anything else.
export const REACTIONS = [
  '\u{1F44D}',
  '\u{1F44C}',
  '\u{1F64F}',
  '\u{1F440}',
  '\u{2764}\u{FE0F}',
  '\u{1F389}',
  '\u{1F608}',
  '\u{1F921}',
  '\u{1F4A9}',
];

export interface Comment {
  id: string;
  text: string;
  author: Person;
  reactions: { emoji: string; by: string }[];
  createdAt: string;
  editedAt: string | null;
  pinnedAt: string | null;
  pinnedBy: string | null;
}

export interface HistoryEntry {
  id: string;
  field: string;
  from: string | null;
  to: string | null;
  by: string | null;
  at: string;
}

export interface Attachment {
  id: string;
  filename: string;
  mime: string;
  size: number;
  commentId: string | null;
  uploadedBy: string | null;
  createdAt: string;
}

export type LinkKind = 'related' | 'parent' | 'child' | 'duplicateOf' | 'duplicatedBy';

export interface IssueLink {
  id: string;
  key: string;
  summary: string;
  stateName: string;
  stateColor: string;
  projectShort: string;
  boardSlug: string;
  kind: LinkKind;
  resolved: boolean;
}

export interface IssueCommit {
  id: string;
  kind: 'commit' | 'merge';
  sha: string;
  message: string;
  branch: string | null;
  mergedFrom: string | null;
  author: string | null;
  by: string | null;
  at: string;
  url: string;
}

export interface IssueFull extends Issue {
  comments: Comment[];
  history: HistoryEntry[];
  attachments: Attachment[];
  links: IssueLink[];
  commits?: IssueCommit[];
}

export const PRIORITIES: Priority[] = ['Critical', 'Major', 'Normal', 'Minor'];

const ORDER_KEY = 'tracker:comment-order';
export type CommentOrder = 'oldest' | 'newest';

export const commentOrder = {
  get(): CommentOrder {
    try {
      return localStorage.getItem(ORDER_KEY) === 'newest' ? 'newest' : 'oldest';
    } catch {
      return 'oldest';
    }
  },
  set(order: CommentOrder): void {
    try {
      localStorage.setItem(ORDER_KEY, order);
    } catch {}
  },
};

const CARD_ORDER_KEY = 'tracker:card-order:';
export type CardOrder = 'manual' | 'priority' | 'due';

export const cardOrder = {
  get(boardId: string): CardOrder {
    try {
      const kept = localStorage.getItem(CARD_ORDER_KEY + boardId);
      return kept === 'priority' || kept === 'due' ? kept : 'manual';
    } catch {
      return 'manual';
    }
  },
  set(boardId: string, order: CardOrder): void {
    try {
      localStorage.setItem(CARD_ORDER_KEY + boardId, order);
    } catch {}
  },
};

export const priorityColor = (p: Priority): string =>
  ({
    Critical: 'var(--danger-text)',
    Major: 'var(--warn)',
    Normal: 'var(--text)',
    Minor: 'var(--text-muted)',
  })[p];

export const priorityClass = (p: Priority): string =>
  ({ Critical: 'p4', Major: 'p3', Normal: 'p2', Minor: 'p1' })[p];

export function stamp(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso)
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase();
}

export function dueLabel(date: string | null): { text: string; late: boolean } | null {
  if (!date) return null;
  const today = todayKey();
  return {
    text: new Date(`${date}T00:00:00`)
      .toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
      .toUpperCase(),
    late: date < today,
  };
}

export function stampAt(iso: string): string {
  const d = new Date(iso);
  const day = d
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase();
  return `${day} ${d.toLocaleTimeString('en-GB', { hour12: false })}`;
}

// Mirrors the multipart fileSize limit in backend index.ts; change both together.
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
