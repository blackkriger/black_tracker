import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from './auth.js';

const DOC_URL = /^https:\/\/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,})/;
const GOOGLE_HOST = /(?:^|\.)(?:google\.com|googleusercontent\.com)$/;
const HTML_LIMIT = 10 * 1024 * 1024;

export function registerGoogleDocRoutes(app: FastifyInstance): void {
  app.post('/google-doc', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const parsed = z.object({ url: z.string().max(2000) }).safeParse(req.body);
    const id = parsed.success ? DOC_URL.exec(parsed.data.url.trim())?.[1] : undefined;
    if (!id) return reply.code(400).send({ error: 'That is not a Google Docs link.' });
    let res: Response;
    try {
      res = await fetch(`https://docs.google.com/document/d/${id}/export?format=html`, {
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      return reply.code(502).send({ error: 'Google did not answer.' });
    }
    const host = new URL(res.url).hostname;
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !GOOGLE_HOST.test(host) || host.startsWith('accounts.') || !type.startsWith('text/html')) {
      return reply.code(422).send({ error: 'Open the document to anyone with the link.' });
    }
    if (Number(res.headers.get('content-length') ?? 0) > HTML_LIMIT) {
      return reply.code(413).send({ error: 'The document is too large.' });
    }
    const html = await res.text();
    if (html.length > HTML_LIMIT) return reply.code(413).send({ error: 'The document is too large.' });
    return reply.send({ data: { html } });
  });
}
