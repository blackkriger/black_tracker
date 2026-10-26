import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { pool } from './db.js';
import { env } from './env.js';

export const formId = z.string().regex(/^[a-z0-9-]{1,40}$/);

const words = z
  .union([z.string().min(1), z.object({ en: z.string().min(1), ru: z.string().min(1) }).strict()])
  .transform((w) => (typeof w === 'string' ? { en: w, ru: w } : w));
const key = z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,39}$/);
const choices = z
  .record(z.string().regex(/^[A-Za-z0-9-]{1,40}$/), words)
  .refine((c) => Object.keys(c).length > 0, 'Needs at least one choice.');
const required = z.boolean().default(false);

const item = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('choice'), key, title: words, required, options: choices }).strict(),
  z.object({ kind: z.literal('scale'), key, title: words, required, short: words }).strict(),
  z
    .object({
      kind: z.literal('ratings'),
      key,
      title: words,
      required,
      aspects: choices,
      shorts: z.record(z.string(), words).default({}),
    })
    .strict(),
  z.object({ kind: z.literal('text'), key, title: words, required }).strict(),
]);

const unique = (all: string[]): boolean => new Set(all).size === all.length;

const definition = z
  .object({
    name: words,
    sections: z
      .array(z.object({ id: z.string().regex(/^[a-z]{1,20}$/), title: words, items: z.array(item).min(1) }).strict())
      .min(1)
      .max(50),
  })
  .strict()
  .refine(
    (d) => unique(d.sections.map((s) => s.id)) && unique(d.sections.flatMap((s) => s.items.map((it) => it.key))),
    'Section ids and item keys must be unique.'
  );

type Definition = z.infer<typeof definition>;
type Item = z.infer<typeof item>;

export interface FeedbackForm {
  id: string;
  definition: Definition;
  answers: z.ZodTypeAny;
}

const rating = z.number().int().min(1).max(5);
const text = z.string().trim().max(4000);

function fieldOf(it: Item): z.ZodTypeAny {
  switch (it.kind) {
    case 'choice':
      return z.enum(Object.keys(it.options) as [string, ...string[]]);
    case 'scale':
      return rating;
    case 'ratings':
      return z
        .object(Object.fromEntries(Object.keys(it.aspects).map((a) => [a, it.required ? rating : rating.optional()])))
        .strict();
    case 'text':
      return it.required ? text.min(1) : text.transform((v) => v || undefined);
  }
}

const answersOf = (d: Definition): z.ZodTypeAny =>
  z
    .object(
      Object.fromEntries(
        d.sections
          .flatMap((s) => s.items)
          .map((it) => {
            const field = fieldOf(it);
            return [it.key, it.required ? field : field.optional()];
          })
      )
    )
    .strict();

const cache = new Map<string, { at: number; form: FeedbackForm | null }>();

async function read(id: string, file: string, log: FastifyBaseLogger): Promise<FeedbackForm | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    log.error({ err, form: id }, 'Feedback form is not readable JSON');
    return null;
  }
  const parsed = definition.safeParse(raw);
  if (!parsed.success) {
    log.error({ form: id, issues: parsed.error.issues }, 'Feedback form does not match the format');
    return null;
  }
  return { id, definition: parsed.data, answers: answersOf(parsed.data) };
}

export async function feedbackForm(id: string, log: FastifyBaseLogger): Promise<FeedbackForm | null> {
  if (!env.feedbackFormsDir || !formId.safeParse(id).success) return null;
  const file = path.join(env.feedbackFormsDir, `${id}.json`);
  const at = await stat(file).then(
    (s) => s.mtimeMs,
    () => null
  );
  if (at == null) {
    cache.delete(id);
    return null;
  }
  const kept = cache.get(id);
  if (kept?.at === at) return kept.form;
  const form = await read(id, file, log);
  if (form) {
    await pool.query(
      'insert into feedback_forms (id, name) values ($1, $2) on conflict (id) do update set name = excluded.name',
      [id, form.definition.name.en]
    );
  }
  cache.set(id, { at, form });
  return form;
}

export async function feedbackForms(log: FastifyBaseLogger): Promise<FeedbackForm[]> {
  if (!env.feedbackFormsDir) return [];
  const names = await readdir(env.feedbackFormsDir).catch(() => [] as string[]);
  const forms = await Promise.all(
    names.filter((n) => n.endsWith('.json')).map((n) => feedbackForm(n.slice(0, -'.json'.length), log))
  );
  return forms.filter((f): f is FeedbackForm => f !== null);
}
