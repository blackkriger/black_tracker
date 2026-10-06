import { timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream as WebStream } from 'node:stream/web';
import type { FastifyInstance } from 'fastify';
import { hashToken, newRawToken, requireSession } from './auth.js';
import { DENIES_NOTHING, deniedFor } from './board-service.js';
import { inTransaction, pool } from './db.js';
import { env, telegramReady } from './env.js';
import { publish, tabOf } from './events.js';
import { boardDefaults, createIssue, recordFile, storeFile } from './issue-routes.js';
import { plain } from './notice-routes.js';

const LINK_MINUTES = 15;
const QUOTE_LIMIT = 300;
const MAX_ATTEMPTS = 8;
const FILE_LIMIT = 20 * 1024 * 1024;
const START = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{1,64})\s*$/;
const ISSUE = /^\/issue(?:@(\w+))?(?=\s|$)([\s\S]*)$/i;

interface BotReply<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramFile {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramMessage {
  message_id: number;
  chat?: { id: number; type: string };
  from?: TelegramUser;
  text?: string;
  caption?: string;
  photo?: TelegramFile[];
  document?: TelegramFile;
  video?: TelegramFile;
  reply_to_message?: TelegramMessage;
}

interface CallbackQuery {
  id: string;
  from: TelegramUser;
  data?: string;
}

interface DraftFile {
  id: string;
  name: string;
  mime: string;
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

interface Teller {
  id: string;
  login: string;
  is_admin: boolean;
  role_id: string | null;
}

interface SendRow {
  kind: string;
  detail: string | null;
  comment_id: string | null;
  comment_text: string | null;
  files: string[];
  by_login: string | null;
  by_name: string | null;
  readable_id: string;
  summary: string;
  due_date: string | null;
  short_name: string;
  slug: string;
  board_id: string;
  project_id: string;
  telegram_chat_id: number | null;
  notices_off: string[];
  active: boolean;
  is_admin: boolean;
  role_id: string | null;
  sent_chat: number | null;
  message_id: number | null;
  attempts: number;
  version: number;
}

async function bot<T>(method: string, body: object): Promise<BotReply<T>> {
  const res = await fetch(`https://api.telegram.org/bot${env.telegramBotToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return (await res.json()) as BotReply<T>;
}

const say = (chatId: number, text: string, extra: object = {}) =>
  bot<{ message_id: number }>('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...extra,
  });

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const whoIs = (login: string | null, name: string | null): string =>
  !login ? 'Someone' : name && name !== login ? `${name} (${login})` : login;

const dayOf = (date: string): string =>
  new Date(`${date}T00:00:00Z`)
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })
    .toUpperCase();

function said(n: SendRow): string {
  const text = plain(n.comment_text ?? '');
  const cut = text.length > QUOTE_LIMIT ? `${text.slice(0, QUOTE_LIMIT).trimEnd()}…` : text;
  return [cut ? `"${esc(cut)}"` : '', ...n.files.map((f) => `[${esc(f)}]`)].filter(Boolean).join(' ');
}

function changesOf(detail: string | null, names: Map<string, string>): string {
  const changes = JSON.parse(detail ?? '[]') as { field: string; from: string | null; to: string | null }[];
  const show = (field: string, value: string | null): string => {
    if (!value) return '—';
    if (field === 'assignee') return names.get(value) ?? value;
    if (field === 'due date') return dayOf(value);
    return value;
  };
  return changes
    .map((c) => {
      if (c.field === 'link added') return `linked ${c.to}`;
      if (c.field === 'link removed') return `unlinked ${c.to}`;
      return `${c.field === 'due date' ? 'due' : c.field} ${show(c.field, c.from)} → ${show(c.field, c.to)}`;
    })
    .join(', ');
}

export function renderNotice(n: SendRow, names: Map<string, string>): string | null {
  const who = esc(whoIs(n.by_login, n.by_name));
  const url = `${env.publicUrl}/${n.short_name}/${n.slug}/${n.readable_id}${n.comment_id ? `?c=${n.comment_id}` : ''}`;
  const issue = `<a href="${esc(url)}">${esc(n.readable_id)}</a> ${esc(n.summary)}`;
  const lines = (head: string, rest: string): string =>
    [`<b>${head}</b>`, issue, rest].filter(Boolean).join('\n');
  switch (n.kind) {
    case 'mention':
      return lines(`${who} mentioned you`, said(n));
    case 'assigned':
      return lines(`${who} assigned you`, n.due_date ? `Due ${dayOf(n.due_date)}` : '');
    case 'reaction':
      return lines(`${who} reacted ${esc(n.detail ?? '')} to your comment`, said(n));
    case 'starred':
      return n.comment_id
        ? lines(`${who} commented on a starred issue`, said(n))
        : lines(`${who} changed a starred issue`, esc(changesOf(n.detail, names)));
    default:
      return null;
  }
}

const SEND_SELECT = `
  select n.kind, n.detail, n.comment_id, c.text as comment_text,
         coalesce((select array_agg(a.filename order by a.created_at)
                     from issue_attachments a where a.comment_id = n.comment_id), '{}') as files,
         bu.login as by_login, bu.full_name as by_name,
         i.readable_id, i.summary, i.due_date, i.board_id, i.project_id, p.short_name, b.slug,
         u.telegram_chat_id, u.notices_off, u.active, u.is_admin, u.role_id,
         s.chat_id as sent_chat, s.message_id, s.attempts, s.version
    from telegram_sends s
    join notices n on n.id = s.notice_id
    join users u on u.id = n.user_id
    left join users bu on bu.id = n.by_id
    left join issue_comments c on c.id = n.comment_id
    join issues i on i.id = coalesce(c.issue_id, n.issue_id)
    join projects p on p.id = i.project_id
    join boards b on b.id = i.board_id`;

async function mayRead(n: SendRow): Promise<boolean> {
  const denied = n.is_admin ? DENIES_NOTHING : await deniedFor(n.role_id);
  return !denied.everything && !denied.projects.has(n.project_id) && !denied.boards.has(n.board_id);
}

async function dropChat(chatId: number): Promise<void> {
  const res = await pool.query<{ id: string }>(
    'update users set telegram_chat_id = null, telegram_name = null where telegram_chat_id = $1 returning id',
    [chatId]
  );
  for (const r of res.rows) void publish({ type: 'session.changed', only: r.id });
}

async function settle(
  noticeId: string,
  version: number,
  sent: { chat: number; message: number | null } | null,
  error: string | null
): Promise<void> {
  await pool.query(
    `update telegram_sends
        set pending = version <> $2, last_error = $3,
            chat_id = coalesce($4, chat_id), message_id = case when $4::bigint is null then message_id else $5 end
      where notice_id = $1`,
    [noticeId, version, error, sent?.chat ?? null, sent?.message ?? null]
  );
}

async function retry(n: SendRow, noticeId: string, error: string, after?: number): Promise<void> {
  const attempts = n.attempts + 1;
  await pool.query(
    `update telegram_sends
        set attempts = $3, last_error = $4, pending = $5, due_at = now() + make_interval(secs => $6)
      where notice_id = $1 and version = $2`,
    [noticeId, n.version, attempts, error.slice(0, 500), attempts < MAX_ATTEMPTS, after ?? Math.min(5 * 2 ** attempts, 600)]
  );
}

async function deliver(noticeId: string, names: Map<string, string>): Promise<void> {
  const res = await pool.query<SendRow>(`${SEND_SELECT} where s.notice_id = $1 and s.pending`, [noticeId]);
  const n = res.rows[0];
  if (!n) return;
  const chat = n.telegram_chat_id;
  const text = renderNotice(n, names);
  if (!chat || !text || !n.active || n.notices_off.includes(n.kind) || !(await mayRead(n))) {
    await settle(noticeId, n.version, null, null);
    return;
  }
  const editing = n.message_id !== null && n.sent_chat === chat;
  let reply: BotReply<{ message_id: number }>;
  try {
    reply = editing
      ? await bot<{ message_id: number }>('editMessageText', {
          chat_id: chat,
          message_id: n.message_id,
          text,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        })
      : await say(chat, text);
  } catch (err) {
    await retry(n, noticeId, (err as Error).message);
    return;
  }
  const why = reply.description ?? '';
  if (reply.ok || /not modified/i.test(why)) {
    await settle(noticeId, n.version, { chat, message: editing ? n.message_id : (reply.result?.message_id ?? null) }, null);
    return;
  }
  if (reply.error_code === 403 || /chat not found/i.test(why)) {
    await dropChat(chat);
    await settle(noticeId, n.version, null, why);
    return;
  }
  if (editing && /message to edit not found/i.test(why)) {
    await pool.query('update telegram_sends set message_id = null where notice_id = $1', [noticeId]);
    return;
  }
  await retry(n, noticeId, why || 'Telegram refused the message.', reply.parameters?.retry_after);
}

let delivering = false;

async function deliverDue(): Promise<void> {
  if (delivering) return;
  delivering = true;
  try {
    const due = await pool.query<{ notice_id: string }>(
      'select notice_id from telegram_sends where pending and due_at <= now() order by due_at limit 20'
    );
    if (!due.rows.length) return;
    const people = await pool.query<{ login: string; full_name: string }>('select login, full_name from users');
    const names = new Map(people.rows.map((p) => [p.login, p.full_name || p.login]));
    for (const { notice_id } of due.rows) await deliver(notice_id, names);
  } catch (err) {
    console.error('[telegram] delivery failed', (err as Error).message);
  } finally {
    delivering = false;
  }
}

function secretRight(header: unknown): boolean {
  if (typeof header !== 'string') return false;
  const want = Buffer.from(env.telegramWebhookSecret);
  const got = Buffer.from(header);
  return want.length === got.length && timingSafeEqual(want, got);
}

const nameOf = (from: TelegramUser | undefined): string | null =>
  from?.username
    ? `@${from.username}`
    : [from?.first_name, from?.last_name].filter(Boolean).join(' ') || null;

async function onStart(chatId: number, from: TelegramUser | undefined, code: string): Promise<void> {
  const linked = await inTransaction(async (client) => {
    const hit = await client.query<{ user_id: string }>(
      'delete from telegram_link_codes where code_hash = $1 and expires_at > now() returning user_id',
      [hashToken(code)]
    );
    const userId = hit.rows[0]?.user_id;
    if (!userId) return null;
    const before = await client.query<{ login: string; telegram_chat_id: number | null }>(
      'select login, telegram_chat_id from users where id = $1 for update',
      [userId]
    );
    const displaced = await client.query<{ id: string }>(
      `update users set telegram_chat_id = null, telegram_name = null
        where telegram_chat_id = $1 and id <> $2 returning id`,
      [chatId, userId]
    );
    await client.query('update users set telegram_chat_id = $2, telegram_name = $3 where id = $1', [
      userId,
      chatId,
      nameOf(from),
    ]);
    return {
      userId,
      login: before.rows[0].login,
      previous: before.rows[0].telegram_chat_id,
      displaced: displaced.rows.map((r) => r.id),
    };
  });
  if (!linked) {
    await say(
      chatId,
      `<b>This link has expired</b>\nGet a new one on your <a href="${env.publicUrl}/profile">profile</a>.`
    );
    return;
  }
  for (const id of [linked.userId, ...linked.displaced]) void publish({ type: 'session.changed', only: id });
  if (linked.previous && linked.previous !== chatId) {
    await say(linked.previous, `<b>${esc(linked.login)} is now linked to another Telegram account</b>`).catch(
      () => {}
    );
  }
  await say(chatId, `<b>${esc(linked.login)} is linked</b>\nI'll notify you here.`);
}

const tellerOf = async (telegramId: number): Promise<Teller | null> =>
  (
    await pool.query<Teller>(
      'select id, login, is_admin, role_id from users where telegram_chat_id = $1 and active',
      [telegramId]
    )
  ).rows[0] ?? null;

const paragraphs = (text: string): string =>
  text
    ? text
        .split('\n')
        .map((line) => (line.trim() ? `<p>${esc(line)}</p>` : '<p><br></p>'))
        .join('')
    : '';

function filesOf(m: TelegramMessage | undefined): DraftFile[] {
  if (!m) return [];
  const photo = m.photo?.at(-1);
  const found = [
    ...(photo ? [{ id: photo.file_id, name: 'photo.jpg', mime: 'image/jpeg', size: photo.file_size }] : []),
    ...(m.document ? [{ ...fileOf(m.document, 'file') }] : []),
    ...(m.video ? [{ ...fileOf(m.video, 'video.mp4') }] : []),
  ];
  return found.filter((f) => !f.size || f.size <= FILE_LIMIT).map(({ id, name, mime }) => ({ id, name, mime }));
}

const fileOf = (f: TelegramFile, name: string) => ({
  id: f.file_id,
  name: f.file_name ?? name,
  mime: f.mime_type ?? 'application/octet-stream',
  size: f.file_size,
});

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

async function attach(issue: Parameters<typeof recordFile>[0], file: DraftFile, user: Teller): Promise<void> {
  const info = await bot<{ file_path?: string }>('getFile', { file_id: file.id });
  if (!info.ok || !info.result?.file_path) return;
  const res = await fetch(`https://api.telegram.org/file/bot${env.telegramBotToken}/${info.result.file_path}`, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok || !res.body) return;
  const stored = await storeFile(issue.id, Readable.fromWeb(res.body as WebStream), file.name);
  await recordFile(
    issue,
    { stored, filename: file.name, mime: file.mime, commentId: null },
    { userId: user.id, login: user.login }
  );
}

async function fileIssue(user: Teller, boardId: string, draft: Draft): Promise<string | null> {
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
    await attach(made.issue, file, user).catch((err) =>
      console.error('[telegram] file not attached', (err as Error).message)
    );
  }
  const place = await pool.query<{ short_name: string; slug: string }>(
    'select p.short_name, b.slug from boards b join projects p on p.id = b.project_id where b.id = $1',
    [boardId]
  );
  const { short_name: short, slug } = place.rows[0];
  const key = made.issue.readable_id;
  const url = `${env.publicUrl}/${short}/${slug}/${key}`;
  return `Created <a href="${esc(url)}">${esc(key)}</a> ${esc(made.issue.summary)}`;
}

async function onIssue(m: TelegramMessage): Promise<void> {
  const hit = ISSUE.exec(m.text ?? m.caption ?? '');
  if (!hit || !m.chat || !m.from) return;
  if (hit[1] && hit[1].toLowerCase() !== env.telegramBotName.toLowerCase()) return;
  const user = await tellerOf(m.from.id);
  if (!user) return;
  const source = m.reply_to_message;
  const told = (source?.text ?? source?.caption ?? '').trim();
  const [head = '', ...more] = hit[2].trim().split('\n');
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
    files: [...filesOf(m), ...filesOf(source)],
  };
  const answer = { reply_parameters: { message_id: m.message_id, allow_sending_without_reply: true } };
  if (boards.length === 1) {
    const created = await fileIssue(user, boards[0].id, draft);
    if (created) await say(m.chat.id, created, answer);
    return;
  }
  await pool.query("delete from telegram_drafts where created_at < now() - interval '1 day'");
  const saved = await pool.query<{ id: string }>(
    `insert into telegram_drafts (user_id, chat_id, summary, description, files, boards)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [user.id, m.chat.id, draft.summary, draft.description, JSON.stringify(draft.files), boards.map((b) => b.id)]
  );
  const id = saved.rows[0].id;
  const rows: { text: string; callback_data: string }[][] = [];
  boards.forEach((b, i) => {
    const button = { text: b.label, callback_data: `i:${id}:${i}` };
    if (i % 2) rows[rows.length - 1].push(button);
    else rows.push([button]);
  });
  const sent = await say(m.chat.id, `<b>${esc(draft.summary)}</b>`, {
    ...answer,
    reply_markup: { inline_keyboard: [...rows, [{ text: 'Cancel', callback_data: `x:${id}` }]] },
  });
  if (sent.ok && sent.result) {
    await pool.query('update telegram_drafts set message_id = $2 where id = $1', [id, sent.result.message_id]);
  }
}

async function onPick(q: CallbackQuery): Promise<void> {
  await bot('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
  const [kind, draftId, index] = (q.data ?? '').split(':');
  if (!/^[0-9a-f-]{36}$/i.test(draftId ?? '')) return;
  const user = await tellerOf(q.from.id);
  if (!user) return;
  const res = await pool.query<DraftRow>('delete from telegram_drafts where id = $1 and user_id = $2 returning *', [
    draftId,
    user.id,
  ]);
  const draft = res.rows[0];
  if (!draft?.message_id) return;
  if (kind === 'x') {
    await bot('deleteMessage', { chat_id: draft.chat_id, message_id: draft.message_id });
    return;
  }
  const boardId = kind === 'i' ? draft.boards[Number(index)] : undefined;
  if (!boardId) return;
  const created = await fileIssue(user, boardId, draft);
  if (!created) return;
  await bot('editMessageText', {
    chat_id: draft.chat_id,
    message_id: draft.message_id,
    text: created,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  });
}

export function registerTelegramRoutes(app: FastifyInstance): void {
  app.post('/telegram', async (req, reply) => {
    if (!telegramReady() || !secretRight(req.headers['x-telegram-bot-api-secret-token'])) {
      return reply.code(401).send({ error: 'Bad secret.' });
    }
    const update = req.body as { message?: TelegramMessage; callback_query?: CallbackQuery } | null;
    const message = update?.message;
    const code = START.exec(message?.text ?? '')?.[1];
    const failed = (what: string) => (err: unknown) =>
      console.error(`[telegram] ${what} failed`, (err as Error).message);
    if (update?.callback_query) void onPick(update.callback_query).catch(failed('board pick'));
    else if (message?.chat?.type === 'private' && code) {
      void onStart(message.chat.id, message.from, code).catch(failed('linking'));
    } else if (message) void onIssue(message).catch(failed('issue'));
    return reply.send({ data: { ok: true } });
  });

  app.post('/me/telegram/link', async (req, reply) => {
    const auth = await requireSession(req, reply);
    if (!auth) return;
    if (!telegramReady()) return reply.code(503).send({ error: 'Telegram is not set up.' });
    const code = newRawToken();
    await pool.query('delete from telegram_link_codes where expires_at < now() or user_id = $1', [auth.userId]);
    await pool.query(
      `insert into telegram_link_codes (code_hash, user_id, expires_at)
       values ($1, $2, now() + make_interval(mins => $3))`,
      [hashToken(code), auth.userId, LINK_MINUTES]
    );
    return reply.send({ data: { url: `https://t.me/${env.telegramBotName}?start=${code}` } });
  });

  app.delete('/me/telegram', async (req, reply) => {
    const auth = await requireSession(req, reply);
    if (!auth) return;
    const res = await pool.query<{ login: string; chat: number | null }>(
      `with old as (select telegram_chat_id from users where id = $1 for update)
       update users set telegram_chat_id = null, telegram_name = null
        where id = $1
       returning login, (select telegram_chat_id from old) as chat`,
      [auth.userId]
    );
    const row = res.rows[0];
    if (row?.chat && telegramReady()) {
      await say(row.chat, `<b>Unlinked from ${esc(row.login)}</b>\nI won't notify you here anymore.`).catch(
        () => {}
      );
    }
    void publish({ type: 'session.changed', only: auth.userId, origin: tabOf(req) });
    return reply.send({ data: { ok: true } });
  });
}

export async function startTelegram(): Promise<void> {
  if (!telegramReady()) return;
  try {
    const reply = await bot('setWebhook', {
      url: `${env.publicUrl}/api/telegram`,
      secret_token: env.telegramWebhookSecret,
      allowed_updates: ['message', 'callback_query'],
    });
    if (!reply.ok) console.error('[telegram] setWebhook failed', reply.description);
    const commands = await bot('setMyCommands', { commands: [{ command: 'issue', description: 'Create an issue' }] });
    if (!commands.ok) console.error('[telegram] setMyCommands failed', commands.description);
  } catch (err) {
    console.error('[telegram] setWebhook failed', (err as Error).message);
  }
  setInterval(() => void deliverDue(), 2000).unref();
}
