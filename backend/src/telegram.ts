import { Readable } from 'node:stream';
import type { ReadableStream as WebStream } from 'node:stream/web';
import type { FastifyInstance } from 'fastify';
import { sameSecret } from './auth.js';
import { env, telegramReady } from './env.js';
import {
  escapeHtml,
  FILE_LIMIT,
  issueCommand,
  linkByCode,
  pick,
  registerAdapter,
  type Adapter,
  type DraftFile,
  type Note,
  type Outcome,
  type Segment,
} from './messenger.js';

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

async function bot<T>(method: string, body: object): Promise<BotReply<T>> {
  const res = await fetch(`https://api.telegram.org/bot${env.telegramBotToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  return (await res.json()) as BotReply<T>;
}

const segments = (line: Segment[]): string =>
  line
    .map((s) => (typeof s === 'string' ? escapeHtml(s) : `<a href="${escapeHtml(s.url)}">${escapeHtml(s.text)}</a>`))
    .join('');

const format = (n: Note): string =>
  [...(n.head ? [`<b>${segments(n.head)}</b>`] : []), ...n.lines.map(segments)].join('\n');

function outcome<T, V>(reply: BotReply<T>, value: (r: T | undefined) => V): Outcome<V> {
  if (reply.ok) return { ok: true, value: value(reply.result) };
  const why = reply.description ?? 'Telegram refused the message.';
  return {
    ok: false,
    error: why,
    gone: reply.error_code === 403 || /chat not found/i.test(why),
    missing: /message to edit not found/i.test(why),
    unchanged: /not modified/i.test(why),
    retryAfter: reply.parameters?.retry_after,
  };
}

const telegram: Adapter = {
  channel: 'telegram',
  title: 'Telegram',
  ready: telegramReady,
  linkUrl: (code) => (env.telegramBotName ? `https://t.me/${env.telegramBotName}?start=${code}` : null),
  async send(peer, note, options = {}) {
    const reply = await bot<{ message_id: number }>('sendMessage', {
      chat_id: peer,
      text: format(note),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(options.replyTo
        ? { reply_parameters: { message_id: options.replyTo, allow_sending_without_reply: true } }
        : {}),
      ...(options.buttons
        ? {
            reply_markup: {
              inline_keyboard: options.buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))),
            },
          }
        : {}),
    });
    return outcome(reply, (r) => r?.message_id ?? null);
  },
  async edit(peer, id, note) {
    const reply = await bot('editMessageText', {
      chat_id: peer,
      message_id: id,
      text: format(note),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
    return outcome(reply, () => null);
  },
  async remove(peer, id) {
    await bot('deleteMessage', { chat_id: peer, message_id: id }).catch(() => {});
  },
  async download(file) {
    const info = await bot<{ file_path?: string }>('getFile', { file_id: file.id });
    if (!info.ok || !info.result?.file_path) return null;
    const res = await fetch(`https://api.telegram.org/file/bot${env.telegramBotToken}/${info.result.file_path}`, {
      signal: AbortSignal.timeout(120_000),
    });
    return res.ok && res.body ? Readable.fromWeb(res.body as WebStream) : null;
  },
};

registerAdapter(telegram);

function secretRight(header: unknown): boolean {
  if (typeof header !== 'string') return false;
  return sameSecret(env.telegramWebhookSecret, header);
}

const nameOf = (from: TelegramUser | undefined): string | null =>
  from?.username
    ? `@${from.username}`
    : [from?.first_name, from?.last_name].filter(Boolean).join(' ') || null;

const fileOf = (f: TelegramFile, name: string) => ({
  id: f.file_id,
  name: f.file_name ?? name,
  mime: f.mime_type ?? 'application/octet-stream',
  size: f.file_size,
});

function filesOf(m: TelegramMessage | undefined): DraftFile[] {
  if (!m) return [];
  const photo = m.photo?.at(-1);
  const found = [
    ...(photo ? [{ id: photo.file_id, name: 'photo.jpg', mime: 'image/jpeg', size: photo.file_size }] : []),
    ...(m.document ? [fileOf(m.document, 'file')] : []),
    ...(m.video ? [fileOf(m.video, 'video.mp4')] : []),
  ];
  return found.filter((f) => !f.size || f.size <= FILE_LIMIT).map(({ id, name, mime }) => ({ id, name, mime }));
}

async function onMessage(m: TelegramMessage): Promise<void> {
  if (!m.chat || !m.from) return;
  const code = START.exec(m.text ?? '')?.[1];
  if (m.chat.type === 'private' && code) {
    await linkByCode(telegram, m.chat.id, nameOf(m.from), code);
    return;
  }
  const hit = ISSUE.exec(m.text ?? m.caption ?? '');
  if (!hit) return;
  if (hit[1] && hit[1].toLowerCase() !== env.telegramBotName.toLowerCase()) return;
  const source = m.reply_to_message;
  await issueCommand(telegram, hit[2], {
    chat: m.chat.id,
    from: m.from.id,
    messageId: m.message_id,
    files: filesOf(m),
    source: source ? { text: source.text ?? source.caption ?? '', files: filesOf(source) } : undefined,
  });
}

async function onPress(q: CallbackQuery): Promise<void> {
  await bot('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
  if (q.data) await pick(telegram, q.from.id, q.data);
}

export function registerTelegramRoutes(app: FastifyInstance): void {
  app.post('/telegram', async (req, reply) => {
    if (!telegramReady() || !secretRight(req.headers['x-telegram-bot-api-secret-token'])) {
      return reply.code(401).send({ error: 'Bad secret.' });
    }
    const update = req.body as { message?: TelegramMessage; callback_query?: CallbackQuery } | null;
    const failed = (err: unknown) => console.error('[telegram] update failed', (err as Error).message);
    if (update?.callback_query) void onPress(update.callback_query).catch(failed);
    else if (update?.message) void onMessage(update.message).catch(failed);
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
    const russian = await bot('setMyCommands', {
      commands: [{ command: 'issue', description: 'Создать задачу' }],
      language_code: 'ru',
    });
    if (!russian.ok) console.error('[telegram] setMyCommands failed', russian.description);
  } catch (err) {
    console.error('[telegram] setWebhook failed', (err as Error).message);
  }
}
