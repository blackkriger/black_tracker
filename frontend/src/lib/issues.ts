import { i18n, locale } from '../i18n';
import { RU_MONTHS_SHORT, todayKey } from './calendar';
import { stored } from './storage';
import { PRIORITIES, REACTIONS, type LinkKind, type Priority } from '../../../shared/rules';

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

export type { Priority };

export interface Issue {
  id: string;
  key: string;
  projectId: string;
  boardId: string;
  summary: string;
  description: string;
  expected: string;
  stateId: string;
  priority: Priority;
  assignee: Person | null;
  watcher: Person | null;
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

export { REACTIONS };

export interface Comment {
  id: string;
  text: string;
  author: Person;
  reactions: { emoji: string; by: string }[];
  createdAt: string;
  editedAt: string | null;
  pinnedAt: string | null;
  pinnedBy: string | null;
  viaToken?: boolean;
}

export interface HistoryEntry {
  id: string;
  field: string;
  from: string | null;
  to: string | null;
  by: string | null;
  viaToken?: boolean;
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

export type { LinkKind };

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

export { PRIORITIES };

const ORDER_KEY = 'tracker:comment-order';
export type CommentOrder = 'oldest' | 'newest';

export const commentOrder = {
  get(): CommentOrder {
    return stored.get(ORDER_KEY) === 'newest' ? 'newest' : 'oldest';
  },
  set(order: CommentOrder): void {
    stored.set(ORDER_KEY, order);
  },
};

const CARD_ORDER_KEY = 'tracker:card-order:';
export type CardOrder = 'manual' | 'priority' | 'due';

export const cardOrder = {
  get(boardId: string): CardOrder {
    const kept = stored.get(CARD_ORDER_KEY + boardId);
    return kept === 'priority' || kept === 'due' ? kept : 'manual';
  },
  set(boardId: string, order: CardOrder): void {
    stored.set(CARD_ORDER_KEY + boardId, order);
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

export const priorityChoice = (p: Priority): { value: Priority; label: string; color: string } => ({
  value: p,
  label: i18n.global.t(`priority.${p}`),
  color: priorityColor(p),
});

const ruShort = (d: Date, withYear: boolean): string =>
  `${String(d.getDate()).padStart(2, '0')} ${RU_MONTHS_SHORT[d.getMonth()].toUpperCase()}${withYear ? ` ${d.getFullYear()}` : ''}`;

export function stamp(iso: string | null): string {
  if (!iso) return '';
  if (locale.value === 'ru') return ruShort(new Date(iso), true);
  return new Date(iso)
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase();
}

export function dueLabel(date: string | null): { text: string; late: boolean } | null {
  if (!date) return null;
  const today = todayKey();
  const day = new Date(`${date}T00:00:00`);
  return {
    text:
      locale.value === 'ru'
        ? ruShort(day, false)
        : day.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).toUpperCase(),
    late: date < today,
  };
}

export function stampAt(iso: string): string {
  const d = new Date(iso);
  if (locale.value === 'ru') return `${ruShort(d, true)} ${d.toLocaleTimeString('en-GB', { hour12: false })}`;
  const day = d
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase();
  return `${day} ${d.toLocaleTimeString('en-GB', { hour12: false })}`;
}

export function fileSize(bytes: number): string {
  const ru = locale.value === 'ru';
  if (bytes < 1024) return `${bytes} ${ru ? 'Б' : 'B'}`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ${ru ? 'КБ' : 'KB'}`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} ${ru ? 'МБ' : 'MB'}`;
}
