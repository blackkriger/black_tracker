import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { inTransaction, pool } from './db.js';
import { requireAdmin, requireAuth } from './auth.js';
import { deniedFor } from './board-service.js';
import { freshColor } from './colors.js';

interface RoleRow {
  id: string;
  name: string;
  color: string;
  can_delete: boolean;
  can_manage_roles: boolean;
}

const publicRole = (r: RoleRow) => ({
  id: r.id,
  name: r.name,
  color: r.color,
  canDelete: r.can_delete,
  canManageRoles: r.can_manage_roles,
});

const roleCreate = z.object({
  name: z.string().trim().min(1).max(40),
  canDelete: z.boolean().optional(),
  canManageRoles: z.boolean().optional(),
});

const rolePatch = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  canDelete: z.boolean().optional(),
  canManageRoles: z.boolean().optional(),
});

export function registerRoleRoutes(app: FastifyInstance): void {
  app.get('/roles', async (req, reply) => {
    if (!(await requireAuth(req, reply))) return;
    const res = await pool.query<RoleRow>(
      'select id, name, color, can_delete, can_manage_roles from roles order by lower(name)'
    );
    return reply.send({ data: res.rows.map(publicRole) });
  });

  app.post('/roles', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const parsed = roleCreate.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'A role needs a name.' });
    const { name } = parsed.data;
    const taken = await pool.query('select 1 from roles where lower(name) = lower($1)', [name]);
    if (taken.rowCount) return reply.code(409).send({ error: 'That role already exists.' });
    const res = await pool.query<RoleRow>(
      `insert into roles (name, color, can_delete, can_manage_roles) values ($1, $2, $3, $4)
       returning id, name, color, can_delete, can_manage_roles`,
      [
        name,
        await freshColor('select color from roles'),
        parsed.data.canDelete ?? false,
        parsed.data.canManageRoles ?? false,
      ]
    );
    return reply.code(201).send({ data: publicRole(res.rows[0]) });
  });

  app.patch('/roles/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const parsed = rolePatch.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'A role needs a name.' });
    const { name, canDelete, canManageRoles } = parsed.data;
    if (name) {
      const taken = await pool.query(
        'select 1 from roles where lower(name) = lower($1) and id <> $2',
        [name, id]
      );
      if (taken.rowCount) return reply.code(409).send({ error: 'That role already exists.' });
    }
    const res = await pool.query<RoleRow>(
      `update roles
          set name = coalesce($2, name),
              can_delete = coalesce($3, can_delete),
              can_manage_roles = coalesce($4, can_manage_roles)
        where id = $1
        returning id, name, color, can_delete, can_manage_roles`,
      [id, name ?? null, canDelete ?? null, canManageRoles ?? null]
    );
    if (!res.rowCount) return reply.code(404).send({ error: 'No such role.' });
    return reply.send({ data: publicRole(res.rows[0]) });
  });

  app.get('/roles/:id/access', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const denied = await deniedFor(id);
    return reply.send({
      data: { deniedProjects: [...denied.projects], deniedBoards: [...denied.boards] },
    });
  });

  app.put('/roles/:id/access', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const parsed = z
      .object({
        deniedProjects: z.array(z.string().uuid()).max(200),
        deniedBoards: z.array(z.string().uuid()).max(500),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Send both lists of ids.' });
    if (!(await pool.query('select 1 from roles where id = $1', [id])).rowCount) {
      return reply.code(404).send({ error: 'No such role.' });
    }
    await inTransaction(async (client) => {
      await client.query('delete from project_denials where role_id = $1', [id]);
      await client.query('delete from board_denials where role_id = $1', [id]);
      if (parsed.data.deniedProjects.length) {
        await client.query(
          `insert into project_denials (project_id, role_id)
           select p, $1 from unnest($2::uuid[]) as p
           on conflict do nothing`,
          [id, parsed.data.deniedProjects]
        );
      }
      if (parsed.data.deniedBoards.length) {
        await client.query(
          `insert into board_denials (board_id, role_id)
           select b, $1 from unnest($2::uuid[]) as b
           on conflict do nothing`,
          [id, parsed.data.deniedBoards]
        );
      }
    });
    return reply.send({
      data: { deniedProjects: parsed.data.deniedProjects, deniedBoards: parsed.data.deniedBoards },
    });
  });

  app.delete('/roles/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const res = await pool.query('delete from roles where id = $1', [id]);
    if (!res.rowCount) return reply.code(404).send({ error: 'No such role.' });
    return reply.send({ data: { ok: true } });
  });
}
