import type { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { hashToken, newRawToken, requireSession } from './auth.js';
import { DENIES_NOTHING, deniedFor } from './board-service.js';
import { inTransaction, pool, UUID_RE } from './db.js';
import { deed, langOf, shortDay, WORDS, type Deed, type Gender, type Lang } from './words.js';
import { env } from './env.js';
import { publish, tabOf } from './events.js';
import { boardDefaults, createIssue, recordFile, storeFile } from './issue-routes.js';
import { NOTICE_ISSUE, plain } from './notice-routes.js';

export type Channel = 'telegram' | 'vk';
export const CHANNELS: Channel[] = ['telegram', 'vk'];

export type Segment = string | { text: string; url: string };

export interface Note {
  head?: Segment[];
  lines: Segment[][];
}

export interface Button {
  text: string;
  data: string;
}

export type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; gone?: boolean; missing?: boolean; unchanged?: boolean; retryAfter?: number };

export interface DraftFile {
  id: string;
  name: string;
  mime: string;
}

export interface Adapter {
  channel: Channel;
  title: string;
  ready(): boolean;
  linkUrl(code: string): string | null;
  send(peer: number, note: Note, options?: { replyTo?: number; buttons?: Button[][] }): Promise<Outcome<number | null>>;
  edit(peer: number, id: number, note: Note): Promise<Outcome<null>>;
  remove(peer: number, id: number): Promise<void>;
  download(file: DraftFile): Promise<Readable | null>;
}

export interface Incoming {
  chat: number;
  from: number;
  messageId: number;
  files: DraftFile[];
  source?: { text: string; files: DraftFile[] };
}

const LINK_MINUTES = 15;
const QUOTE_LIMIT = 300;
const MAX_ATTEMPTS = 8;
export const FILE_LIMIT = 20 * 1024 * 1024;

const adapters = new Map<Channel, Adapter>();

export function registerAdapter(adapter: Adapter): void {
  adapters.set(adapter.channel, adapter);
}

const adapterOf = (channel: string): Adapter | undefined => adapters.get(channel as Channel);

const note = (head: Segment[] | null, ...lines: (Segment[] | string)[]): Note => ({
  ...(head ? { head } : {}),
  lines: lines.filter((l) => l.length).map((l) => (typeof l === 'string' ? [l] : l)),
});

interface Teller {
  id: string;
  login: string;
  is_admin: boolean;
  role_id: string | null;
  lang: string;
  lang_seen: string | null;
}

interface SendRow {
  kind: string;
  detail: string | null;
  comment_id: string | null;
  comment_text: string | null;
  files: string[];
  by_login: string | null;
  by_name: string | null;
  by_gender: Gender;
  lang: string;
  lang_seen: string | null;
  readable_id: string;
  summary: string;
  due_date: string | null;
  short_name: string;
  slug: string;
  board_id: string;
  project_id: string;
  peer: number | null;
  notices_off: string[];
  active: boolean;
  is_admin: boolean;
  role_id: string | null;
  sent_peer: number | null;
  message_id: number | null;
  attempts: number;
  version: number;
}

interface Draft {
  summary: string;
  description: string;
  files: DraftFile[];
}

interface DraftRow extends Draft {
  chat_id: number;
  message_id: number | null;
  boards: string[];
}

async function langOfUser(id: string): Promise<Lang> {
  const res = await pool.query<{ lang: string; lang_seen: string | null }>('select lang, lang_seen from users where id = $1', [id]);
  return langOf(res.rows[0]?.lang, res.rows[0]?.lang_seen);
}

const whoIs = (lang: Lang, login: string | null, name: string | null): string =>
  !login ? WORDS[lang].someone : name && name !== login ? `${name} (${login})` : login;

function said(n: SendRow): string {
  const text = plain(n.comment_text ?? '');
  const cut = text.length > QUOTE_LIMIT ? `${text.slice(0, QUOTE_LIMIT).trimEnd()}…` : text;
  return [cut ? `"${cut}"` : '', ...n.files.map((f) => `[${f}]`)].filter(Boolean).join(' ');
}

function changesOf(lang: Lang, detail: string | null, names: Map<string, string>): string {
  const words = WORDS[lang];
  const changes = JSON.parse(detail ?? '[]') as { field: string; from: string | null; to: string | null }[];
  const show = (field: string, value: string | null): string => {
    if (!value) return '—';
    if (field === 'assignee' || field === 'watcher') return names.get(value) ?? value;
    if (field === 'due date') return shortDay(lang, value);
    if (field === 'priority') return words.priority[value] ?? value;
    return value;
  };
  return changes
    .map((c) => {
      if (c.field === 'link added') return words.linked(c.to);
      if (c.field === 'link removed') return words.unlinked(c.to);
      return `${words.fields[c.field] ?? c.field} ${show(c.field, c.from)} → ${show(c.field, c.to)}`;
    })
    .join(', ');
}

function noticeNote(n: SendRow, names: Map<string, string>): Note | null {
  const lang = langOf(n.lang, n.lang_seen);
  const who = whoIs(lang, n.by_login, n.by_name);
  const did = (what: Deed, extra = ''): string => `${who} ${deed(lang, what, n.by_gender, extra)}`;
  const url = `${env.publicUrl}/${n.short_name}/${n.slug}/${n.readable_id}${n.comment_id ? `?c=${n.comment_id}` : ''}`;
  const issue: Segment[] = [{ text: n.readable_id, url }, ` ${n.summary}`];
  switch (n.kind) {
    case 'mention':
      return note([did('mentioned')], issue, said(n));
    case 'assigned':
      return note(
        [did(n.detail === 'watcher' ? 'review' : 'assigned')],
        issue,
        n.due_date ? WORDS[lang].due(shortDay(lang, n.due_date)) : ''
      );
    case 'ping':
      return note([did('pinged')], issue);
    case 'reaction':
      return note([did('reacted', n.detail ?? '')], issue, said(n));
    case 'starred':
      return n.comment_id
        ? note([did('commentedStarred')], issue, said(n))
        : note([did('changedStarred')], issue, changesOf(lang, n.detail, names));
    default:
      return null;
  }
}

const SEND_SELECT = `
  select n.kind, n.detail, n.comment_id, c.text as comment_text,
         coalesce((select array_agg(a.filename order by a.created_at)
                     from issue_attachments a where a.comment_id = n.comment_id), '{}') as files,
         bu.login as by_login, bu.full_name as by_name, bu.gender as by_gender, u.lang, u.lang_seen,
         i.readable_id, i.summary, i.due_date, i.board_id, i.project_id, p.short_name, b.slug,
         l.peer_id as peer, u.notices_off, u.active, u.is_admin, u.role_id,
         s.peer_id as sent_peer, s.message_id, s.attempts, s.version
    from messenger_sends s
    join notices n on n.id = s.notice_id
    join users u on u.id = n.user_id
    left join messenger_links l on l.user_id = n.user_id and l.channel = s.channel
    left join users bu on bu.id = n.by_id
    ${NOTICE_ISSUE}
    join projects p on p.id = i.project_id
    join boards b on b.id = i.board_id`;

async function mayRead(n: { is_admin: boolean; role_id: string | null; project_id: string; board_id: string }): Promise<boolean> {
  const denied = n.is_admin ? DENIES_NOTHING : await deniedFor(n.role_id);
  return !denied.everything && !denied.projects.has(n.project_id) && !denied.boards.has(n.board_id);
}

async function dropLink(channel: Channel, peer: number): Promise<void> {
  const res = await pool.query<{ user_id: string }>(
    'delete from messenger_links where channel = $1 and peer_id = $2 returning user_id',
    [channel, peer]
  );
  for (const r of res.rows) void publish({ type: 'session.changed', only: r.user_id });
}

async function settle(
  noticeId: string,
  channel: Channel,
  version: number,
  sent: { peer: number; message: number | null } | null,
  error: string | null
): Promise<void> {
  await pool.query(
    `update messenger_sends
        set pending = version <> $3, last_error = $4,
            peer_id = coalesce($5, peer_id), message_id = case when $5::bigint is null then message_id else $6 end
      where notice_id = $1 and channel = $2`,
    [noticeId, channel, version, error, sent?.peer ?? null, sent?.message ?? null]
  );
}

async function retry(n: SendRow, noticeId: string, channel: Channel, error: string, after?: number): Promise<void> {
  const attempts = n.attempts + 1;
  await pool.query(
    `update messenger_sends
        set attempts = $4, last_error = $5, pending = $6, due_at = now() + make_interval(secs => $7)
      where notice_id = $1 and channel = $2 and version = $3`,
    [noticeId, channel, n.version, attempts, error.slice(0, 500), attempts < MAX_ATTEMPTS, after ?? Math.min(5 * 2 ** attempts, 600)]
  );
}

async function deliver(noticeId: string, channel: Channel, names: Map<string, string>): Promise<void> {
  const res = await pool.query<SendRow>(`${SEND_SELECT} where s.notice_id = $1 and s.channel = $2 and s.pending`, [
    noticeId,
    channel,
  ]);
  const n = res.rows[0];
  if (!n) return;
  const adapter = adapterOf(channel);
  const peer = n.peer;
  const text = noticeNote(n, names);
  if (!adapter?.ready() || !peer || !text || !n.active || n.notices_off.includes(n.kind) || !(await mayRead(n))) {
    await settle(noticeId, channel, n.version, null, null);
    return;
  }
  const editing = n.message_id !== null && n.sent_peer === peer;
  let result: Outcome<number | null>;
  try {
    result = editing ? await adapter.edit(peer, n.message_id as number, text) : await adapter.send(peer, text);
  } catch (err) {
    await retry(n, noticeId, channel, (err as Error).message);
    return;
  }
  if (result.ok || result.unchanged) {
    const message = editing ? n.message_id : result.ok ? result.value : null;
    await settle(noticeId, channel, n.version, { peer, message }, null);
    return;
  }
  if (result.gone) {
    await dropLink(channel, peer);
    await settle(noticeId, channel, n.version, null, result.error);
    return;
  }
  if (editing && result.missing) {
    await pool.query('update messenger_sends set message_id = null where notice_id = $1 and channel = $2', [
      noticeId,
      channel,
    ]);
    return;
  }
  await retry(n, noticeId, channel, result.error, result.retryAfter);
}

let delivering = false;

async function deliverDue(): Promise<void> {
  if (delivering) return;
  delivering = true;
  try {
    const due = await pool.query<{ notice_id: string; channel: Channel }>(
      'select notice_id, channel from messenger_sends where pending and due_at <= now() order by due_at limit 20'
    );
    if (!due.rows.length) return;
    const people = await pool.query<{ login: string; full_name: string }>('select login, full_name from users');
    const names = new Map(people.rows.map((p) => [p.login, p.full_name || p.login]));
    for (const { notice_id, channel } of due.rows) await deliver(notice_id, channel, names);
  } catch (err) {
    console.error('[messenger] delivery failed', (err as Error).message);
  } finally {
    delivering = false;
  }
}

export async function linkByCode(adapter: Adapter, peer: number, name: string | null, code: string): Promise<void> {
  const linked = await inTransaction(async (client) => {
    const hit = await client.query<{ user_id: string }>(
      'delete from messenger_codes where code_hash = $1 and channel = $2 and expires_at > now() returning user_id',
      [hashToken(code), adapter.channel]
    );
    const userId = hit.rows[0]?.user_id;
    if (!userId) return null;
    const who = await client.query<{ login: string }>('select login from users where id = $1', [userId]);
    const before = await client.query<{ peer_id: number }>(
      'select peer_id from messenger_links where user_id = $1 and channel = $2 for update',
      [userId, adapter.channel]
    );
    const displaced = await client.query<{ user_id: string }>(
      `delete from messenger_links where channel = $1 and peer_id = $2 and user_id <> $3 returning user_id`,
      [adapter.channel, peer, userId]
    );
    await client.query(
      `insert into messenger_links (user_id, channel, peer_id, name) values ($1, $2, $3, $4)
       on conflict (user_id, channel) do update set peer_id = excluded.peer_id, name = excluded.name`,
      [userId, adapter.channel, peer, name]
    );
    return {
      userId,
      login: who.rows[0].login,
      previous: before.rows[0]?.peer_id ?? null,
      displaced: displaced.rows.map((r) => r.user_id),
    };
  });
  if (!linked) {
    const owner = await pool.query<{ lang: string; lang_seen: string | null }>(
      `select u.lang, u.lang_seen from messenger_codes c join users u on u.id = c.user_id
        where c.code_hash = $1 and c.channel = $2`,
      [hashToken(code), adapter.channel]
    );
    const words = WORDS[langOf(owner.rows[0]?.lang, owner.rows[0]?.lang_seen)];
    const [before, link, after] = words.getNew;
    await adapter.send(peer, note([words.expired], [before, { text: link, url: `${env.publicUrl}/profile` }, after]));
    return;
  }
  for (const id of [linked.userId, ...linked.displaced]) void publish({ type: 'session.changed', only: id });
  const words = WORDS[await langOfUser(linked.userId)];
  if (linked.previous && linked.previous !== peer) {
    await adapter.send(linked.previous, note([words.linkedElsewhere(linked.login, adapter.title)])).catch(() => {});
  }
  await adapter.send(peer, note([words.isLinked(linked.login)], words.willNotify));
}

const tellerOf = async (channel: Channel, peer: number): Promise<Teller | null> =>
  (
    await pool.query<Teller>(
      `select u.id, u.login, u.is_admin, u.role_id, u.lang, u.lang_seen
         from messenger_links l join users u on u.id = l.user_id
        where l.channel = $1 and l.peer_id = $2 and u.active`,
      [channel, peer]
    )
  ).rows[0] ?? null;

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const paragraphs = (text: string): string =>
  text
    ? text
        .split('\n')
        .map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : '<p><br></p>'))
        .join('')
    : '';

async function boardsFor(user: Teller): Promise<{ id: string; label: string }[]> {
  const denied = user.is_admin ? DENIES_NOTHING : await deniedFor(user.role_id);
  if (denied.everything) return [];
  const res = await pool.query<{ id: string; name: string; short_name: string; project_id: string }>(
    `select b.id, b.name, p.short_name, p.id as project_id
       from boards b join projects p on p.id = b.project_id
      where not p.archived and b.default_state_id is not null
      order by p.position, p.short_name, b.position, b.created_at`
  );
  return res.rows
    .filter((b) => !denied.projects.has(b.project_id) && !denied.boards.has(b.id))
    .map((b) => ({ id: b.id, label: `${b.short_name} ${b.name}` }));
}

async function attach(
  adapter: Adapter,
  issue: Parameters<typeof recordFile>[0],
  file: DraftFile,
  user: Teller
): Promise<void> {
  const stream = await adapter.download(file);
  if (!stream) return;
  const stored = await storeFile(issue.id, stream, file.name);
  await recordFile(
    issue,
    { stored, filename: file.name, mime: file.mime, commentId: null },
    { userId: user.id, login: user.login }
  );
}

async function fileIssue(adapter: Adapter, user: Teller, boardId: string, draft: Draft): Promise<Note | null> {
  if (!(await boardsFor(user)).some((b) => b.id === boardId)) return null;
  const board = await boardDefaults(boardId);
  if (!board) return null;
  const made = await createIssue(
    { userId: user.id, login: user.login },
    boardId,
    board,
    { summary: draft.summary, description: draft.description },
    { viaBot: true }
  );
  if ('error' in made) return null;
  for (const file of draft.files) {
    await attach(adapter, made.issue, file, user).catch((err) =>
      console.error(`[${adapter.channel}] file not attached`, (err as Error).message)
    );
  }
  const place = await pool.query<{ short_name: string; slug: string }>(
    'select p.short_name, b.slug from boards b join projects p on p.id = b.project_id where b.id = $1',
    [boardId]
  );
  const { short_name: short, slug } = place.rows[0];
  const key = made.issue.readable_id;
  return note(null, [
    WORDS[langOf(user.lang, user.lang_seen)].created,
    { text: key, url: `${env.publicUrl}/${short}/${slug}/${key}` },
    ` ${made.issue.summary}`,
  ]);
}

export async function issueCommand(adapter: Adapter, args: string, m: Incoming): Promise<void> {
  const user = await tellerOf(adapter.channel, m.from);
  if (!user) return;
  const told = (m.source?.text ?? '').trim();
  const [head = '', ...more] = args.trim().split('\n');
  let summary = head.trim();
  let rest = [more.join('\n').trim(), told];
  if (!summary) {
    const [first = '', ...after] = told.split('\n');
    summary = first.trim();
    rest = [after.join('\n').trim()];
  }
  if (!summary) return;
  const boards = await boardsFor(user);
  if (!boards.length) return;
  const draft: Draft = {
    summary: summary.slice(0, 300),
    description: paragraphs(rest.filter(Boolean).join('\n\n').slice(0, 15000)),
    files: [...m.files, ...(m.source?.files ?? [])],
  };
  if (boards.length === 1) {
    const created = await fileIssue(adapter, user, boards[0].id, draft);
    if (created) await adapter.send(m.chat, created, { replyTo: m.messageId });
    return;
  }
  await pool.query("delete from messenger_drafts where created_at < now() - interval '1 day'");
  const saved = await pool.query<{ id: string }>(
    `insert into messenger_drafts (user_id, channel, chat_id, summary, description, files, boards)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [user.id, adapter.channel, m.chat, draft.summary, draft.description, JSON.stringify(draft.files), boards.map((b) => b.id)]
  );
  const id = saved.rows[0].id;
  const rows: Button[][] = [];
  boards.forEach((b, i) => {
    const button = { text: b.label, data: `i:${id}:${i}` };
    if (i % 2) rows[rows.length - 1].push(button);
    else rows.push([button]);
  });
  const sent = await adapter.send(m.chat, note([draft.summary]), {
    replyTo: m.messageId,
    buttons: [...rows, [{ text: WORDS[langOf(user.lang, user.lang_seen)].cancel, data: `x:${id}` }]],
  });
  if (sent.ok && sent.value !== null) {
    await pool.query('update messenger_drafts set message_id = $2 where id = $1', [id, sent.value]);
  }
}

export async function pick(adapter: Adapter, from: number, data: string): Promise<void> {
  const [kind, draftId, index] = data.split(':');
  if (!UUID_RE.test(draftId ?? '')) return;
  const user = await tellerOf(adapter.channel, from);
  if (!user) return;
  const res = await pool.query<DraftRow>(
    'delete from messenger_drafts where id = $1 and user_id = $2 and channel = $3 returning *',
    [draftId, user.id, adapter.channel]
  );
  const draft = res.rows[0];
  if (!draft?.message_id) return;
  if (kind === 'x') {
    await adapter.remove(draft.chat_id, draft.message_id);
    return;
  }
  const boardId = kind === 'i' ? draft.boards[Number(index)] : undefined;
  if (!boardId) return;
  const created = await fileIssue(adapter, user, boardId, draft);
  if (!created) return;
  const edited = await adapter.edit(draft.chat_id, draft.message_id, created);
  if (!edited.ok && !edited.unchanged) await adapter.send(draft.chat_id, created);
}

export function registerMessengerRoutes(app: FastifyInstance): void {
  app.post('/me/:channel/link', async (req, reply) => {
    const auth = await requireSession(req, reply);
    if (!auth) return;
    const adapter = adapterOf((req.params as { channel: string }).channel);
    if (!adapter) return reply.code(404).send({ error: 'Not found.' });
    if (!adapter.ready()) return reply.code(503).send({ error: `${adapter.title} is not set up.` });
    const code = newRawToken();
    const url = adapter.linkUrl(code);
    if (!url) return reply.code(503).send({ error: `${adapter.title} is not set up.` });
    await pool.query('delete from messenger_codes where expires_at < now() or (user_id = $1 and channel = $2)', [
      auth.userId,
      adapter.channel,
    ]);
    await pool.query(
      `insert into messenger_codes (code_hash, user_id, channel, expires_at)
       values ($1, $2, $3, now() + make_interval(mins => $4))`,
      [hashToken(code), auth.userId, adapter.channel, LINK_MINUTES]
    );
    return reply.send({ data: { url } });
  });

  app.delete('/me/:channel', async (req, reply) => {
    const auth = await requireSession(req, reply);
    if (!auth) return;
    const adapter = adapterOf((req.params as { channel: string }).channel);
    if (!adapter) return reply.code(404).send({ error: 'Not found.' });
    const res = await pool.query<{ peer_id: number }>(
      'delete from messenger_links where user_id = $1 and channel = $2 returning peer_id',
      [auth.userId, adapter.channel]
    );
    const peer = res.rows[0]?.peer_id;
    if (peer && adapter.ready()) {
      const words = WORDS[await langOfUser(auth.userId)];
      await adapter.send(peer, note([words.unlinkedFrom(auth.login)], words.wontNotify)).catch(() => {});
    }
    void publish({ type: 'session.changed', only: auth.userId, origin: tabOf(req) });
    return reply.send({ data: { ok: true } });
  });
}

export function startMessengers(): void {
  if (![...adapters.values()].some((a) => a.ready())) return;
  setInterval(() => void deliverDue(), 2000).unref();
}
