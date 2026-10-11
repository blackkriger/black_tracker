import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import { requireSession } from './auth.js';

const COLORS = ['amber', 'blue', 'green', 'pink', 'violet', 'plain'] as const;
const MAX_NOTES = 40;
const MAX_BODY = 4000;

interface NoteRow {
  id: string;
  body: string;
  color: string;
  position: number;
  height: number | null;
  updated_at: Date;
}

const COLUMNS = 'id, body, color, position, height, updated_at';

const publicNote = (r: NoteRow) => ({
  id: r.id,
  body: r.body,
  color: r.color,
  position: r.position,
  height: r.height,
  updatedAt: r.updated_at.toISOString(),
});

const noteCreate = z.object({
  body: z.string().max(MAX_BODY).optional(),
  color: z.enum(COLORS).optional(),
});

const notePatch = z
  .object({
    body: z.string().max(MAX_BODY).optional(),
    color: z.enum(COLORS).optional(),
    height: z.number().int().min(96).max(4000).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, 'Nothing to change.');

export function registerNoteRoutes(app: FastifyInstance): void {
  app.get('/me/notes', async (req, reply) => {
    const auth = await requireSession(req, reply);
    if (!auth) return;
    const res = await pool.query<NoteRow>(
      `select ${COLUMNS} from user_notes where user_id = $1 order by position, created_at`,
      [auth.userId]
    );
    return reply.send({ data: res.rows.map(publicNote) });
  });

  app.post('/me/notes', async (req, reply) => {
    const auth = await requireSession(req, reply);
    if (!auth) return;
    const parsed = noteCreate.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad note.' });
    }
    const count = await pool.query<{ n: number }>(
      'select count(*)::int as n from user_notes where user_id = $1',
      [auth.userId]
    );
    if (count.rows[0].n >= MAX_NOTES) {
      return reply.code(409).send({ error: `You already have ${MAX_NOTES} notes.` });
    }
    const res = await pool.query<NoteRow>(
      `insert into user_notes (user_id, body, color, position)
       values ($1, $2, $3, coalesce((select min(position) - 1 from user_notes where user_id = $1), 0))
       returning ${COLUMNS}`,
      [auth.userId, parsed.data.body ?? '', parsed.data.color ?? 'amber']
    );
    return reply.send({ data: publicNote(res.rows[0]) });
  });

  app.patch('/me/notes/:id', async (req, reply) => {
    const auth = await requireSession(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const parsed = notePatch.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Bad note.' });
    }
    const p = parsed.data;
    const res = await pool.query<NoteRow>(
      `update user_notes
          set body = coalesce($3, body),
              color = coalesce($4, color),
              height = coalesce($5, height),
              updated_at = now()
        where id = $1 and user_id = $2
        returning ${COLUMNS}`,
      [id, auth.userId, p.body ?? null, p.color ?? null, p.height ?? null]
    );
    if (!res.rowCount) return reply.code(404).send({ error: 'No such note.' });
    return reply.send({ data: publicNote(res.rows[0]) });
  });

  app.delete('/me/notes/:id', async (req, reply) => {
    const auth = await requireSession(req, reply);
    if (!auth) return;
    const { id } = req.params as { id: string };
    const res = await pool.query('delete from user_notes where id = $1 and user_id = $2', [id, auth.userId]);
    if (!res.rowCount) return reply.code(404).send({ error: 'No such note.' });
    return reply.send({ data: { ok: true } });
  });
}
