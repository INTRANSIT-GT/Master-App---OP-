import { Router } from 'express';
import { z } from 'zod';
import { hashPassword, need, validatePasswordStrength } from '../auth.js';
import { config } from '../config.js';
import { pool, tx } from '../db.js';
import { conflict, notFound, parse } from '../http.js';
import { audit } from '../services/audit.js';

export const usersRouter = Router();
const externa = () => conflict('GESTION_EXTERNA', 'Con sesión compartida, los usuarios, módulos y roles se gestionan en la app principal (Supabase). Aquí solo se puede suspender el acceso.');
const cols = 'id, email, name, role, active, created_at AS "createdAt"';
usersRouter.get('/usuarios', need('usuarios.gestionar'), async (_req, res) => res.json((await pool.query(`SELECT ${cols} FROM users ORDER BY name`)).rows));
usersRouter.post('/usuarios', need('usuarios.gestionar'), async (req, res) => {
  const b = parse(z.object({ email: z.string().email(), name: z.string().trim().min(2), role: z.enum(['administrador', 'supervisor', 'operador', 'consulta', 'comercial']), password: z.string() }), req.body);
  if (config.authMode === 'sso') throw externa();
  validatePasswordStrength(b.password);
  res.status(201).json(await tx(async (c) => {
    if ((await c.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [b.email])).rowCount) throw conflict('DUPLICADO', 'Ya existe un usuario con ese correo.');
    const r = await c.query(`INSERT INTO users (email, name, role, password_hash) VALUES ($1,$2,$3::user_role,$4) RETURNING ${cols}`, [b.email, b.name, b.role, await hashPassword(b.password)]);
    await audit(c, req.user!, 'usuario', r.rows[0].id, 'crear', null, r.rows[0]); return r.rows[0];
  }));
});
usersRouter.patch('/usuarios/:id', need('usuarios.gestionar'), async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).optional(), role: z.enum(['administrador', 'supervisor', 'operador', 'consulta', 'comercial']).optional(), active: z.boolean().optional(), password: z.string().optional() }), req.body);
  if (config.authMode === 'sso' && (b.name !== undefined || b.role !== undefined || b.password !== undefined)) throw externa();
  res.json(await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0]; if (!cur) throw notFound('Usuario');
    if (req.params.id === req.user!.id && (b.active === false || (b.role && b.role !== 'administrador'))) throw conflict('AUTOBLOQUEO', 'No puedes quitarte tu propio acceso de administrador.');
    if (b.password) validatePasswordStrength(b.password);
    const r = await c.query(`UPDATE users SET name = coalesce($2,name), role = coalesce($3::user_role, role), active = coalesce($4, active), password_hash = coalesce($5, password_hash),
        token_version = token_version + CASE WHEN $3 IS NOT NULL OR $4 IS NOT NULL OR $5 IS NOT NULL THEN 1 ELSE 0 END, updated_at = now() WHERE id = $1 RETURNING ${cols}`,
      [req.params.id, b.name ?? null, b.role ?? null, b.active ?? null, b.password ? await hashPassword(b.password) : null]);
    await audit(c, req.user!, 'usuario', cur.id, 'editar', { name: cur.name, role: cur.role, active: cur.active }, { name: r.rows[0].name, role: r.rows[0].role, active: r.rows[0].active, cambioClave: !!b.password });
    return r.rows[0];
  }));
});
