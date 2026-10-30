import { createHmac } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sameSecret } from './auth.js';
import { keysIn, loginOf, mergeOf, projectKeys, recordCommits, type CommitEvent } from './commits.js';
import { env } from './env.js';
import { publish } from './events.js';

interface PushCommit {
  id: string;
  message: string;
  timestamp: string;
  author?: { name?: string; email?: string; username?: string };
}

interface PushPayload {
  ref?: string;
  deleted?: boolean;
  repository?: { full_name?: string };
  commits?: PushCommit[];
}

type RawRequest = FastifyRequest & { rawBody?: string };

function signedRight(raw: string, header: unknown): boolean {
  if (!env.githubWebhookSecret || typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  return sameSecret(createHmac('sha256', env.githubWebhookSecret).update(raw).digest('hex'), header.slice(7));
}

export async function eventsOfPush(payload: PushPayload): Promise<CommitEvent[]> {
  const ref = payload.ref ?? '';
  if (payload.deleted || !ref.startsWith('refs/heads/') || !payload.repository?.full_name) return [];
  const branch = ref.slice('refs/heads/'.length);
  const repo = payload.repository.full_name;
  const keys = await projectKeys();
  const branchKeys = keysIn(branch, keys);
  const commits = (payload.commits ?? []).map((c) => ({ c, merge: mergeOf(c.message) }));
  const plain = commits.filter(({ merge }) => !merge);
  const brought = [...new Set(plain.flatMap(({ c }) => keysIn(c.message, keys)))];
  const out: CommitEvent[] = [];
  for (const { c, merge } of commits) {
    const base = {
      repo,
      sha: c.id,
      message: c.message,
      branch,
      authorName: c.author?.name ?? null,
      authorLogin: loginOf(c.author?.email, c.author?.username),
      at: c.timestamp,
    };
    if (!merge) {
      out.push({ ...base, kind: 'commit', mergedFrom: null, keys: [...keysIn(c.message, keys), ...branchKeys] });
      continue;
    }
    if (merge.from === (merge.into ?? branch)) continue;
    out.push({
      ...base,
      kind: 'merge',
      mergedFrom: merge.from,
      keys: [...keysIn(c.message, keys), ...keysIn(merge.from, keys), ...brought, ...branchKeys],
    });
  }
  return out;
}

export function registerGitRoutes(app: FastifyInstance): void {
  void app.register(async (scope) => {
    scope.addContentTypeParser(
      ['application/json', 'application/x-www-form-urlencoded'],
      { parseAs: 'string' },
      (req, body, done) => {
        (req as RawRequest).rawBody = body as string;
        try {
          const text = req.headers['content-type']?.includes('urlencoded')
            ? (new URLSearchParams(body as string).get('payload') ?? '{}')
            : (body as string);
          done(null, JSON.parse(text));
        } catch {
          done(null, {});
        }
      }
    );

    scope.post('/git/github', async (req, reply) => {
      if (!env.githubWebhookSecret) return reply.code(503).send({ error: 'Not set up.' });
      if (!signedRight((req as RawRequest).rawBody ?? '', req.headers['x-hub-signature-256'])) {
        return reply.code(401).send({ error: 'Bad signature.' });
      }
      const event = req.headers['x-github-event'];
      if (event !== 'push') return reply.send({ data: { ok: true } });
      const linked = await recordCommits(await eventsOfPush(req.body as PushPayload));
      for (const l of linked) {
        void publish({
          type: 'commit.added',
          issueId: l.issueId,
          issueKey: l.issueKey,
          boardId: l.boardId,
          projectId: l.projectId,
        });
      }
      return reply.send({ data: { linked: linked.length } });
    });
  });
}
