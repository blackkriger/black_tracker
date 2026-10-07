import { timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream as WebStream } from 'node:stream/web';
import type { FastifyInstance } from 'fastify';
import { env, vkReady } from './env.js';
import {
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

const VERSION = '5.199';
const CHAT_PEER = 2_000_000_000;
const MAX_BUTTONS = 10;
const ISSUE = /^\/issue(?=\s|$)([\s\S]*)$/i;
const MENTION = /^\[(?:club|public)\d+\|[^\]]*\][\s,:]*/i;
const GONE = new Set([7, 901, 902, 917]);
const MISSING = new Set([100, 909]);

interface VkError {
  error_code: number;
  error_msg: string;
}

interface VkSendError {
  code?: number;
  description?: string;
}

interface VkReply<T> {
  response?: T;
  error?: VkError;
}

interface VkPhotoSize {
  url: string;
  width: number;
  height: number;
}

interface VkAttachment {
  type: string;
  photo?: { sizes?: VkPhotoSize[]; orig_photo?: VkPhotoSize };
  doc?: { title?: string; ext?: string; url?: string; size?: number };
}

interface VkMessage {
  peer_id: number;
  from_id: number;
  conversation_message_id: number;
  text?: string;
  ref?: string;
  attachments?: VkAttachment[];
  reply_message?: VkMessage;
  fwd_messages?: VkMessage[];
}

interface VkPress {
  user_id: number;
  peer_id: number;
  event_id: string;
  payload?: { d?: string } | string;
}

interface VkEvent {
  type: string;
  group_id: number;
  secret?: string;
  object?: { message?: VkMessage } & Partial<VkPress>;
}

let group: { id: number; screen: string } | null = null;
let confirmation: string | null = null;

async function vk<T>(method: string, params: Record<string, string | number>): Promise<VkReply<T>> {
  const body = new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    access_token: env.vkGroupToken,
    v: VERSION,
  });
  const res = await fetch(`https://api.vk.com/method/${method}`, {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(10_000),
  });
  return (await res.json()) as VkReply<T>;
}

function format(n: Note): string {
  const urls: string[] = [];
  const line = (l: Segment[]): string =>
    l
      .map((s) => {
        if (typeof s === 'string') return s;
        if (!urls.includes(s.url)) urls.push(s.url);
        return s.text;
      })
      .join('');
  return [...(n.head ? [line(n.head)] : []), ...n.lines.map(line), ...urls].join('\n');
}

function failed(error: VkError): Outcome<never> {
  return {
    ok: false,
    error: `${error.error_code}: ${error.error_msg}`,
    gone: GONE.has(error.error_code),
    missing: MISSING.has(error.error_code),
    retryAfter: error.error_code === 6 ? 1 : error.error_code === 9 ? 60 : undefined,
  };
}

const randomId = (): number => Math.floor(Math.random() * 2 ** 31);

const vkAdapter: Adapter = {
  channel: 'vk',
  title: 'VK',
  ready: vkReady,
  linkUrl: (code) => (group ? `https://vk.me/${group.screen}?ref=${code}` : null),
  async send(peer, note, options = {}) {
    const params: Record<string, string | number> = {
      peer_ids: peer,
      random_id: randomId(),
      message: format(note),
      dont_parse_links: 1,
      disable_mentions: 1,
    };
    if (options.replyTo) {
      params.forward = JSON.stringify({ peer_id: peer, conversation_message_ids: [options.replyTo], is_reply: 1 });
    }
    if (options.buttons) {
      let room = MAX_BUTTONS;
      const fitted = [...options.buttons].reverse().map((row) => {
        const kept = row.slice(0, Math.max(0, room));
        room -= kept.length;
        return kept;
      });
      params.keyboard = JSON.stringify({
        inline: true,
        buttons: fitted
          .reverse()
          .filter((row) => row.length)
          .map((row) =>
            row.map((b) => ({
              action: { type: 'callback', label: b.text.slice(0, 40), payload: JSON.stringify({ d: b.data }) },
            }))
          ),
      });
    }
    const reply = await vk<{ conversation_message_id?: number; error?: VkSendError | string }[]>('messages.send', params);
    if (reply.error) return failed(reply.error);
    const first = reply.response?.[0];
    if (first?.error) {
      const e = typeof first.error === 'string' ? { description: first.error } : first.error;
      return failed({ error_code: e.code ?? 0, error_msg: e.description ?? 'VK refused the message.' });
    }
    return { ok: true, value: first?.conversation_message_id ?? null };
  },
  async edit(peer, id, note) {
    const reply = await vk('messages.edit', {
      peer_id: peer,
      conversation_message_id: id,
      message: format(note),
      dont_parse_links: 1,
    });
    return reply.error ? failed(reply.error) : { ok: true, value: null };
  },
  async remove(peer, id) {
    await vk('messages.delete', { peer_id: peer, cmids: id, delete_for_all: 1 }).catch(() => {});
  },
  async download(file) {
    const res = await fetch(file.id, { signal: AbortSignal.timeout(120_000) });
    return res.ok && res.body ? Readable.fromWeb(res.body as WebStream) : null;
  },
};

registerAdapter(vkAdapter);

function secretRight(given: unknown): boolean {
  if (typeof given !== 'string') return false;
  const want = Buffer.from(env.vkSecret);
  const got = Buffer.from(given);
  return want.length === got.length && timingSafeEqual(want, got);
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  zip: 'application/zip',
  mp4: 'video/mp4',
};

function filesOf(m: VkMessage | undefined): DraftFile[] {
  const out: DraftFile[] = [];
  for (const a of m?.attachments ?? []) {
    if (a.type === 'photo' && a.photo) {
      const best =
        a.photo.orig_photo ??
        [...(a.photo.sizes ?? [])].sort((x, y) => x.width * x.height - y.width * y.height).at(-1);
      if (best?.url) out.push({ id: best.url, name: 'photo.jpg', mime: 'image/jpeg' });
    }
    if (a.type === 'doc' && a.doc?.url && (!a.doc.size || a.doc.size <= FILE_LIMIT)) {
      const ext = (a.doc.ext ?? '').toLowerCase();
      const title = a.doc.title || 'file';
      out.push({
        id: a.doc.url,
        name: ext && !title.toLowerCase().endsWith(`.${ext}`) ? `${title}.${ext}` : title,
        mime: MIME[ext] ?? 'application/octet-stream',
      });
    }
  }
  return out;
}

async function nameOf(userId: number): Promise<string | null> {
  const reply = await vk<{ first_name?: string; last_name?: string; screen_name?: string }[]>('users.get', {
    user_ids: userId,
    fields: 'screen_name',
  });
  const user = reply.response?.[0];
  if (!user) return null;
  if (user.screen_name && !/^id\d+$/.test(user.screen_name)) return `@${user.screen_name}`;
  return [user.first_name, user.last_name].filter(Boolean).join(' ') || null;
}

async function onMessage(m: VkMessage): Promise<void> {
  if (m.peer_id < CHAT_PEER && m.ref) {
    await linkByCode(vkAdapter, m.from_id, await nameOf(m.from_id), m.ref);
    return;
  }
  const hit = ISSUE.exec((m.text ?? '').trim().replace(MENTION, ''));
  if (!hit) return;
  const source = m.reply_message ?? m.fwd_messages?.[0];
  await issueCommand(vkAdapter, hit[1], {
    chat: m.peer_id,
    from: m.from_id,
    messageId: m.conversation_message_id,
    files: filesOf(m),
    source: source ? { text: source.text ?? '', files: filesOf(source) } : undefined,
  });
}

async function onPress(e: VkPress): Promise<void> {
  await vk('messages.sendMessageEventAnswer', { event_id: e.event_id, user_id: e.user_id, peer_id: e.peer_id }).catch(
    () => {}
  );
  const payload = typeof e.payload === 'string' ? (JSON.parse(e.payload) as { d?: string }) : e.payload;
  if (payload?.d) await pick(vkAdapter, e.user_id, payload.d);
}

export function registerVkRoutes(app: FastifyInstance): void {
  app.post('/vk', async (req, reply) => {
    const event = req.body as VkEvent | null;
    reply.type('text/plain');
    if (!vkReady() || !event) return reply.code(503).send('not set up');
    if (group && event.group_id !== group.id) return reply.code(403).send('wrong group');
    if (event.type === 'confirmation') return reply.send(confirmation ?? '');
    if (!secretRight(event.secret)) return reply.code(401).send('bad secret');
    const fail = (err: unknown) => console.error('[vk] event failed', (err as Error).message);
    if (event.type === 'message_new' && event.object?.message) void onMessage(event.object.message).catch(fail);
    if (event.type === 'message_event' && event.object?.event_id) void onPress(event.object as VkPress).catch(fail);
    return reply.send('ok');
  });
}

export async function startVk(): Promise<void> {
  if (!vkReady()) return;
  try {
    const found = await vk<{ groups?: { id: number; screen_name: string }[] } | { id: number; screen_name: string }[]>(
      'groups.getById',
      {}
    );
    if (found.error) throw new Error(found.error.error_msg);
    const list = Array.isArray(found.response) ? found.response : (found.response?.groups ?? []);
    if (!list[0]) throw new Error('no community behind the key');
    group = { id: list[0].id, screen: list[0].screen_name };
    const code = await vk<{ code: string }>('groups.getCallbackConfirmationCode', { group_id: group.id });
    if (code.error) throw new Error(code.error.error_msg);
    confirmation = code.response?.code ?? null;
    const url = `${env.publicUrl}/api/vk`;
    const servers = await vk<{ items: { id: number; url: string }[] }>('groups.getCallbackServers', { group_id: group.id });
    let serverId = servers.response?.items.find((s) => s.url === url)?.id;
    const server = { group_id: group.id, url, title: 'Tracker', secret_key: env.vkSecret };
    if (serverId) {
      await vk('groups.editCallbackServer', { ...server, server_id: serverId });
    } else {
      const added = await vk<{ server_id: number }>('groups.addCallbackServer', server);
      if (added.error) throw new Error(added.error.error_msg);
      serverId = added.response?.server_id;
    }
    if (serverId) {
      const set = await vk('groups.setCallbackSettings', {
        group_id: group.id,
        server_id: serverId,
        api_version: VERSION,
        message_new: 1,
        message_event: 1,
      });
      if (set.error) throw new Error(set.error.error_msg);
    }
  } catch (err) {
    console.error('[vk] setup failed', (err as Error).message);
  }
}
