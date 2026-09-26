// The shape of an issue as the API hands it over, shared by the board's cards and the view that opens on one.

export interface Person {
  id: string;
  login: string;
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
  reporter: Person | null;
  dueDate: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  tags: IssueTag[];
}

export interface Comment {
  id: string;
  text: string;
  author: Person;
  createdAt: string;
  editedAt: string | null;
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

export interface IssueFull extends Issue {
  comments: Comment[];
  history: HistoryEntry[];
  attachments: Attachment[];
}

export const PRIORITIES: Priority[] = ['Critical', 'Major', 'Normal', 'Minor'];

/** How many of the four bars are lit, which is how priority reads on a card without relying on hue alone. */
export const priorityClass = (p: Priority): string =>
  ({ Critical: 'p4', Major: 'p3', Normal: 'p2', Minor: 'p1' })[p];

export function stamp(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso)
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase();
}

/** A due date reads as the day itself, and turns red once it is behind us. */
export function dueLabel(date: string | null): { text: string; late: boolean } | null {
  if (!date) return null;
  const today = new Date().toISOString().slice(0, 10);
  return {
    text: new Date(`${date}T00:00:00`)
      .toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
      .toUpperCase(),
    late: date < today,
  };
}

/** History is read to answer "when exactly", so it carries the clock as well as the day. */
export function stampAt(iso: string): string {
  const d = new Date(iso);
  const day = d
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase();
  return `${day} ${d.toLocaleTimeString('en-GB', { hour12: false })}`;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
