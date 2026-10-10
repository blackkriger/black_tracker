import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from './auth.js';
import { DAY_RE, pool, ZONE } from './db.js';
import { publish } from './events.js';
import { countryOf } from './geoip.js';
import { readAgent } from './user-agent.js';

const WINDOW_MS = 60 * 60 * 1000;
const SENDS_PER_HOUR = 5;
const TRACKS_PER_HOUR = 600;

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

async function formExists(id: string): Promise<boolean> {
  const res = await pool.query('select 1 from feedback_forms where id = $1', [id]);
  return !!res.rowCount;
}

const lang = z.enum(['ru', 'en']);
const formId = z.string().regex(/^[a-z0-9-]{1,40}$/);
const rating = z.number().int().min(1).max(5);
const scale = rating.optional();
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
      .object({ exploration: rating, combat: rating, visuals: rating, narrative: rating, progression: rating })
      .strict(),
    ratingsText: text(),
    startClear: scale,
    startText: text(),
    readAttacks: scale,
    potions: z.enum(['enough', 'barely', 'short']).optional(),
    deathsFair: scale,
    combatText: text(),
    upgrades: scale,
    coins: z.enum(['enough', 'barely', 'short', 'unclear']).optional(),
    lost: scale,
    lostText: text(),
    interact: scale,
    bugsText: text(),
    addText: text(),
    removeText: text(),
  })
  .strict();

const submission = z.object({
  form: formId.default('demo'),
  session: z.string().uuid().optional(),
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

const visit = z.object({
  session: z.string().uuid(),
  form: formId,
  lang,
  theme: z.enum(['light', 'dark']).optional(),
  screen: z.string().regex(/^\d{2,5}x\d{2,5}$/).optional(),
  browserLang: z.string().regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,3}$/).optional(),
  touch: z.boolean().optional(),
  fresh: z.boolean().optional(),
  reached: z.number().int().min(0).max(49),
  times: z
    .record(z.string().regex(/^[a-z]{1,20}$/), z.number().int().min(0).max(24 * WINDOW_MS))
    .refine((t) => Object.keys(t).length <= 20),
});

const AUDIENCE = ['device', 'os', 'browser', 'screen', 'browserLang', 'theme', 'lang', 'country'] as const;

export function registerFeedbackRoutes(app: FastifyInstance): void {
  app.post('/public/feedback/send', { bodyLimit: 64 * 1024 }, async (req, reply) => {
    const parsed = submission.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Bad feedback.' });
    const p = parsed.data;
    if (p.website) return reply.code(201).send({ data: { ok: true } });
    if (!(await formExists(p.form))) return reply.code(400).send({ error: 'Bad feedback.' });
    if (!allow(`send:${req.ip}`, SENDS_PER_HOUR)) {
      return reply.code(429).send({ error: 'Too many sends from here. Try again later.' });
    }
    await pool.query(
      'insert into feedback_responses (form_id, lang, answers, name, email) values ($1, $2, $3, $4, $5)',
      [p.form, p.lang, JSON.stringify(p.answers), p.name ?? null, p.email ?? null]
    );
    if (p.session) {
      await pool.query('update feedback_sessions set sent = true where id = $1 and form_id = $2', [
        p.session,
        p.form,
      ]);
    }
    void publish({ type: 'feedback.changed' });
    return reply.code(201).send({ data: { ok: true } });
  });

  app.post('/public/feedback/track', { bodyLimit: 4 * 1024 }, async (req, reply) => {
    const parsed = visit.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Bad visit.' });
    const p = parsed.data;
    if (!allow(`track:${req.ip}`, TRACKS_PER_HOUR)) return reply.code(429).send({ error: 'Too many.' });
    if (!(await formExists(p.form))) return reply.code(400).send({ error: 'Bad visit.' });
    const agent = readAgent(String(req.headers['user-agent'] ?? ''), p.touch ?? false);
    await pool.query(
      `insert into feedback_sessions
         (id, form_id, day, lang, theme, device, os, browser, screen, browser_lang, country, reached, section_ms)
       values ($1, $2, (now() at time zone '${ZONE}')::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       on conflict (id) do update set
         lang = excluded.lang,
         theme = coalesce(excluded.theme, feedback_sessions.theme),
         screen = coalesce(excluded.screen, feedback_sessions.screen),
         reached = greatest(feedback_sessions.reached, excluded.reached),
         section_ms = coalesce((
           select jsonb_object_agg(k, greatest(coalesce((feedback_sessions.section_ms ->> k)::bigint, 0),
                                               coalesce((excluded.section_ms ->> k)::bigint, 0)))
             from jsonb_object_keys(feedback_sessions.section_ms || excluded.section_ms) as k
         ), '{}'),
         visits = feedback_sessions.visits + case when $13 then 1 else 0 end
       where feedback_sessions.form_id = excluded.form_id`,
      [
        p.session,
        p.form,
        p.lang,
        p.theme ?? null,
        agent.device,
        agent.os,
        agent.browser,
        p.screen ?? null,
        p.browserLang ?? null,
        countryOf(req.ip),
        p.reached,
        JSON.stringify(p.times),
        p.fresh ?? false,
      ]
    );
    return reply.code(204).send();
  });

  app.get('/feedback/report', async (req, reply) => {
    const auth = await requireAuth(req, reply);
    if (!auth) return;
    const q = req.query as { form?: string; from?: string; to?: string };
    const from = q.from && DAY_RE.test(q.from) ? q.from : null;
    const to = q.to && DAY_RE.test(q.to) ? q.to : null;
    const forms = await pool.query<{ id: string; name: string }>(
      'select id, name from feedback_forms order by created_at desc, id'
    );
    const form = forms.rows.find((f) => f.id === q.form)?.id ?? forms.rows[0]?.id;
    if (!form) return reply.send({ data: null });

    const span = [form, from, to];
    const within = `form_id = $1 and day between coalesce($2::date, '-infinity') and coalesce($3::date, 'infinity')`;
    const [totals, reached, sections, whole, audience, responses] = await Promise.all([
      pool.query<{ sessions: number; views: number; sent: number }>(
        `select count(*)::int as sessions, coalesce(sum(visits), 0)::int as views,
                count(*) filter (where sent)::int as sent
           from feedback_sessions where ${within}`,
        span
      ),
      pool.query<{ reached: number; n: number }>(
        `select reached, count(*)::int as n from feedback_sessions where ${within} group by reached`,
        span
      ),
      pool.query<{ section: string; ms: number }>(
        `select e.key as section, percentile_cont(0.5) within group (order by e.value::bigint) as ms
           from feedback_sessions, jsonb_each_text(section_ms) as e
          where ${within} and e.value::bigint > 0
          group by e.key`,
        span
      ),
      pool.query<{ ms: number | null }>(
        `select percentile_cont(0.5) within group (order by t.ms) as ms
           from (select (select sum(value::bigint) from jsonb_each_text(section_ms)) as ms
                   from feedback_sessions where ${within} and sent) t`,
        span
      ),
      pool.query<{ dim: (typeof AUDIENCE)[number]; value: string | null; n: number }>(
        `select d.dim, d.value, count(*)::int as n
           from feedback_sessions,
                lateral (values ('device', device), ('os', os), ('browser', browser), ('screen', screen),
                                ('browserLang', browser_lang), ('theme', theme), ('lang', lang),
                                ('country', country)) as d(dim, value)
          where ${within}
          group by d.dim, d.value
          order by n desc, d.value`,
        span
      ),
      pool.query<{
        id: string;
        created_at: Date;
        lang: string;
        answers: Record<string, unknown>;
        name: string | null;
        email: string | null;
      }>(
        `select id, created_at, lang, answers, name, email
           from feedback_responses
          where form_id = $1
            and (created_at at time zone '${ZONE}')::date between coalesce($2::date, '-infinity') and coalesce($3::date, 'infinity')
          order by created_at desc`,
        span
      ),
    ]);

    return reply.send({
      data: {
        forms: forms.rows,
        form,
        ...totals.rows[0],
        reached: Object.fromEntries(reached.rows.map((r) => [r.reached, r.n])),
        sectionMs: Object.fromEntries(sections.rows.map((r) => [r.section, Math.round(r.ms)])),
        totalMs: whole.rows[0]?.ms == null ? null : Math.round(whole.rows[0].ms),
        audience: Object.fromEntries(
          AUDIENCE.map((dim) => [
            dim,
            audience.rows.filter((r) => r.dim === dim).map((r) => ({ value: r.value, n: r.n })),
          ])
        ),
        responses: responses.rows.map((r) => ({
          id: r.id,
          at: r.created_at.toISOString(),
          lang: r.lang,
          answers: r.answers,
          name: r.name,
          email: r.email,
        })),
      },
    });
  });
}
