import { Router } from 'express';
import { z } from 'zod';
import { hashPassword, need, resetSsoCache, validatePasswordStrength } from '../auth.js';
import { config } from '../config.js';
import { pool, tx, type Q } from '../db.js';
import { bad, conflict, notFound, parse } from '../http.js';
import { SEDES_DE, resetSedeCache, setUserSedes } from '../sede.js';
import { audit } from '../services/audit.js';
import { createAuthAccount, directoryUser, listDirectory, setModuleRole } from '../services/directory.js';

export const usersRouter = Router();
const externa = () => conflict('GESTION_EXTERNA', 'Con sesión compartida, los usuarios, módulos y roles se gestionan en la app principal (Supabase). Aquí solo se puede suspender el acceso.');
// SSO_USUARIOS=modulo: Operaciones corre dentro de Supabase y asigna su propio rol a las cuentas de Supabase Auth
const directorio = () => config.authMode === 'sso' && config.ssoUsers === 'modulo';
const cols = 'id, email, name, role, active, created_at AS "createdAt"';
const localUser = async (q: Q, id: string) => (await q.query(`SELECT ${cols}, ${SEDES_DE('users.id')} FROM users WHERE id = $1`, [id])).rows[0];
const ROLE = z.enum(['administrador', 'supervisor', 'operador', 'consulta', 'comercial']);
// las sedes son de Operaciones: se asignan aquí en cualquier modo de sesión. Sin sedes, quien crea el usuario le da la suya.
const SEDES = z.array(z.string()).max(50);
const sinSedes = (role: string | undefined, sedes: string[] | undefined) => {
  if (sedes && !sedes.length && role !== 'administrador') throw bad('Asigna al menos una sede. Para quitarle el acceso, desactiva el usuario.');
};

usersRouter.get('/usuarios', need('usuarios.gestionar'), async (_req, res) => res.json(directorio() ? await listDirectory(pool) : (await pool.query(`SELECT ${cols}, ${SEDES_DE('users.id')} FROM users ORDER BY name`)).rows));
usersRouter.post('/usuarios', need('usuarios.gestionar'), async (req, res) => {
  const b = parse(z.object({ email: z.string().email(), name: z.string().trim().min(2), role: ROLE, password: z.string().optional().default(''), sedes: SEDES.optional() }), req.body);
  sinSedes(b.role, b.sedes);
  const sedes = b.sedes ?? [req.sede!];
  if (directorio()) {
    // cuenta existente (p. ej. de Transportes): solo se le asigna Operaciones; su contraseña no se toca
    const cur = await directoryUser(pool, { email: b.email });
    if (cur?.role) throw conflict('DUPLICADO', 'Esa cuenta ya tiene acceso a Operaciones; cambia su rol en la lista.');
    if (!cur) validatePasswordStrength(b.password);
    const id = cur?.id ?? (await createAuthAccount(b));
    return void res.status(201).json(await tx(async (c) => {
      await setModuleRole(c, { id, email: b.email, name: cur?.name ?? b.name }, b.role);
      await setUserSedes(c, id, sedes);
      const out = await directoryUser(c, { id });
      await audit(c, req.user!, 'usuario', id, cur ? 'asignar_modulo' : 'crear', null, out);
      resetSsoCache(id);
      return { ...out, existente: !!cur };
    }));
  }
  if (config.authMode === 'sso') throw externa();
  validatePasswordStrength(b.password);
  res.status(201).json(await tx(async (c) => {
    if ((await c.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [b.email])).rowCount) throw conflict('DUPLICADO', 'Ya existe un usuario con ese correo.');
    const id = (await c.query(`INSERT INTO users (email, name, role, password_hash) VALUES ($1,$2,$3::user_role,$4) RETURNING id`, [b.email, b.name, b.role, await hashPassword(b.password)])).rows[0].id;
    await setUserSedes(c, id, sedes);
    const out = await localUser(c, id);
    await audit(c, req.user!, 'usuario', id, 'crear', null, out); return out;
  }));
});
usersRouter.patch('/usuarios/:id', need('usuarios.gestionar'), async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).optional(), role: ROLE.optional(), active: z.boolean().optional(), password: z.string().optional(), sedes: SEDES.optional() }), req.body);
  if (directorio()) {
    if (b.name !== undefined || b.password !== undefined) throw conflict('GESTION_EXTERNA', 'El nombre y la contraseña son de la cuenta de Supabase; cada persona los cambia al entrar.');
    if (req.params.id === req.user!.id && (b.active === false || (b.role && b.role !== 'administrador'))) throw conflict('AUTOBLOQUEO', 'No puedes quitarte tu propio acceso de administrador.');
    return void res.json(await tx(async (c) => {
      const cur = await directoryUser(c, { id: req.params.id as string }); if (!cur?.role) throw notFound('Usuario');
      sinSedes(b.role ?? cur.role, b.sedes);
      if (b.role) await setModuleRole(c, cur, b.role);
      if (b.active !== undefined) await c.query('UPDATE users SET active = $2, updated_at = now() WHERE id = $1', [cur.id, b.active]);
      if (b.sedes) await setUserSedes(c, cur.id, b.sedes);
      const out = await directoryUser(c, { id: cur.id });
      await audit(c, req.user!, 'usuario', cur.id, 'editar', { role: cur.role, active: cur.active, sedes: cur.sedes }, { role: out.role, active: out.active, sedes: out.sedes });
      resetSsoCache(cur.id); resetSedeCache();
      return out;
    }));
  }
  if (config.authMode === 'sso' && (b.name !== undefined || b.role !== undefined || b.password !== undefined)) throw externa();
  res.json(await tx(async (c) => {
    const cur = await localUser(c, req.params.id as string); if (!cur) throw notFound('Usuario');
    await c.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [cur.id]);
    if (req.params.id === req.user!.id && (b.active === false || (b.role && b.role !== 'administrador'))) throw conflict('AUTOBLOQUEO', 'No puedes quitarte tu propio acceso de administrador.');
    sinSedes(b.role ?? cur.role, b.sedes);
    if (b.password) validatePasswordStrength(b.password);
    await c.query(`UPDATE users SET name = coalesce($2,name), role = coalesce($3::user_role, role), active = coalesce($4, active), password_hash = coalesce($5, password_hash),
        token_version = token_version + CASE WHEN $3 IS NOT NULL OR $4 IS NOT NULL OR $5 IS NOT NULL THEN 1 ELSE 0 END, updated_at = now() WHERE id = $1`,
      [cur.id, b.name ?? null, b.role ?? null, b.active ?? null, b.password ? await hashPassword(b.password) : null]);
    if (b.sedes) await setUserSedes(c, cur.id, b.sedes);
    const out = await localUser(c, cur.id);
    resetSedeCache();
    await audit(c, req.user!, 'usuario', cur.id, 'editar', { name: cur.name, role: cur.role, active: cur.active, sedes: cur.sedes }, { name: out.name, role: out.role, active: out.active, sedes: out.sedes, cambioClave: !!b.password });
    return out;
  }));
});

// ───────── catálogo de sedes (lo administra quien gestiona usuarios) ─────────
const sedeCols = 'id, name, active, sort';
usersRouter.get('/sedes', need('usuarios.gestionar'), async (_req, res) => res.json((await pool.query(`SELECT ${sedeCols} FROM sedes ORDER BY sort, name`)).rows));
usersRouter.post('/sedes', need('usuarios.gestionar'), async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(3).max(80) }), req.body);
  const name = b.name.toUpperCase(), id = name.replace(/^SEDE\s+/, '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'SEDE';
  res.status(201).json(await tx(async (c) => {
    if ((await c.query('SELECT 1 FROM sedes WHERE id = $1 OR upper(name) = $2', [id, name])).rowCount) throw conflict('DUPLICADO', 'Ya existe una sede con ese nombre.');
    const sort = (await c.query('SELECT coalesce(max(sort),0)+1 n FROM sedes')).rows[0].n;
    const r = await c.query(`INSERT INTO sedes (id, name, sort) VALUES ($1,$2,$3) RETURNING ${sedeCols}`, [id, name, sort]);
    await audit(c, req.user!, 'sede', id, 'crear', null, r.rows[0]); resetSedeCache(); return r.rows[0];
  }));
});
usersRouter.patch('/sedes/:id', need('usuarios.gestionar'), async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(3).max(80).optional(), active: z.boolean().optional() }).strict(), req.body);
  res.json(await tx(async (c) => {
    const cur = (await c.query(`SELECT ${sedeCols} FROM sedes WHERE id = $1 FOR UPDATE`, [req.params.id])).rows[0]; if (!cur) throw notFound('Sede');
    if (b.active === false && (await c.query('SELECT count(*)::int n FROM sedes WHERE active AND id <> $1', [cur.id])).rows[0].n === 0) throw conflict('ULTIMA_SEDE', 'Debe quedar al menos una sede activa.');
    const r = await c.query(`UPDATE sedes SET name = coalesce($2, name), active = coalesce($3, active) WHERE id = $1 RETURNING ${sedeCols}`, [cur.id, b.name?.toUpperCase() ?? null, b.active ?? null]);
    await audit(c, req.user!, 'sede', cur.id, 'editar', cur, r.rows[0]); resetSedeCache(); return r.rows[0];
  }));
});
