import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { authenticate, checkPassword, hashPassword, signToken, validatePasswordStrength } from '../auth.js';
import { pool } from '../db.js';
import { HttpError, parse } from '../http.js';
import { ROLE_PERMS } from '../permissions.js';
import { audit } from '../services/audit.js';

export const authRouter = Router();
const limiter = rateLimit({ windowMs: 15 * 60_000, limit: process.env.NODE_ENV === 'test' ? 1000 : 30, standardHeaders: true, legacyHeaders: false, message: { error: 'DEMASIADOS_INTENTOS', message: 'Demasiados intentos. Espera unos minutos.' } });

// Con sesión compartida (AUTH_MODE=sso) el acceso y la contraseña los gestiona la app principal (Supabase).
authRouter.use((req, res, next) => {
  if (config.authMode !== 'sso' || req.path === '/me') return next();
  if (req.path === '/logout') return void res.json({ ok: true });
  res.status(400).json({ error: 'SESION_EXTERNA', message: 'Este módulo usa la sesión compartida de la app principal. Entra desde el portal.' });
});
authRouter.post('/login', limiter, async (req, res) => {
  const { email, password } = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
  const u = (await pool.query('SELECT * FROM users WHERE lower(email) = lower($1)', [email])).rows[0];
  const fail = new HttpError(401, 'CREDENCIALES', 'Correo o contraseña incorrectos.');
  if (!u || !u.active) throw fail;
  if (u.locked_until && new Date(u.locked_until) > new Date()) throw new HttpError(423, 'CUENTA_BLOQUEADA', 'Cuenta bloqueada temporalmente por intentos fallidos. Intenta más tarde.');
  if (!(await checkPassword(password, u.password_hash))) {
    await pool.query(`UPDATE users SET failed_logins = failed_logins + 1, locked_until = CASE WHEN failed_logins + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END WHERE id = $1`, [u.id]);
    throw fail;
  }
  await pool.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [u.id]);
  await audit(pool, { id: u.id, email: u.email }, 'sesion', u.id, 'login', null, null);
  res.json({ token: signToken(u), user: { id: u.id, email: u.email, name: u.name, role: u.role, permissions: ROLE_PERMS[u.role as keyof typeof ROLE_PERMS] } });
});
authRouter.get('/me', authenticate, (req, res) => res.json({ ...req.user, permissions: ROLE_PERMS[req.user!.role] }));
authRouter.post('/logout', authenticate, async (req, res) => {
  await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [req.user!.id]);
  res.json({ ok: true });
});
authRouter.post('/password', authenticate, async (req, res) => {
  const { current, next } = parse(z.object({ current: z.string(), next: z.string() }), req.body);
  const u = (await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user!.id])).rows[0];
  if (!(await checkPassword(current, u.password_hash))) throw new HttpError(400, 'CREDENCIALES', 'La contraseña actual no es correcta.');
  validatePasswordStrength(next);
  await pool.query('UPDATE users SET password_hash = $2, token_version = token_version + 1, updated_at = now() WHERE id = $1', [req.user!.id, await hashPassword(next)]);
  await audit(pool, req.user!, 'usuario', req.user!.id, 'cambiar_clave', null, null);
  res.json({ ok: true });
});
