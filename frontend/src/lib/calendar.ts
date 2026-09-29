// The month, as a grid. The week starts on Monday, the leading and trailing blanks keep
// whole rows, and a day is always the same string everywhere: YYYY-MM-DD, local time.
export interface Cell {
  day: number | null;
  key?: string;
  weekend?: boolean;
  today?: boolean;
}

export interface Mark {
  id: string;
  day: string;
  title: string;
  /** The event's page, and the picture that links to it. */
  url: string | null;
  banner: string | null;
  project: { shortName: string; name: string } | null;
  by: string | null;
}

export interface Due {
  key: string;
  summary: string;
  projectShort: string;
  boardId: string;
  boardSlug: string;
  color: string;
  done: boolean;
}

export interface Activity {
  day: string;
  login: string;
  worked: number;
  created: number;
  resolved: number;
}

/** What was said to the reader that day, by kind, and how much of it is unseen. */
export interface DayMentions {
  day: string;
  kind: string;
  said: number;
  unread: number;
}

export interface DayInfo {
  marks: Mark[];
  dues: Due[];
  worked: number;
  created: number;
  resolved: number;
  said: number;
  unread: number;
  /** How many are unseen, per kind, so a day can say which kind is waiting. */
  unreadOf: Record<string, number>;
}

export const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export const pad2 = (n: number): string => String(n).padStart(2, '0');

export const dayKey = (year: number, month: number, day: number): string =>
  `${year}-${pad2(month + 1)}-${pad2(day)}`;

export function todayKey(): string {
  const d = new Date();
  return dayKey(d.getFullYear(), d.getMonth(), d.getDate());
}

export const daysInMonth = (year: number, month: number): number =>
  new Date(year, month + 1, 0).getDate();

/** Monday is 0 here, which is where every row of the grid starts. */
export function firstWeekday(year: number, month: number): number {
  const d = new Date(year, month, 1).getDay();
  return d === 0 ? 6 : d - 1;
}

export function monthName(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

/** The day without its weekday, for places that already say which day they mean. */
export function dayAndMonth(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

export function shortDate(key: string, withYear = true): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: withYear ? '2-digit' : undefined,
    timeZone: 'UTC',
  });
}

export function spanLabel(from: string, to: string, withYear = true): string {
  return from === to
    ? shortDate(from, withYear)
    : `${shortDate(from, withYear)} – ${shortDate(to, withYear)}`;
}

export function longDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const weekday = new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long' });
  return `${weekday}, ${dayAndMonth(key)}`;
}

export function monthGrid(year: number, month: number): Cell[] {
  const cells: Cell[] = [];
  for (let i = 0; i < firstWeekday(year, month); i++) cells.push({ day: null });
  const today = todayKey();
  for (let d = 1; d <= daysInMonth(year, month); d++) {
    const key = dayKey(year, month, d);
    const weekday = new Date(year, month, d).getDay();
    cells.push({ day: d, key, weekend: weekday === 0 || weekday === 6, today: key === today });
  }
  while (cells.length % 7 !== 0) cells.push({ day: null });
  return cells;
}

/** The first and last day of a month, as the calendar route wants them. */
export function monthRange(year: number, month: number): { from: string; to: string } {
  return { from: dayKey(year, month, 1), to: dayKey(year, month, daysInMonth(year, month)) };
}

export function emptyDay(): DayInfo {
  return {
    marks: [],
    dues: [],
    worked: 0,
    created: 0,
    resolved: 0,
    said: 0,
    unread: 0,
    unreadOf: {},
  };
}

/** Everything the server said about a stretch of days, gathered per day. */
export function byDay(
  marks: Mark[],
  dues: { day: string; issues: Due[] }[],
  activity: Activity[],
  mentions: DayMentions[] = []
): Map<string, DayInfo> {
  const map = new Map<string, DayInfo>();
  const at = (key: string): DayInfo => {
    const found = map.get(key) ?? emptyDay();
    map.set(key, found);
    return found;
  };
  for (const m of marks) at(m.day).marks.push(m);
  for (const d of dues) at(d.day).dues.push(...d.issues);
  for (const a of activity) {
    const day = at(a.day);
    day.worked += a.worked;
    day.created += a.created;
    day.resolved += a.resolved;
  }
  for (const m of mentions) {
    const day = at(m.day);
    day.said += m.said;
    day.unread += m.unread;
    if (m.unread) day.unreadOf[m.kind] = (day.unreadOf[m.kind] ?? 0) + m.unread;
  }
  return map;
}
