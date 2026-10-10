import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool, ZONE } from './db.js';

const WINDOW_MS = 60 * 60 * 1000;
const SENDS_PER_HOUR = 5;
const VISITS_PER_HOUR = 30;

const hits = new Map<string, number[]>();

function allow(key: string, limit: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  const ok = recent.length < limit;
  if (ok) recent.push(now);
  hits.set(key, recent);
  if (hits.size > 2000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  }
  return ok;
}

const lang = z.enum(['ru', 'en']);
const scale = z.number().int().min(1).max(5).optional();
const text = (max = 4000) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);

const answers = z
  .object({
    played: z.enum(['lt15', '15-30', '30-60', '1-2h', 'gt2h']),
    device: z.enum(['kbm', 'gamepad', 'both']),
    genre: z.enum(['mine', 'some', 'first']),
    genreText: text(),
    stopped: z.enum(['finished', 'bored', 'stuck', 'hard', 'crash', 'other']),
    stoppedText: text(),
    ratings: z
      .object({ exploration: scale, combat: scale, visuals: scale, narrative: scale, replay: scale })
      .strict()
      .optional(),
    ratingsText: text(),
    startClear: scale,
    startText: text(),
    readAttacks: scale,
    potions: z.enum(['enough', 'barely', 'short']).optional(),
    deathsFair: scale,
    enemyText: text(),
    upgrades: scale,
    coins: z.enum(['enough', 'barely', 'short', 'unclear']).optional(),
    lost: scale,
    lostText: text(),
    interact: scale,
    bugsText: text(),
    screen: text(200),
    addText: text(),
    removeText: text(),
  })
  .strict();

const submission = z.object({
  lang,
  answers,
  name: text(100),
  email: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => v || undefined)
    .pipe(z.string().email().optional()),
  website: z.string().max(500).optional(),
});

export function registerFeedbackRoutes(app: FastifyInstance): void {
  app.post('/public/feedback/send', { bodyLimit: 64 * 1024 }, async (req, reply) => {
    const parsed = submission.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Bad feedback.' });
    const p = parsed.data;
    if (p.website) return reply.code(201).send({ data: { ok: true } });
    if (!allow(`send:${req.ip}`, SENDS_PER_HOUR)) {
      return reply.code(429).send({ error: 'Too many sends from here. Try again later.' });
    }
    await pool.query('insert into feedback_responses (lang, answers, name, email) values ($1, $2, $3, $4)', [
      p.lang,
      JSON.stringify(p.answers),
      p.name ?? null,
      p.email ?? null,
    ]);
    return reply.code(201).send({ data: { ok: true } });
  });

  app.post('/public/feedback/visit', { bodyLimit: 1024 }, async (req, reply) => {
    const parsed = z.object({ lang }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Bad visit.' });
    if (allow(`visit:${req.ip}`, VISITS_PER_HOUR)) {
      await pool.query(
        `insert into feedback_visits (day, lang, count) values ((now() at time zone '${ZONE}')::date, $1, 1)
         on conflict (day, lang) do update set count = feedback_visits.count + 1`,
        [parsed.data.lang]
      );
    }
    return reply.code(204).send();
  });
}
